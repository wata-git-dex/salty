import { json, readServiceJson, serviceSupabase } from './_shared.js';

const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;
const UID_PATTERN = /^[A-Za-z0-9_-]{20,80}$/;

function parseSignatureHeader(value) {
  const fields = String(value || '').split(',').map(part => part.trim()).filter(Boolean);
  const timeField = fields.find(part => part.startsWith('time='));
  const signatures = fields.filter(part => part.startsWith('sig1=')).map(part => part.slice(5).toLowerCase());
  const time = Number(timeField?.slice(5));
  if (!Number.isInteger(time) || !signatures.length || signatures.some(signature => !/^[0-9a-f]{64}$/.test(signature))) return null;
  return { time, signatures };
}

function hexBytes(hex) {
  const output = new Uint8Array(hex.length / 2);
  for (let index = 0; index < output.length; index += 1) output[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return output;
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function verifyStreamWebhook(rawBody, signatureHeader, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed || !secret || Math.abs(nowSeconds - parsed.time) > MAX_SIGNATURE_AGE_SECONDS) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name:'HMAC', hash:'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parsed.time}.${rawBody}`)));
  return parsed.signatures.some(signature => constantTimeEqual(digest, hexBytes(signature)));
}

async function updateMedia(env, streamUid, values) {
  return serviceSupabase(env, `post_stream_media?stream_uid=eq.${encodeURIComponent(streamUid)}`, {
    method:'PATCH',
    headers:{ Prefer:'return=representation' },
    body:JSON.stringify({ ...values, updated_at:new Date().toISOString() }),
  });
}

async function failPost(env, media, message) {
  const mediaResponse = await updateMedia(env, media.stream_uid, { status:'error', error_message:message });
  if (!mediaResponse.ok) return mediaResponse;
  return serviceSupabase(env, `posts?id=eq.${encodeURIComponent(media.post_id)}&status=in.(pending,failed)`, {
    method:'PATCH',
    headers:{ Prefer:'return=minimal' },
    body:JSON.stringify({ status:'failed', publish_error:message, updated_at:new Date().toISOString() }),
  });
}

export async function onRequestPost({ request, env }) {
  const rawBody = await request.text();
  const verified = await verifyStreamWebhook(
    rawBody,
    request.headers.get('Webhook-Signature'),
    env.CF_STREAM_WEBHOOK_SECRET,
  );
  if (!verified) return json({ error:'Invalid webhook signature.' }, 401);

  let event;
  try { event = JSON.parse(rawBody); }
  catch (_error) { return json({ error:'Invalid webhook body.' }, 400); }
  const streamUid = String(event.uid || '');
  if (!UID_PATTERN.test(streamUid)) return json({ error:'Invalid video ID.' }, 400);

  const mediaResponse = await serviceSupabase(env,
    `post_stream_media?stream_uid=eq.${encodeURIComponent(streamUid)}&select=id,post_id,stream_uid,status`);
  const mediaRows = await readServiceJson(mediaResponse, []);
  if (!mediaResponse.ok) return json({ error:'Could not resolve Stream media.' }, 502);
  const media = Array.isArray(mediaRows) ? mediaRows[0] : null;
  if (!media) return json({ ok:true, ignored:true });

  const streamState = String(event.status?.state || '');
  const errorMessage = String(event.status?.errReasonText || event.status?.errorReasonText || event.status?.errReasonCode || 'Cloudflare could not process this clip.').slice(0, 500);
  if (streamState === 'error') {
    const failed = await failPost(env, media, errorMessage);
    if (!failed.ok) return json({ error:'Could not record Stream processing failure.' }, 502);
    return json({ ok:true, status:'failed' });
  }

  if (!event.readyToStream || streamState !== 'ready') {
    return json({ ok:true, status:'processing' }, 202);
  }

  const readyResponse = await updateMedia(env, streamUid, {
    status:'ready',
    duration_seconds:Number(event.duration) || null,
    input_width:Number(event.input?.width) || null,
    input_height:Number(event.input?.height) || null,
    preview_url:typeof event.preview === 'string' ? event.preview : null,
    thumbnail_url:typeof event.thumbnail === 'string' ? event.thumbnail : null,
    error_message:null,
  });
  if (!readyResponse.ok) return json({ error:'Could not mark Stream media ready.' }, 502);

  const postResponse = await serviceSupabase(env,
    `posts?id=eq.${encodeURIComponent(media.post_id)}&select=id,status,expected_media_count`);
  const posts = await readServiceJson(postResponse, []);
  const post = Array.isArray(posts) ? posts[0] : null;
  if (!post || post.status !== 'pending') return json({ ok:true, status:post?.status || 'missing' });

  const allMediaResponse = await serviceSupabase(env,
    `post_stream_media?post_id=eq.${encodeURIComponent(media.post_id)}&select=stream_uid,status`);
  const allMedia = await readServiceJson(allMediaResponse, []);
  if (!allMediaResponse.ok || !Array.isArray(allMedia)) return json({ error:'Could not verify all post media.' }, 502);
  const expected = Number(post.expected_media_count);
  const allReady = expected > 0 && allMedia.length === expected && allMedia.every(item => item.status === 'ready');
  if (!allReady) return json({ ok:true, status:'processing', ready:allMedia.filter(item => item.status === 'ready').length, expected });

  const publishedResponse = await serviceSupabase(env,
    `posts?id=eq.${encodeURIComponent(media.post_id)}&status=eq.pending`, {
      method:'PATCH',
      headers:{ Prefer:'return=minimal' },
      body:JSON.stringify({ status:'published', publish_error:null, updated_at:new Date().toISOString() }),
    });
  if (!publishedResponse.ok) return json({ error:'Could not publish the completed post.' }, 502);
  return json({ ok:true, status:'published' });
}
