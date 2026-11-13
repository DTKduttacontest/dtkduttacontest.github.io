export const corsHeaders = {
  "Access-Control-Allow-Origin": "https://dtkduttacontest.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
};

export function optionsResponse() {
  return new Response("ok", { headers: corsHeaders });
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function error(message: string, status = 400) {
  return json({ error: message }, status);
}

export async function requestJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Expected a JSON request body.");
  }
}
