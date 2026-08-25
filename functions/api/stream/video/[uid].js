import { json, requireSodiumMember, streamApi, streamVideo } from '../_shared.js';

export async function onRequestDelete({ request, env, params }) {
  try {
    const user = await requireSodiumMember(request);
    const uid = String(params.uid || '');
    const video = await streamVideo(env, uid);
    if (video.creator !== user.id) return json({ error:'Only the uploader can delete this clip.' }, 403);
    const response = await streamApi(env, `/${uid}`, { method:'DELETE' });
    if (!response.ok) return json({ error:'Cloudflare could not delete this clip.' }, response.status || 502);
    return json({ deleted:true });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not delete this clip.' }, 500);
  }
}
