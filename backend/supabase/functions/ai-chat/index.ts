import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const toLocalTime = (utcDateStr: string, timeZone: string): string => {
  try {
    const date = new Date(utcDateStr);
    return new Intl.DateTimeFormat("es-AR", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return utcDateStr;
  }
}

interface ChatRequest {
  message: string;
}

serve(async (req) => {
  // Manejo de CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado - Falta cabecera Authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Inicializar cliente Supabase con el token del usuario para respetar RLS
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Validar el usuario
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Token inválido o expirado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Leer el mensaje del body
    const { message } = await req.json() as ChatRequest;
    if (!message) {
      return new Response(JSON.stringify({ error: 'El mensaje es requerido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      return new Response(JSON.stringify({ error: 'La API Key de Gemini no está configurada en el servidor' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 1. Generar embedding de la consulta usando Gemini (gemini-embedding-2)
    let embedding: number[] = [];
    try {
      const embedUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${geminiApiKey}`;
      const embedResponse = await fetch(embedUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-2",
          content: {
            parts: [{ text: message }]
          },
          outputDimensionality: 768
        })
      });

      if (!embedResponse.ok) {
        throw new Error(await embedResponse.text());
      }
      const embedData = await embedResponse.json();
      embedding = embedData.embedding.values;
    } catch (err) {
      console.error("Error generating embedding:", err);
    }

    // 2. Recuperar contexto de la Base de Datos
    let semanticExpenses: any[] = [];
    let semanticPromotions: any[] = [];
    let recentExpenses: any[] = [];
    let investments: any[] = [];

    // Obtener los 10 gastos más recientes
    const { data: recentExp, error: recentError } = await supabaseClient
      .from('gastos')
      .select('id, monto, categoria, descripcion, fecha')
      .order('fecha', { ascending: false })
      .limit(10);
    if (!recentError && recentExp) {
      recentExpenses = recentExp;
    }

    // Obtener las inversiones del usuario
    const { data: investData, error: investError } = await supabaseClient
      .from('inversiones_posiciones')
      .select('ticker, cantidad, tipo, plataforma')
      .order('ticker', { ascending: true });
    if (!investError && investData) {
      investments = investData;
    }

    if (embedding.length > 0) {
      // Buscar gastos semánticos
      const { data: semExp, error: semExpError } = await supabaseClient.rpc('match_gastos', {
        query_embedding: embedding,
        match_threshold: 0.3,
        match_count: 5,
        p_user_id: user.id
      });
      if (!semExpError && semExp) {
        semanticExpenses = semExp;
      }

      // Buscar promociones semánticas
      const { data: semPromo, error: semPromoError } = await supabaseClient.rpc('match_promociones', {
        query_embedding: embedding,
        match_threshold: 0.25,
        match_count: 5
      });
      if (!semPromoError && semPromo) {
        semanticPromotions = semPromo;
      }
    }

    const timeZone = Deno.env.get("USER_TIMEZONE") || "America/Argentina/Buenos_Aires";
    const currentLocalTime = new Intl.DateTimeFormat("es-AR", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());

    const formattedRecentExpenses = recentExpenses.map(e => ({
      id: e.id,
      monto: e.monto,
      categoria: e.categoria,
      descripcion: e.descripcion,
      fecha_local: toLocalTime(e.fecha, timeZone)
    }));

    const formattedSemanticExpenses = semanticExpenses.map(e => ({
      id: e.id,
      monto: e.monto,
      categoria: e.categoria,
      descripcion: e.descripcion,
      fecha_local: toLocalTime(e.fecha, timeZone)
    }));

    // 3. Diseñar el System Prompt con el contexto recuperado
    const systemInstruction = `Actúas como un asesor financiero personal experto e inteligente. Tu objetivo es ayudar al usuario a gestionar sus finanzas, responder preguntas sobre sus gastos, registrar transacciones o promociones, sugerir el mejor método de pago basándote en beneficios vigentes y realizar un seguimiento de su cartera de inversiones.

Contexto geográfico y de moneda:
- El usuario reside en Argentina.
- Todas las monedas y montos especificados en los gastos, presupuestos, límites, topes y promociones están expresados en Pesos Argentinos (ARS o $).
- Al responder sobre montos, debes referirte a ellos en pesos argentinos de manera explícita (nunca en dólares, a menos que se trate de activos extranjeros o criptomonedas).

La fecha y hora actual local del usuario es: ${currentLocalTime} (Zona horaria: ${timeZone}).

Aquí tienes el contexto de los datos del usuario:
[GASTOS RECIENTES (Últimos 10)]
${JSON.stringify(formattedRecentExpenses, null, 2)}

[GASTOS HISTÓRICOS SIMILARES (Búsqueda Semántica)]
${JSON.stringify(formattedSemanticExpenses, null, 2)}

[PROMOCIONES RELEVANTES DISPONIBLES (Búsqueda Semántica)]
${JSON.stringify(semanticPromotions, null, 2)}

[POSICIONES DE INVERSIÓN ACTUALES]
${JSON.stringify(investments, null, 2)}

Reglas de respuesta cruciales (Brevidad absoluta):
1. Responde ÚNICAMENTE a la pregunta exacta del usuario de la forma más directa y concisa posible. No proporciones información que no se te haya pedido.
2. NUNCA agregues resúmenes de datos no solicitados. Por ejemplo, si te preguntan por gastos, no menciones promociones ni inversiones.
3. NUNCA finalices con preguntas de seguimiento, frases de cortesía o sugerencias no solicitadas (ej. evita preguntar "¿Necesitás algo más?" o "¿Querés registrar otro gasto?"). Termina tu respuesta inmediatamente al contestar la duda.
4. Si el usuario te pide eliminar, borrar o cancelar un gasto (por ejemplo, "borrar el gasto de hoy", "elimina el café", "borra el último gasto"), busca el ID (UUID) de ese gasto en la lista de [GASTOS RECIENTES] o [GASTOS HISTÓRICOS SIMILARES] y llama de inmediato a la herramienta "delete_expense" con el 'expense_id' correspondiente. No respondas con texto descriptivo del gasto sin borrarlo ni pidas confirmación. Si no encuentras el gasto o hay ambigüedad (múltiples gastos similares), responde al usuario preguntando cuál de ellos desea eliminar, describiéndolos brevemente.
5. Si te piden registrar o guardar un gasto o promoción, llama a la herramienta adecuada de inmediato sin pedir confirmación.
6. No menciones términos técnicos como "contexto", "búsqueda semántica", "RAG", "JSON" o "herramientas". Habla de forma natural sobre sus registros.
7. Usa formato Markdown limpio (negritas, viñetas) optimizado para voz y pantallas móviles.`;

    // 4. Enviar la consulta a Gemini 3.5 Flash con Declaración de Funciones (Tools)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`;
    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: message }]
          }
        ],
        tools: [{
          functionDeclarations: [
            {
              name: "insert_promotion",
              description: "Registra una nueva promoción, beneficio o descuento bancario/billetera en la base de datos para consultas futuras.",
              parameters: {
                type: "OBJECT",
                properties: {
                  entidad: { type: "STRING", description: "Nombre de la entidad o banco (ej. Galicia, Santander, Banco Nación, Lemon, MODO) o 'Todos'." },
                  descuento_porcentaje: { type: "NUMBER", description: "Porcentaje de descuento, solo el número (ej. 20 para 20%)." },
                  tope_reintegro: { type: "NUMBER", description: "Monto máximo o tope de reintegro en pesos si aplica, sino nulo." },
                  dias_vigencia: { type: "STRING", description: "Días de vigencia o fecha (ej. Lunes, Todos los días, Lunes y Martes)." }
                },
                required: ["entidad", "descuento_porcentaje", "dias_vigencia"]
              }
            },
            {
              name: "insert_expense",
              description: "Registra un nuevo gasto financiero realizado por el usuario.",
              parameters: {
                type: "OBJECT",
                properties: {
                  monto: { type: "NUMBER", description: "El monto total del gasto en pesos." },
                  categoria: { type: "STRING", description: "Categoría del gasto (debe ser uno de: Comida, Transporte, Servicios, Entretenimiento, Combustible, Salud, Supermercado, Otros)." },
                  descripcion: { type: "STRING", description: "Detalles del gasto (ej. Coca cola, Almuerzo, Carga de nafta, Pago de luz)." }
                },
                required: ["monto", "categoria"]
              }
            },
            {
              name: "delete_expense",
              description: "Elimina un gasto financiero específico registrado en la base de datos a partir de su ID (UUID).",
              parameters: {
                type: "OBJECT",
                properties: {
                  expense_id: { type: "STRING", description: "El ID (UUID) del gasto que se desea eliminar." }
                },
                required: ["expense_id"]
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1000
        }
      })
    });

    if (!geminiResponse.ok) {
      throw new Error(`Gemini API returned status ${geminiResponse.status}: ${await geminiResponse.text()}`);
    }

    const geminiData = await geminiResponse.json();
    const candidate = geminiData.candidates?.[0];
    const part = candidate?.content?.parts?.[0];

    let reply = "Lo siento, no pude procesar tu solicitud en este momento.";

    if (part?.functionCall) {
      const { name, args } = part.functionCall;
      console.log(`Gemini solicitó llamar a la función: ${name} con argumentos:`, args);

      if (name === "insert_promotion") {
        const { entidad, descuento_porcentaje, tope_reintegro, dias_vigencia } = args;

        // 1. Generar embedding para la nueva promoción
        let promoEmbedding: number[] | null = null;
        try {
          const textToEmbed = `${entidad} ${descuento_porcentaje}% descuento ${dias_vigencia} ${tope_reintegro ? 'tope ' + tope_reintegro : ''}`;
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
            promoEmbedding = embedData.embedding.values;
          }
        } catch (err) {
          console.error("Error generando embedding para la promoción:", err);
        }

        // 2. Insertar promoción en la BD
        const { error: promoError } = await supabaseClient
          .from('promociones')
          .insert({
            entidad,
            descuento_porcentaje: Number(descuento_porcentaje),
            tope_reintegro: tope_reintegro ? Number(tope_reintegro) : null,
            dias_vigencia,
            embedding: promoEmbedding
          });

        if (promoError) {
          throw new Error(`Error guardando promoción: ${promoError.message}`);
        }

        reply = `¡Entendido! He registrado la promoción en la base de datos:\n\n* **Entidad:** ${entidad}\n* **Descuento:** ${descuento_porcentaje}%\n* **Vigencia:** ${dias_vigencia}\n${tope_reintegro ? `* **Tope de reintegro:** $${tope_reintegro}\n` : ''}`;

      } else if (name === "insert_expense") {
        const { monto, categoria, descripcion } = args;

        // 1. Generar embedding para el gasto
        let expEmbedding: number[] | null = null;
        try {
          const textToEmbed = `${categoria} ${descripcion || ''} ${monto}`;
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
            expEmbedding = embedData.embedding.values;
          }
        } catch (err) {
          console.error("Error generando embedding para el gasto:", err);
        }

        // 2. Insertar gasto en la BD
        const { error: expError } = await supabaseClient
          .from('gastos')
          .insert({
            user_id: user.id,
            monto: Number(monto),
            categoria,
            descripcion: descripcion || null,
            embedding: expEmbedding
          });

        if (expError) {
          throw new Error(`Error guardando gasto: ${expError.message}`);
        }

        reply = `¡Gasto registrado con éxito!\n\n* **Monto:** $${monto}\n* **Categoría:** ${categoria}\n* **Detalle:** ${descripcion || 'Sin descripción'}`;
      } else if (name === "delete_expense") {
        const { expense_id } = args;

        const { error: deleteError } = await supabaseClient
          .from('gastos')
          .delete()
          .eq('id', expense_id);

        if (deleteError) {
          throw new Error(`Error al eliminar el gasto: ${deleteError.message}`);
        }

        reply = "¡Gasto eliminado de la base de datos con éxito!";
      }
    } else {
      reply = part?.text || "Lo siento, no pude procesar tu solicitud en este momento.";
    }

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("Error in ai-chat function:", error);
    return new Response(JSON.stringify({ error: error.message || 'Error interno del servidor' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
})
