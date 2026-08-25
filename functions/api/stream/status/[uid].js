import { json, publicVideo, requireSodiumMember, streamVideo } from '../_shared.js';

export async function onRequestGet({ request, env, params }) {
  try {
    await requireSodiumMember(request);
    return json(publicVideo(await streamVideo(env, String(params.uid || ''))));
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not check this clip.' }, 500);
  }
}
