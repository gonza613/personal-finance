import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AlexaRequest {
  version: string;
  session?: {
    new: boolean;
    sessionId: string;
    application: { applicationId: string };
    user: {
      userId: string;
      accessToken?: string;
    };
  };
  request: {
    type: "LaunchRequest" | "IntentRequest" | "SessionEndedRequest";
    requestId: string;
    timestamp: string;
    intent?: {
      name: string;
      confirmationStatus: string;
      slots?: Record<string, {
        name: string;
        value?: string;
        confirmationStatus?: string;
      }>;
    };
    reason?: string;
    error?: {
      type: string;
      message: string;
    };
  };
}

/**
 * Limpia el formato Markdown para que Alexa pueda leer el texto de forma natural
 * sin deletrear asteriscos, guiones o barras de tablas.
 */
function cleanMarkdownForVoice(text: string): string {
  if (!text) return "";
  return text
    // Reemplazar viñetas por pausas breves (comas) primero para evitar conflictos con asteriscos de formato
    .replace(/^\s*[-*+]\s+/gm, ", ")
    // Eliminar negritas y cursivas (e.g., **texto**, *texto*, __texto__, _texto_)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // Eliminar encabezados (e.g., # Título)
    .replace(/^#+\s+(.*)$/gm, "$1")
    // Eliminar líneas divisorias de tablas tipo |---|
    .replace(/^[|\s-:+]+$/gm, "")
    // Eliminar barras verticales de tablas reemplazándolas por espacios
    .replace(/\|/g, " ")
    // Reemplazar múltiples saltos de línea por un espacio para evitar pausas artificiales largas
    .replace(/\n+/g, " ")
    // Limpiar espacios dobles sobrantes
    .replace(/\s+/g, " ")
    .trim();
}

serve(async (req) => {
  // Manejo de CORS (para preflight y posibles pruebas)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Método no permitido' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const alexaReq = await req.json() as AlexaRequest;
    console.log("Full Alexa Request JSON:", JSON.stringify(alexaReq));

    const requestType = alexaReq.request?.type;
    const session = alexaReq.session;
    const accessToken = session?.user?.accessToken;

    // Estructura base de la respuesta de Alexa
    const buildAlexaResponse = (speechText: string, shouldEndSession: boolean, requireAccountLinking = false) => {
      const response: Record<string, any> = {
        outputSpeech: {
          type: "PlainText",
          text: speechText
        },
        shouldEndSession
      };

      if (requireAccountLinking) {
        response.card = {
          type: "LinkAccount"
        };
      }

      // Solo agregar reprompt si la sesión sigue abierta esperando interacción
      if (!shouldEndSession) {
        response.reprompt = {
          outputSpeech: {
            type: "PlainText",
            text: "¿Sigues ahí? Dime qué te gustaría hacer, como por ejemplo: cuánto gasté hoy."
          }
        };
      }

      return new Response(JSON.stringify({
        version: "1.0",
        response
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    };

    // 1. Manejo de SessionEndedRequest (Alexa cierra la sesión)
    if (requestType === "SessionEndedRequest") {
      console.log("Sesión finalizada por Alexa. Razón:", alexaReq.request.reason);
      return new Response(JSON.stringify({ version: "1.0", response: { shouldEndSession: true } }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. Controlar la vinculación de cuenta
    if (!accessToken) {
      console.log("Petición sin accessToken de Supabase. Solicitando vinculación de cuenta.");
      return buildAlexaResponse(
        "Para usar tus Finanzas Personales con Alexa, primero debes vincular tu cuenta. Por favor, abre la aplicación de Alexa en tu teléfono y completa la vinculación de cuenta.",
        true,
        true
      );
    }

    // 3. Manejo de LaunchRequest (Cuando el usuario dice "Alexa, abre mis finanzas")
    if (requestType === "LaunchRequest") {
      return buildAlexaResponse(
        "Hola, bienvenido a tus Finanzas Personales. ¿Qué te gustaría consultar o registrar hoy?",
        false
      );
    }

    // 4. Manejo de IntentRequest (Comandos de voz del usuario)
    if (requestType === "IntentRequest") {
      const intentName = alexaReq.request.intent?.name;
      console.log("Intent Name:", intentName);

      // Intents estándares de cancelación y ayuda
      if (intentName === "AMAZON.CancelIntent" || intentName === "AMAZON.StopIntent") {
        return buildAlexaResponse("Entendido. ¡Hasta luego!", true);
      }

      if (intentName === "AMAZON.HelpIntent") {
        return buildAlexaResponse(
          "Puedes consultarme sobre tus finanzas. Por ejemplo: cuánto gasté hoy en comida, qué promociones tengo para el banco Galicia, o qué inversiones poseo. ¿Qué quieres hacer?",
          false
        );
      }

      // Extraer el texto de la consulta del slot del Intent
      let queryText = "";
      const slots = alexaReq.request.intent?.slots;
      if (slots) {
        // Buscar un slot llamado 'query' o agarrar el primer slot que tenga valor
        const querySlot = slots.query || Object.values(slots).find(s => s.value !== undefined);
        if (querySlot?.value) {
          queryText = querySlot.value;
          
          // Prevenir que Alexa NLU elimine los verbos de acción al hacer match de slots
          if (intentName === "DeleteFinanceIntent") {
            queryText = `borrar ${queryText}`;
          } else if (intentName === "InsertFinanceIntent") {
            queryText = `registrar ${queryText}`;
          } else if (intentName === "QueryFinanceIntent") {
            queryText = `consultar ${queryText}`;
          }
        }
      }

      if (!queryText) {
        return buildAlexaResponse(
          "No logré comprender la consulta. ¿Podrías repetir qué te gustaría consultar o registrar?",
          false
        );
      }

      console.log(`Enviando consulta a ai-chat: "${queryText}"`);

      // 5. Llamar a la Edge Function `ai-chat` pasándole la frase del usuario y el JWT en la cabecera Authorization
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const aiChatUrl = `${supabaseUrl}/functions/v1/ai-chat`;

      try {
        const aiResponse = await fetch(aiChatUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify({ message: queryText })
        });

        if (!aiResponse.ok) {
          throw new Error(`Error en la llamada a ai-chat: ${aiResponse.status} ${aiResponse.statusText}`);
        }

        const aiData = await aiResponse.json();
        const rawReply = aiData.reply || "No recibí respuesta del asesor financiero.";
        
        // Limpiar el Markdown de la respuesta de la IA
        const speechReply = cleanMarkdownForVoice(rawReply);
        console.log("Respuesta procesada para voz:", speechReply);

        return buildAlexaResponse(speechReply, true);

      } catch (err) {
        console.error("Error al comunicarse con ai-chat:", err);
        return buildAlexaResponse(
          "Lo siento, en este momento experimenté un inconveniente al conectar con tu cuenta de finanzas. Por favor, vuelve a intentarlo en unos instantes.",
          true
        );
      }
    }

    // Fallback para otros tipos de peticiones no soportados
    return buildAlexaResponse("Lo siento, esa acción no está soportada.", true);

  } catch (error: any) {
    console.error("Error en la Edge Function de Alexa:", error);
    return new Response(JSON.stringify({
      version: "1.0",
      response: {
        outputSpeech: {
          type: "PlainText",
          text: "Ocurrió un error inesperado al procesar la solicitud en el servidor."
        },
        shouldEndSession: true
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
})
