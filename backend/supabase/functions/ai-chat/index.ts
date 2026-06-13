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

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
}

interface ChatRequest {
  message: string;
  history?: ChatMessage[];
}

/**
 * Genera un embedding usando Gemini para texto dado.
 */
async function generateEmbedding(text: string, geminiApiKey: string): Promise<number[] | null> {
  try {
    const embedUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${geminiApiKey}`;
    const embedResponse = await fetch(embedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-2",
        content: { parts: [{ text }] },
        outputDimensionality: 768
      })
    });
    if (embedResponse.ok) {
      const embedData = await embedResponse.json();
      return embedData.embedding.values;
    }
  } catch (err) {
    console.error("Error generando embedding:", err);
  }
  return null;
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

    // Leer el mensaje y el historial del body
    const { message, history } = await req.json() as ChatRequest;
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

    // 1. Generar embedding de la consulta usando Gemini
    let embedding: number[] = [];
    const embResult = await generateEmbedding(message, geminiApiKey);
    if (embResult) embedding = embResult;

    // 2. Recuperar contexto de la Base de Datos
    let semanticExpenses: any[] = [];
    let semanticPromotions: any[] = [];
    let recentExpenses: any[] = [];
    let investments: any[] = [];
    let allPromotions: any[] = [];

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

    // Obtener TODAS las promociones (para CRUD y contexto completo)
    const { data: allPromoData, error: allPromoError } = await supabaseClient
      .from('promociones')
      .select('id, entidad, descuento_porcentaje, tope_reintegro, dias_vigencia');
    if (!allPromoError && allPromoData) {
      allPromotions = allPromoData;
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

    // Obtener el presupuesto mensual del usuario (campo budget en profiles)
    let monthlyBudget = 200000; // default
    const { data: profileData } = await supabaseClient
      .from('profiles')
      .select('budget')
      .eq('id', user.id)
      .maybeSingle();
    if (profileData?.budget) {
      monthlyBudget = Number(profileData.budget);
    }

    // Calcular gasto del mes actual para alertas de presupuesto
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const { data: monthExpData } = await supabaseClient
      .from('gastos')
      .select('monto')
      .gte('fecha', startOfMonth);
    const currentMonthTotal = (monthExpData || []).reduce((sum, e) => sum + Number(e.monto), 0);

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

    const budgetPercentage = monthlyBudget > 0 ? ((currentMonthTotal / monthlyBudget) * 100).toFixed(0) : 'N/A';

    // 3. Diseñar el System Prompt con el contexto recuperado
    const systemInstruction = `Actúas como un asesor financiero personal experto e inteligente. Tu objetivo es ayudar al usuario a gestionar sus finanzas, responder preguntas sobre sus gastos, registrar transacciones o promociones, sugerir el mejor método de pago basándote en beneficios vigentes y realizar un seguimiento de su cartera de inversiones.

Contexto geográfico y de moneda:
- El usuario reside en Argentina.
- Todas las monedas y montos especificados en los gastos, presupuestos, límites, topes y promociones están expresados en Pesos Argentinos (ARS o $).
- Al responder sobre montos, debes referirte a ellos en pesos argentinos de manera explícita (nunca en dólares, a menos que se trate de activos extranjeros o criptomonedas).

La fecha y hora actual local del usuario es: ${currentLocalTime} (Zona horaria: ${timeZone}).

Estado de presupuesto:
- Presupuesto mensual configurado: $${monthlyBudget.toLocaleString('es-AR')}
- Gasto acumulado del mes actual: $${currentMonthTotal.toLocaleString('es-AR')} (${budgetPercentage}% del presupuesto)

Aquí tienes el contexto de los datos del usuario:
[GASTOS RECIENTES (Últimos 10)]
${JSON.stringify(formattedRecentExpenses, null, 2)}

[GASTOS HISTÓRICOS SIMILARES (Búsqueda Semántica)]
${JSON.stringify(formattedSemanticExpenses, null, 2)}

[TODAS LAS PROMOCIONES REGISTRADAS]
${JSON.stringify(allPromotions, null, 2)}

[PROMOCIONES RELEVANTES (Búsqueda Semántica)]
${JSON.stringify(semanticPromotions, null, 2)}

[POSICIONES DE INVERSIÓN ACTUALES]
${JSON.stringify(investments, null, 2)}

Reglas de respuesta cruciales (Brevedad absoluta):
1. Responde ÚNICAMENTE a la pregunta exacta del usuario de la forma más directa y concisa posible. No proporciones información que no se te haya pedido.
2. NUNCA agregues resúmenes de datos no solicitados. Por ejemplo, si te preguntan por gastos, no menciones promociones ni inversiones.
3. NUNCA finalices con preguntas de seguimiento, frases de cortesía o sugerencias no solicitadas (ej. evita preguntar "¿Necesitás algo más?" o "¿Querés registrar otro gasto?"). Termina tu respuesta inmediatamente al contestar la duda.
4. Si el usuario te pide eliminar, borrar o cancelar un gasto, busca el ID (UUID) de ese gasto en la lista de [GASTOS RECIENTES] o [GASTOS HISTÓRICOS SIMILARES] y llama de inmediato a la herramienta "delete_expense" con el 'expense_id' correspondiente. No respondas con texto descriptivo del gasto sin borrarlo ni pidas confirmación. Si no encuentras el gasto o hay ambigüedad (múltiples gastos similares), responde al usuario preguntando cuál de ellos desea eliminar, describiéndolos brevemente.
5. Si te piden registrar o guardar un gasto o promoción, llama a la herramienta adecuada de inmediato sin pedir confirmación.
6. Si te piden MODIFICAR o ACTUALIZAR un gasto existente (por ejemplo, "cambiá el monto del café a 5000", "actualizá el último gasto", "eran 4000 no 3000"), busca el ID del gasto correspondiente en contexto y llama a "update_expense" con los campos a modificar. Si el usuario dice algo como "ah eran 4000" o "no, fueron 6000" refiriéndose al gasto recién registrado o mencionado en la conversación, entiende el contexto conversacional y actualiza ese gasto.
7. Si te piden MODIFICAR o ACTUALIZAR una promoción, busca su ID en la lista de [TODAS LAS PROMOCIONES REGISTRADAS] y llama a "update_promotion". Si te piden BORRAR una promoción, usa "delete_promotion".
8. No menciones términos técnicos como "contexto", "búsqueda semántica", "RAG", "JSON" o "herramientas". Habla de forma natural sobre sus registros.
9. Usa formato Markdown limpio (negritas, viñetas) optimizado para voz y pantallas móviles.
10. Si te piden configurar o cambiar el presupuesto mensual, llama a la herramienta "set_budget".
11. ALERTA DE PRESUPUESTO: Cuando registres o actualices un gasto, si el nuevo total del mes supera el 80% del presupuesto, agrega una línea de alerta al final de tu respuesta. Ejemplo: "⚠️ ¡Atención! Llevas $X gastados este mes (85% de tu presupuesto de $Y)." Si supera el 100%, usa: "🚨 ¡Superaste tu presupuesto mensual! Llevas $X de $Y."`;

    // 4. Construir el array de contenido con historial conversacional
    const contents: any[] = [];

    // Agregar historial de conversación previo (máximo últimos 10 mensajes para no exceder contexto)
    if (history && Array.isArray(history)) {
      const recentHistory = history.slice(-10);
      for (const msg of recentHistory) {
        contents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.text }]
        });
      }
    }

    // Agregar el mensaje actual del usuario
    contents.push({
      role: "user",
      parts: [{ text: message }]
    });

    // 5. Enviar la consulta a Gemini con Declaración de Funciones (Tools)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`;
    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        contents,
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
            },
            {
              name: "update_expense",
              description: "Actualiza un gasto financiero existente. Solo se modifican los campos proporcionados; los demás se mantienen sin cambio.",
              parameters: {
                type: "OBJECT",
                properties: {
                  expense_id: { type: "STRING", description: "El ID (UUID) del gasto que se desea actualizar." },
                  monto: { type: "NUMBER", description: "El nuevo monto del gasto en pesos (solo si se desea cambiar)." },
                  categoria: { type: "STRING", description: "La nueva categoría del gasto (solo si se desea cambiar)." },
                  descripcion: { type: "STRING", description: "La nueva descripción del gasto (solo si se desea cambiar)." }
                },
                required: ["expense_id"]
              }
            },
            {
              name: "update_promotion",
              description: "Actualiza una promoción existente. Solo se modifican los campos proporcionados.",
              parameters: {
                type: "OBJECT",
                properties: {
                  promotion_id: { type: "STRING", description: "El ID (UUID) de la promoción que se desea actualizar." },
                  entidad: { type: "STRING", description: "Nuevo nombre de entidad (solo si se desea cambiar)." },
                  descuento_porcentaje: { type: "NUMBER", description: "Nuevo porcentaje de descuento (solo si se desea cambiar)." },
                  tope_reintegro: { type: "NUMBER", description: "Nuevo tope de reintegro (solo si se desea cambiar)." },
                  dias_vigencia: { type: "STRING", description: "Nuevos días de vigencia (solo si se desea cambiar)." }
                },
                required: ["promotion_id"]
              }
            },
            {
              name: "delete_promotion",
              description: "Elimina una promoción específica de la base de datos a partir de su ID (UUID).",
              parameters: {
                type: "OBJECT",
                properties: {
                  promotion_id: { type: "STRING", description: "El ID (UUID) de la promoción que se desea eliminar." }
                },
                required: ["promotion_id"]
              }
            },
            {
              name: "set_budget",
              description: "Configura el presupuesto mensual del usuario.",
              parameters: {
                type: "OBJECT",
                properties: {
                  amount: { type: "NUMBER", description: "El nuevo presupuesto mensual en pesos argentinos." }
                },
                required: ["amount"]
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

        const textToEmbed = `${entidad} ${descuento_porcentaje}% descuento ${dias_vigencia} ${tope_reintegro ? 'tope ' + tope_reintegro : ''}`;
        const promoEmbedding = await generateEmbedding(textToEmbed, geminiApiKey);

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

        reply = `¡Entendido! He registrado la promoción:\n\n* **Entidad:** ${entidad}\n* **Descuento:** ${descuento_porcentaje}%\n* **Vigencia:** ${dias_vigencia}\n${tope_reintegro ? `* **Tope de reintegro:** $${tope_reintegro}\n` : ''}`;

      } else if (name === "insert_expense") {
        const { monto, categoria, descripcion } = args;

        const textToEmbed = `${categoria} ${descripcion || ''} ${monto}`;
        const expEmbedding = await generateEmbedding(textToEmbed, geminiApiKey);

        const { data: insertedExpense, error: expError } = await supabaseClient
          .from('gastos')
          .insert({
            user_id: user.id,
            monto: Number(monto),
            categoria,
            descripcion: descripcion || null,
            embedding: expEmbedding
          })
          .select('id')
          .single();

        if (expError) {
          throw new Error(`Error guardando gasto: ${expError.message}`);
        }

        const newMonthTotal = currentMonthTotal + Number(monto);
        let budgetAlert = '';
        if (monthlyBudget > 0) {
          const pct = (newMonthTotal / monthlyBudget) * 100;
          if (pct >= 100) {
            budgetAlert = `\n\n🚨 **¡Superaste tu presupuesto mensual!** Llevas $${newMonthTotal.toLocaleString('es-AR')} de $${monthlyBudget.toLocaleString('es-AR')}.`;
          } else if (pct >= 80) {
            budgetAlert = `\n\n⚠️ **¡Atención!** Llevas $${newMonthTotal.toLocaleString('es-AR')} gastados este mes (${pct.toFixed(0)}% de tu presupuesto de $${monthlyBudget.toLocaleString('es-AR')}).`;
          }
        }

        reply = `¡Gasto registrado!\n\n* **Monto:** $${monto}\n* **Categoría:** ${categoria}\n* **Detalle:** ${descripcion || 'Sin descripción'}${budgetAlert}`;

      } else if (name === "delete_expense") {
        const { expense_id } = args;

        const { error: deleteError } = await supabaseClient
          .from('gastos')
          .delete()
          .eq('id', expense_id);

        if (deleteError) {
          throw new Error(`Error al eliminar el gasto: ${deleteError.message}`);
        }

        reply = "¡Gasto eliminado con éxito!";

      } else if (name === "update_expense") {
        const { expense_id, monto, categoria, descripcion } = args;

        const updatePayload: Record<string, any> = {};
        if (monto !== undefined) updatePayload.monto = Number(monto);
        if (categoria !== undefined) updatePayload.categoria = categoria;
        if (descripcion !== undefined) updatePayload.descripcion = descripcion;

        // Regenerar embedding con los datos actualizados
        // Primero obtener el gasto actual para combinar campos
        const { data: currentExpense } = await supabaseClient
          .from('gastos')
          .select('monto, categoria, descripcion')
          .eq('id', expense_id)
          .single();

        if (currentExpense) {
          const finalCategoria = categoria || currentExpense.categoria;
          const finalDescripcion = descripcion || currentExpense.descripcion || '';
          const finalMonto = monto || currentExpense.monto;
          const textToEmbed = `${finalCategoria} ${finalDescripcion} ${finalMonto}`;
          const newEmbedding = await generateEmbedding(textToEmbed, geminiApiKey);
          if (newEmbedding) updatePayload.embedding = newEmbedding;
        }

        const { error: updateError } = await supabaseClient
          .from('gastos')
          .update(updatePayload)
          .eq('id', expense_id);

        if (updateError) {
          throw new Error(`Error al actualizar el gasto: ${updateError.message}`);
        }

        const changes = [];
        if (monto !== undefined) changes.push(`**Monto:** $${monto}`);
        if (categoria !== undefined) changes.push(`**Categoría:** ${categoria}`);
        if (descripcion !== undefined) changes.push(`**Detalle:** ${descripcion}`);

        // Verificar presupuesto después del update
        let budgetAlert = '';
        if (monto !== undefined && monthlyBudget > 0) {
          const oldMonto = currentExpense ? Number(currentExpense.monto) : 0;
          const newMonthTotal = currentMonthTotal - oldMonto + Number(monto);
          const pct = (newMonthTotal / monthlyBudget) * 100;
          if (pct >= 100) {
            budgetAlert = `\n\n🚨 **¡Superaste tu presupuesto mensual!** Llevas $${newMonthTotal.toLocaleString('es-AR')} de $${monthlyBudget.toLocaleString('es-AR')}.`;
          } else if (pct >= 80) {
            budgetAlert = `\n\n⚠️ **¡Atención!** Llevas $${newMonthTotal.toLocaleString('es-AR')} gastados este mes (${pct.toFixed(0)}% de tu presupuesto de $${monthlyBudget.toLocaleString('es-AR')}).`;
          }
        }

        reply = `¡Gasto actualizado!\n\n${changes.map(c => `* ${c}`).join('\n')}${budgetAlert}`;

      } else if (name === "update_promotion") {
        const { promotion_id, entidad, descuento_porcentaje, tope_reintegro, dias_vigencia } = args;

        const updatePayload: Record<string, any> = {};
        if (entidad !== undefined) updatePayload.entidad = entidad;
        if (descuento_porcentaje !== undefined) updatePayload.descuento_porcentaje = Number(descuento_porcentaje);
        if (tope_reintegro !== undefined) updatePayload.tope_reintegro = Number(tope_reintegro);
        if (dias_vigencia !== undefined) updatePayload.dias_vigencia = dias_vigencia;

        // Regenerar embedding
        const { data: currentPromo } = await supabaseClient
          .from('promociones')
          .select('entidad, descuento_porcentaje, tope_reintegro, dias_vigencia')
          .eq('id', promotion_id)
          .single();

        if (currentPromo) {
          const finalEntidad = entidad || currentPromo.entidad;
          const finalPct = descuento_porcentaje || currentPromo.descuento_porcentaje;
          const finalTope = tope_reintegro !== undefined ? tope_reintegro : currentPromo.tope_reintegro;
          const finalDias = dias_vigencia || currentPromo.dias_vigencia;
          const textToEmbed = `${finalEntidad} ${finalPct}% descuento ${finalDias} ${finalTope ? 'tope ' + finalTope : ''}`;
          const newEmbedding = await generateEmbedding(textToEmbed, geminiApiKey);
          if (newEmbedding) updatePayload.embedding = newEmbedding;
        }

        const { error: updateError } = await supabaseClient
          .from('promociones')
          .update(updatePayload)
          .eq('id', promotion_id);

        if (updateError) {
          throw new Error(`Error al actualizar la promoción: ${updateError.message}`);
        }

        const changes = [];
        if (entidad !== undefined) changes.push(`**Entidad:** ${entidad}`);
        if (descuento_porcentaje !== undefined) changes.push(`**Descuento:** ${descuento_porcentaje}%`);
        if (tope_reintegro !== undefined) changes.push(`**Tope:** $${tope_reintegro}`);
        if (dias_vigencia !== undefined) changes.push(`**Vigencia:** ${dias_vigencia}`);

        reply = `¡Promoción actualizada!\n\n${changes.map(c => `* ${c}`).join('\n')}`;

      } else if (name === "delete_promotion") {
        const { promotion_id } = args;

        const { error: deleteError } = await supabaseClient
          .from('promociones')
          .delete()
          .eq('id', promotion_id);

        if (deleteError) {
          throw new Error(`Error al eliminar la promoción: ${deleteError.message}`);
        }

        reply = "¡Promoción eliminada con éxito!";

      } else if (name === "set_budget") {
        const { amount } = args;

        // Usar service role para actualizar el perfil (RLS no permite update de budget con anon key si la política no lo cubre)
        const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const adminClient = createClient(supabaseUrl, supabaseServiceRole);

        const { error: budgetError } = await adminClient
          .from('profiles')
          .update({ budget: Number(amount) })
          .eq('id', user.id);

        if (budgetError) {
          throw new Error(`Error al configurar el presupuesto: ${budgetError.message}`);
        }

        reply = `¡Presupuesto mensual actualizado a **$${Number(amount).toLocaleString('es-AR')}**!`;
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
