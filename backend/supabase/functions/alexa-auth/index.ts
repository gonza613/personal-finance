import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SECRET = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "default-secret-fallback-32-chars-long";

/**
 * Encripta un texto de manera simétrica usando AES-GCM con la clave de Supabase
 */
async function encrypt(text: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET.slice(0, 32)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    keyMaterial,
    enc.encode(text)
  );
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv);
  result.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...result));
}

/**
 * Desencripta el código seguro para recuperar los tokens originales
 */
async function decrypt(encryptedBase64: string): Promise<string> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const raw = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const data = raw.slice(12);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET.slice(0, 32)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    keyMaterial,
    data
  );
  return dec.decode(decrypted);
}

serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

  // Manejo de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // --- ENDPOINT: Intercambio de Código por Tokens (POST /token) ---
  if (req.method === 'POST' && path.endsWith('/token')) {
    try {
      const contentType = req.headers.get("content-type") || "";
      let code = "";
      
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const bodyText = await req.text();
        const params = new URLSearchParams(bodyText);
        code = params.get("code") || "";
      } else {
        const bodyJson = await req.json();
        code = bodyJson.code || "";
      }

      if (!code) {
        return new Response(JSON.stringify({ error: "invalid_request", error_description: "Missing code parameter" }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const decrypted = await decrypt(code);
      const { accessToken, refreshToken } = JSON.parse(decrypted);

      const tokenResponse = {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "Bearer",
        expires_in: 3600
      };

      return new Response(JSON.stringify(tokenResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (err) {
      console.error("Error en intercambio de token:", err);
      return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid authorization code" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // --- ENDPOINT: Procesamiento del Formulario de Login (POST /) ---
  if (req.method === 'POST') {
    let email = "";
    let password = "";
    let clientId = "";
    let redirectUri = "";
    let state = "";

    try {
      const bodyText = await req.text();
      const params = new URLSearchParams(bodyText);
      email = params.get("email") || "";
      password = params.get("password") || "";
      clientId = params.get("client_id") || "";
      redirectUri = params.get("redirect_uri") || "";
      state = params.get("state") || "";

      if (!email || !password || !redirectUri) {
        throw new Error("Faltan parámetros obligatorios.");
      }

      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error || !data.session) {
        throw new Error(error?.message || "No se pudo iniciar sesión.");
      }

      const codeData = JSON.stringify({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token
      });
      const encryptedCode = await encrypt(codeData);

      const redirectUrl = `${redirectUri}?code=${encodeURIComponent(encryptedCode)}&state=${encodeURIComponent(state)}`;
      console.log("Redirección exitosa a Alexa.");

      return new Response("", {
        status: 302,
        headers: {
          "Location": redirectUrl
        }
      });

    } catch (err: any) {
      console.error("Error al procesar el login:", err.message);
      const loginUrlBase = Deno.env.get("ALEXA_LOGIN_URL") || "";
      if (!loginUrlBase) {
        return new Response("Error: La variable de entorno ALEXA_LOGIN_URL no está configurada.", { status: 500 });
      }
      // Redirigir de vuelta al Login externo con el parámetro de error
      const errorLoginUrl = `${loginUrlBase}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&error=${encodeURIComponent(err.message || "Error al autenticar")}`;
      return new Response("", {
        status: 302,
        headers: {
          "Location": errorLoginUrl
        }
      });
    }
  }

  // --- ENDPOINT: Redirigir al Login externo (GET /) ---
  if (req.method === 'GET') {
    const clientId = url.searchParams.get("client_id") || "";
    const redirectUri = url.searchParams.get("redirect_uri") || "";
    const state = url.searchParams.get("state") || "";

    if (!redirectUri) {
      return new Response("Error: Falta el parámetro redirect_uri.", { status: 400 });
    }

    const loginUrlBase = Deno.env.get("ALEXA_LOGIN_URL") || "";
    if (!loginUrlBase) {
      return new Response("Error: La variable de entorno ALEXA_LOGIN_URL no está configurada en Supabase.", { status: 500 });
    }

    const loginUrl = `${loginUrlBase}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    console.log("Redirigiendo cliente a Vercel:", loginUrl);

    return new Response("", {
      status: 302,
      headers: {
        "Location": loginUrl
      }
    });
  }

  return new Response("No encontrado", { status: 404 });
})
