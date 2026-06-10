import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TicketProcessRequest {
  image: string; // Base64 representation of the image
  mimeType: string; // e.g. "image/jpeg", "image/png"
}

serve(async (req) => {
  // CORS Preflight
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

    // Inicializar cliente Supabase para validar RLS y autenticación
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Token inválido o expirado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { image, mimeType } = await req.json() as TicketProcessRequest;
    if (!image || !mimeType) {
      return new Response(JSON.stringify({ error: 'La imagen en base64 y el mimeType son requeridos' }), {
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

    // Limpiar el prefijo base64 si el frontend lo incluyó (ej. "data:image/jpeg;base64,")
    let base64Data = image;
    if (image.includes(';base64,')) {
      base64Data = image.split(';base64,')[1];
    }

    // Call Gemini 3.5 Flash with multimodal vision payload
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`;
    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Data
                }
              },
              {
                text: "Analiza detalladamente esta imagen de un ticket, factura o recibo de compra. Extrae la información y devuélvela estrictamente en formato JSON con la siguiente estructura:\n" +
                      "{\n" +
                      "  \"comercio\": \"Nombre de la tienda, supermercado o local (ej. Carrefour, Coto, Starbucks)\",\n" +
                      "  \"fecha\": \"Fecha de la compra en formato YYYY-MM-DD. Si no la encuentras, usa la fecha de hoy.\",\n" +
                      "  \"total\": 0.00, // número decimal que representa la suma total pagada\n" +
                      "  \"productos\": [\n" +
                      "    {\n" +
                      "      \"producto\": \"Nombre del producto o descripción (si el nombre es críptico o genérico, intenta expandirlo o deducir qué es de manera legible, ej. 'LECHE ENTERA LA SERENISIMA' en lugar de 'LCH ENT LS')\",\n" +
                      "      \"precio\": 0.00, // precio unitario del producto como número decimal\n" +
                      "      \"cantidad\": 1.0, // cantidad comprada de este producto (entero o decimal al peso, ej. 0.455)\n" +
                      "      \"unidad_medida\": \"unidad de medida corta (usa 'u' para unidades, 'kg' para kilogramos, 'g' para gramos, 'ml' para mililitros, 'l' para litros. Si no está clara, por defecto usa 'u')\"\n" +
                      "    }\n" +
                      "  ]\n" +
                      "}\n" +
                      "Responde únicamente con el JSON válido, sin delimitadores ```json ni texto adicional."
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1
        }
      })
    });

    if (!geminiResponse.ok) {
      if (geminiResponse.status === 429) {
        return new Response(JSON.stringify({ 
          error: 'quota_exceeded',
          message: 'Límite de cuota gratuita alcanzado en la API de Gemini (20 consultas al día para gemini-3.5-flash).\n\nPara solucionarlo, vincula una tarjeta en Google AI Studio (modo Pay-as-you-go). Seguirá siendo prácticamente gratis por tu bajo volumen de uso personal.' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      throw new Error(`Gemini API returned status ${geminiResponse.status}: ${await geminiResponse.text()}`);
    }

    const geminiData = await geminiResponse.json();
    const replyText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!replyText) {
      throw new Error("No se pudo obtener una respuesta legible de Gemini");
    }

    // Parsear el JSON para validar su formato antes de retornarlo
    try {
      const parsedData = JSON.parse(replyText.trim());
      return new Response(JSON.stringify(parsedData), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (e) {
      console.error("Error al parsear el JSON de Gemini:", replyText);
      return new Response(JSON.stringify({ 
        error: 'El modelo no retornó un JSON válido.', 
        rawText: replyText 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

  } catch (error: any) {
    console.error("Error en process-ticket:", error);
    return new Response(JSON.stringify({ error: error.message || 'Error interno del servidor' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
})
