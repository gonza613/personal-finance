import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface VoiceRequest {
  command: string;
  userId: string;
  secret?: string;
}

serve(async (req) => {
  // Manejo de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { command, userId, secret } = await req.json() as VoiceRequest;

    if (!command || !userId) {
      return new Response(JSON.stringify({ error: 'Faltan parámetros: command y userId son obligatorios' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Validación simple de clave secreta (opcional, para evitar escrituras no autorizadas)
    const alexaSecret = Deno.env.get('ALEXA_SECRET_KEY');
    if (alexaSecret && secret !== alexaSecret) {
      return new Response(JSON.stringify({ error: 'No autorizado - Clave secreta incorrecta' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Inicializar cliente Supabase usando la clave Service Role para poder saltarse RLS al insertar en nombre del usuario desde el webhook
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseClient = createClient(supabaseUrl, supabaseServiceRole);

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      return new Response(JSON.stringify({ error: 'API Key de Gemini no configurada' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 1. Usar Gemini para parsear el comando de voz a formato estructurado JSON
    const parsePrompt = `Analiza la siguiente frase de voz de un usuario y extrae la intención y datos financieros estructurados.
Frase del usuario: "${command}"

Responde ÚNICAMENTE con un objeto JSON válido. No uses markdown, no agregues explicaciones, solo devuelve el objeto JSON con este formato:
{
  "action": "INSERT_EXPENSE" | "QUERY_EXPENSES" | "UNKNOWN",
  "expenseData": {
    "amount": number | null,
    "category": string | null,
    "description": string | null
  },
  "queryData": {
    "category": string | null,
    "period": "hoy" | "semana" | "mes" | null
  }
}

Notas para categorías: Usa categorías estandarizadas en español como "Comida", "Transporte", "Servicios", "Entretenimiento", "Combustible", "Salud", "Supermercado", "Otros".`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`;
    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: parsePrompt }]
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      })
    });

    if (!geminiResponse.ok) {
      throw new Error(`Error en Gemini parser: ${await geminiResponse.text()}`);
    }

    const geminiData = await geminiResponse.json();
    const parsedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsedResult = JSON.parse(parsedText.trim());

    let responseMessage = "No entendí la instrucción de voz.";

    if (parsedResult.action === "INSERT_EXPENSE" && parsedResult.expenseData.amount) {
      const { amount, category, description } = parsedResult.expenseData;
      const finalCategory = category || "Otros";
      const finalDescription = description || "Gasto por voz";

      // Generar el embedding del gasto para búsquedas semánticas futuras
      let embedding: number[] | null = null;
      try {
        const textToEmbed = `${finalCategory} ${finalDescription} ${amount}`;
        const embedUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${geminiApiKey}`;
        const embedResponse = await fetch(embedUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "models/gemini-embedding-2",
            content: {
              parts: [{ text: textToEmbed }]
            },
            outputDimensionality: 768
          })
        });
        if (embedResponse.ok) {
          const embedData = await embedResponse.json();
          embedding = embedData.embedding.values;
        }
      } catch (err) {
        console.error("Error generando embedding para el nuevo gasto:", err);
      }

      // Insertar gasto en la base de datos (tabla public.gastos)
      const { error: insertError } = await supabaseClient
        .from('gastos')
        .insert({
          user_id: userId,
          monto: amount,
          categoria: finalCategory,
          descripcion: finalDescription,
          embedding
        });

      if (insertError) {
        throw new Error(`Error al guardar el gasto: ${insertError.message}`);
      }

      responseMessage = `Registré un gasto de $${amount} en ${finalCategory} (${finalDescription}).`;

    } else if (parsedResult.action === "QUERY_EXPENSES") {
      // Consultar gastos de la base de datos (tabla public.gastos)
      let dbQuery = supabaseClient
        .from('gastos')
        .select('monto, categoria, descripcion, fecha')
        .eq('user_id', userId);

      if (parsedResult.queryData.category) {
        dbQuery = dbQuery.ilike('categoria', `%${parsedResult.queryData.category}%`);
      }

      // Filtrado simple de fechas
      const now = new Date();
      if (parsedResult.queryData.period === "hoy") {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        dbQuery = dbQuery.gte('fecha', startOfDay);
      } else if (parsedResult.queryData.period === "semana") {
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        dbQuery = dbQuery.gte('fecha', oneWeekAgo);
      } else if (parsedResult.queryData.period === "mes") {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        dbQuery = dbQuery.gte('fecha', startOfMonth);
      }

      const { data: expenses, error: queryError } = await dbQuery.order('fecha', { ascending: false });

      if (queryError) {
        throw new Error(`Error consultando gastos: ${queryError.message}`);
      }

      if (!expenses || expenses.length === 0) {
        responseMessage = "No encontré gastos registrados para esa consulta.";
      } else {
        const total = expenses.reduce((sum, e) => sum + Number(e.monto), 0);
        const count = expenses.length;
        responseMessage = `Encontré ${count} gastos por un total de $${total}. El último fue de $${expenses[0].monto} en ${expenses[0].categoria} por "${expenses[0].descripcion}".`;
      }
    } else {
      // Action is UNKNOWN
      responseMessage = "No logré identificar si querías registrar un gasto o consultar tus gastos. ¿Podrías repetirlo?";
    }

    return new Response(JSON.stringify({ success: true, message: responseMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("Error in voice-webhook:", error);
    return new Response(JSON.stringify({ success: false, error: error.message || 'Error procesando comando de voz' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
})
