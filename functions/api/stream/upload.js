import { json, requireSodiumMember, streamApi } from './_shared.js';

const MAX_CLIP_BYTES = 1024 * 1024 * 1024;
const MAX_CLIP_SECONDS = 90;

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireSodiumMember(request);
    const body = await request.json();
    const size = Number(body.size);
    const filename = String(body.filename || 'sodium-clip.mp4').slice(0, 180);
    if (!Number.isInteger(size) || size < 1 || size > MAX_CLIP_BYTES) {
      return json({ error:'Each clip must be 1 GB or smaller.' }, 400);
    }

    const metadata = [
      `name ${btoa(unescape(encodeURIComponent(filename)))}`,
      `maxdurationseconds ${btoa(String(MAX_CLIP_SECONDS))}`,
      `allowedorigins ${btoa('community.saltyviewfinder.com')}`,
    ].join(',');

    const response = await streamApi(env, '?direct_user=true', {
      method: 'POST',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(size),
        'Upload-Creator': user.id,
        'Upload-Metadata': metadata,
      },
    });
    const location = response.headers.get('Location');
    const uid = response.headers.get('Stream-Media-ID');
    if (!response.ok || !location || !uid) {
      const detail = await response.text();
      return json({ error:'Cloudflare could not start this upload.', detail:detail.slice(0, 300) }, response.status || 502);
    }
    return json({ uploadUrl:location, uid, maxClipSeconds:MAX_CLIP_SECONDS, maxClipBytes:MAX_CLIP_BYTES }, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not start this upload.' }, 500);
  }
}
