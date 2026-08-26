async function runSync(env) {
  if (!env.CLIP_SYNC_SECRET) throw new Error('CLIP_SYNC_SECRET is missing');
  const response = await fetch(env.SYNC_ENDPOINT, {
    method:'POST',
    headers:{ 'X-Sodium-Sync-Secret':env.CLIP_SYNC_SECRET },
  });
  if (!response.ok) throw new Error(`Sodium clip sync returned ${response.status}`);
  return response.json();
}

export default {
  async scheduled(_controller, env, context) {
    context.waitUntil(runSync(env));
  },
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/health') return Response.json({ ok:true, service:'sodium-clip-sync' });
    return new Response('Not found', { status:404 });
  },
};
