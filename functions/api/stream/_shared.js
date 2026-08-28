const SUPABASE_URL = 'https://maihhnwrstewzapsvrec.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_YtVKcZqgPalUaYOHpoSV1w_86he5PDV';

function supabaseHeaders(key, extraHeaders = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
}

export function json(payload, status = 200, extraHeaders = {}) {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

export async function requireSodiumMember(request) {
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw new Response('Authentication required', { status:401 });

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: authorization,
    },
  });
  if (!response.ok) throw new Response('Invalid or expired session', { status:401 });
  const user = await response.json();

  const member = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&onboarding_complete=eq.true&select=id`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: authorization,
    },
  });
  if (!member.ok) throw new Response('Could not verify membership', { status:502 });
  const rows = await member.json();
  if (!Array.isArray(rows) || !rows.length) throw new Response('Community membership required', { status:403 });
  return user;
}

export async function serviceSupabase(env, path, init = {}) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Response('Server database access is not configured', { status:503 });
  }
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: supabaseHeaders(env.SUPABASE_SERVICE_ROLE_KEY, init.headers),
  });
}

export async function readServiceJson(response, fallback) {
  const text = await response.text();
  if (!text) return fallback;
  try { return JSON.parse(text); }
  catch (_error) { return fallback; }
}

export function streamApi(env, path, init = {}) {
  if (!env.CF_ACCOUNT_ID || !env.CF_STREAM_API_TOKEN) {
    throw new Response('Cloudflare Stream is not configured yet', { status:503 });
  }
  return fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}`,
      ...(init.headers || {}),
    },
  });
}

export async function streamVideo(env, uid) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(uid)) throw new Response('Invalid video ID', { status:400 });
  const response = await streamApi(env, `/${uid}`);
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Response(payload.errors?.[0]?.message || 'Stream video unavailable', { status:response.status || 502 });
  return payload.result;
}

export function publicVideo(video) {
  const preview = typeof video.preview === 'string' ? video.preview : '';
  return {
    uid: video.uid,
    creator: video.creator || '',
    duration: Number(video.duration) || null,
    width: Number(video.input?.width) || null,
    height: Number(video.input?.height) || null,
    ready: Boolean(video.readyToStream),
    state: video.status?.state || 'processing',
    progress: Number(video.status?.pctComplete) || 0,
    error: video.status?.errorReasonText || '',
    previewUrl: preview,
    iframeUrl: preview ? preview.replace(/\/watch(?:\?.*)?$/, '/iframe') : '',
    thumbnailUrl: video.thumbnail || '',
  };
}
