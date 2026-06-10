import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8"

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  console.log("Conectando a Supabase:", supabaseUrl);
  
  // Listar todas las tablas
  const { data: tables, error: tablesError } = await supabase.rpc('get_tables_info', {});
  if (tablesError) {
    // Si la función RPC no existe, podemos consultar la lista de tablas a través de una consulta directa
    console.log("RPC get_tables_info falló, intentando consultar pg_catalog...");
  } else {
    console.log("Tablas encontradas via RPC:", tables);
    return;
  }

  // Intentar consultar el esquema con query SQL si es posible
  // Pero Supabase JS no permite SQL directo de manera nativa sin RPC, por lo que podemos hacer una consulta básica 
  // a posibles tablas comunes o consultar las promociones, gastos, inversiones, y ver si podemos hacer una inserción / selección 
  // para verificar si existen tablas llamadas 'tickets', 'productos', 'compras', 'supermercados', etc.
  
  const tablesToTest = ['tickets', 'productos', 'compras', 'supermercados', 'items_compra', 'ticket_items', 'super_precios'];
  for (const table of tablesToTest) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.log(`Tabla '${table}' - Error: ${error.message} (Código: ${error.code})`);
    } else {
      console.log(`Tabla '${table}' - ¡EXISTE! Encontrados:`, data);
      
      // Intentar obtener las columnas de la tabla
      if (data.length > 0) {
        console.log(`Columnas de '${table}':`, Object.keys(data[0]));
      } else {
        // Consultar con limit 0 o ver estructura
        console.log(`Tabla '${table}' existe pero está vacía.`);
      }
    }
  }
}

run();
