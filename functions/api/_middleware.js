const NATIVE_ORIGINS = new Set([
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
]);

function nativeCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Tus-Resumable, Upload-Length, Upload-Metadata, Upload-Offset',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export async function onRequest({ request, next }) {
  const origin = request.headers.get('Origin') || '';
  if (!NATIVE_ORIGINS.has(origin)) return next();
  if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:nativeCorsHeaders(origin) });

  const response = await next();
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(nativeCorsHeaders(origin))) headers.set(name, value);
  return new Response(response.body, { status:response.status, statusText:response.statusText, headers });
}
