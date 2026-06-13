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
    attributes?: Record<string, any>;
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

interface ConversationMessage {
  role: 'user' | 'ai';
  text: string;
}

/**
 * Limpia el formato Markdown para que Alexa pueda leer el texto de forma natural
 * sin deletrear asteriscos, guiones o barras de tablas.
 */
function cleanMarkdownForVoice(text: string): string {
  if (!text) return "";
  return text
    // Eliminar emojis de alerta que Alexa deletrea
    .replace(/[⚠️🚨🔔✅❌💡📊📈📉🏷️🔄💰]/gu, "")
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

    // Recuperar el historial conversacional de los atributos de sesión
    const sessionAttributes = session?.attributes || {};
    const conversationHistory: ConversationMessage[] = sessionAttributes.conversationHistory || [];

    // Estructura base de la respuesta de Alexa (sesión abierta por defecto para conversación fluida)
    const buildAlexaResponse = (
      speechText: string,
      shouldEndSession: boolean,
      requireAccountLinking = false,
      updatedHistory?: ConversationMessage[]
    ) => {
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
            text: "¿Algo más? Puedes decirme qué gastaste, preguntarme sobre tus finanzas, o decir 'salir' para terminar."
          }
        };
      }

      // Persistir el historial conversacional en los atributos de sesión de Alexa
      const newSessionAttributes: Record<string, any> = {
        ...sessionAttributes,
        conversationHistory: updatedHistory || conversationHistory
      };

      return new Response(JSON.stringify({
        version: "1.0",
        sessionAttributes: newSessionAttributes,
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
        "¡Hola! Estoy lista para ayudarte con tus finanzas. Puedes decirme cosas como: 'gasté 5 mil en comida', 'cuánto llevo este mes', o 'qué promos tengo'. ¿Qué necesitás?",
        false // Mantener sesión abierta
      );
    }

    // 4. Manejo de IntentRequest
    if (requestType === "IntentRequest") {
      const intentName = alexaReq.request.intent?.name;
      console.log("Intent Name:", intentName);

      // Intents estándares de cancelación y ayuda
      if (intentName === "AMAZON.CancelIntent" || intentName === "AMAZON.StopIntent") {
        return buildAlexaResponse("¡Hasta luego! Cuando necesites, decime 'Alexa, abre mis finanzas'.", true);
      }

      if (intentName === "AMAZON.HelpIntent") {
        return buildAlexaResponse(
          "Podés hablarme de forma natural. Por ejemplo: 'gasté 3 mil en nafta', 'cuánto gasté esta semana en comida', 'registrá una promo del Galicia con 20% de descuento los lunes', o 'modificá el último gasto a 5 mil'. ¿Qué querés hacer?",
          false
        );
      }

      // Extraer el texto de la consulta del slot del intent
      let queryText = "";
      const slots = alexaReq.request.intent?.slots;
      if (slots) {
        // Buscar un slot llamado 'query' o agarrar el primer slot que tenga valor
        const querySlot = slots.query || Object.values(slots).find(s => s.value !== undefined);
        if (querySlot?.value) {
          queryText = querySlot.value;
        }
      }

      // Para el FallbackIntent, usar un mensaje genérico
      if (intentName === "AMAZON.FallbackIntent") {
        if (!queryText) {
          return buildAlexaResponse(
            "No logré entenderte bien. Puedes decirme cosas como 'gasté 2 mil en transporte' o 'cuánto llevo este mes'. ¿Qué necesitás?",
            false
          );
        }
      }

      if (!queryText) {
        return buildAlexaResponse(
          "No logré captar lo que dijiste. Podés decirme naturalmente qué gastaste, consultar tus finanzas o pedir que modifique algo. ¿Qué necesitás?",
          false
        );
      }

      console.log(`Enviando consulta a ai-chat: "${queryText}" con ${conversationHistory.length} mensajes de historial`);

      // 5. Llamar a la Edge Function `ai-chat` con historial conversacional
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const aiChatUrl = `${supabaseUrl}/functions/v1/ai-chat`;

      try {
        const aiResponse = await fetch(aiChatUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify({
            message: queryText,
            history: conversationHistory // Enviar historial para memoria conversacional
          })
        });

        if (!aiResponse.ok) {
          throw new Error(`Error en la llamada a ai-chat: ${aiResponse.status} ${aiResponse.statusText}`);
        }

        const aiData = await aiResponse.json();
        const rawReply = aiData.reply || "No recibí respuesta del asesor financiero.";
        
        // Limpiar el Markdown de la respuesta de la IA
        const speechReply = cleanMarkdownForVoice(rawReply);
        console.log("Respuesta procesada para voz:", speechReply);

        // Actualizar historial conversacional con este intercambio
        const updatedHistory: ConversationMessage[] = [
          ...conversationHistory,
          { role: 'user', text: queryText },
          { role: 'ai', text: rawReply }
        ].slice(-10); // Mantener máximo los últimos 10 mensajes

        // Mantener la sesión ABIERTA para que el usuario pueda seguir hablando
        return buildAlexaResponse(speechReply, false, false, updatedHistory);

      } catch (err) {
        console.error("Error al comunicarse con ai-chat:", err);
        return buildAlexaResponse(
          "Lo siento, tuve un problema al conectar con tu cuenta de finanzas. Intentá de nuevo en unos segundos.",
          false // Mantener sesión abierta para reintentar
        );
      }
    }

    // Fallback para otros tipos de peticiones no soportados
    return buildAlexaResponse("Lo siento, esa acción no está soportada.", false);

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
