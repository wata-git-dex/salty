import { json, readServiceJson, requireSodiumMember, serviceSupabase, streamApi } from './_shared.js';

const MAX_CLIP_BYTES = 1024 * 1024 * 1024;
const MAX_CLIP_SECONDS = 5 * 60;

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireSodiumMember(request);
    const body = await request.json();
    const size = Number(body.size);
    const filename = String(body.filename || 'sodium-clip.mp4').slice(0, 180);
    const postId = String(body.postId || '');
    const position = Number(body.position);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(postId)) {
      return json({ error:'A valid pending post is required before uploading.' }, 400);
    }
    if (!Number.isInteger(position) || position < 0 || position > 4) {
      return json({ error:'Clip position must be between 0 and 4.' }, 400);
    }
    if (!Number.isInteger(size) || size < 1 || size > MAX_CLIP_BYTES) {
      return json({ error:'Each clip must be 1 GB or smaller.' }, 400);
    }

    const postResponse = await serviceSupabase(env,
      `posts?id=eq.${encodeURIComponent(postId)}&author=eq.${encodeURIComponent(user.id)}&media_type=eq.clip&select=id,status,expected_media_count`);
    const posts = await readServiceJson(postResponse, []);
    if (!postResponse.ok) return json({ error:'Could not verify the pending post.' }, 502);
    const post = Array.isArray(posts) ? posts[0] : null;
    if (!post || !['pending', 'failed'].includes(post.status) || position >= Number(post.expected_media_count)) {
      return json({ error:'This upload does not belong to an editable pending post.' }, 409);
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


    const existingResponse = await serviceSupabase(env,
      `post_stream_media?post_id=eq.${encodeURIComponent(postId)}&position=eq.${position}&select=stream_uid`);
    const existingRows = await readServiceJson(existingResponse, []);
    const previousUid = Array.isArray(existingRows) ? existingRows[0]?.stream_uid : null;

    const linkedResponse = await serviceSupabase(env,
      'post_stream_media?on_conflict=post_id,position', {
        method:'POST',
        headers:{ Prefer:'resolution=merge-duplicates,return=representation' },
        body:JSON.stringify({
          post_id:postId,
          creator:user.id,
          position,
          stream_uid:uid,
          status:'uploading',
          duration_seconds:null,
          input_width:null,
          input_height:null,
          preview_url:null,
          thumbnail_url:null,
          error_message:null,
          updated_at:new Date().toISOString(),
        }),
      });
    if (!linkedResponse.ok) {
      await streamApi(env, `/${encodeURIComponent(uid)}`, { method:'DELETE' }).catch(() => {});
      const detail = await linkedResponse.text();
      return json({ error:'Cloudflare started the upload, but Sodium could not attach it to the post.', detail:detail.slice(0, 300) }, 502);
    }

    if (post.status === 'failed') {
      const resetResponse = await serviceSupabase(env, `posts?id=eq.${encodeURIComponent(postId)}&author=eq.${encodeURIComponent(user.id)}&status=eq.failed`, {
        method:'PATCH',
        headers:{ Prefer:'return=minimal' },
        body:JSON.stringify({ status:'pending', publish_error:null, updated_at:new Date().toISOString() }),
      });
      if (!resetResponse.ok) {
        await streamApi(env, `/${encodeURIComponent(uid)}`, { method:'DELETE' }).catch(() => {});
        return json({ error:'Sodium could not reopen this failed post for a retry.' }, 502);
      }
    }

    if (previousUid && previousUid !== uid) {
      await streamApi(env, `/${encodeURIComponent(previousUid)}`, { method:'DELETE' }).catch(() => {});
    }
    return json({ uploadUrl:location, uid, maxClipSeconds:MAX_CLIP_SECONDS, maxClipBytes:MAX_CLIP_BYTES }, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not start this upload.' }, 500);
  }
}
