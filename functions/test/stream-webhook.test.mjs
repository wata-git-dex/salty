import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost, verifyStreamWebhook } from '../api/stream/webhook.js';

async function signature(body, secret, time) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name:'HMAC', hash:'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${time}.${body}`)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

test('Cloudflare Stream webhook accepts the documented time/body HMAC', async () => {
  const body = JSON.stringify({ uid:'abc12345678901234567', readyToStream:true, status:{ state:'ready' } });
  const secret = 'test-webhook-secret';
  const time = 1_800_000_000;
  const sig1 = await signature(body, secret, time);
  assert.equal(await verifyStreamWebhook(body, `time=${time},sig1=${sig1}`, secret, time), true);
});

test('Cloudflare Stream webhook fails closed for tampering and stale requests', async () => {
  const body = JSON.stringify({ uid:'abc12345678901234567', readyToStream:true, status:{ state:'ready' } });
  const secret = 'test-webhook-secret';
  const time = 1_800_000_000;
  const sig1 = await signature(body, secret, time);
  assert.equal(await verifyStreamWebhook(`${body} `, `time=${time},sig1=${sig1}`, secret, time), false);
  assert.equal(await verifyStreamWebhook(body, `time=${time},sig1=${sig1}`, secret, time + 301), false);
  assert.equal(await verifyStreamWebhook(body, '', secret, time), false);
});

function webhookRequest(body, secret, time) {
  return signature(body, secret, time).then(sig1 => new Request('https://community.saltyviewfinder.com/api/stream/webhook', {
    method:'POST',
    headers:{ 'Webhook-Signature':`time=${time},sig1=${sig1}` },
    body,
  }));
}

test('ready webhook publishes only after every linked clip is ready', async () => {
  const realFetch = globalThis.fetch;
  const secret = 'test-webhook-secret';
  const time = Math.floor(Date.now() / 1000);
  const uid = 'ready12345678901234567';
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const value = String(url);
    calls.push({ url:value, method:init.method || 'GET', body:init.body || '' });
    if (value.includes(`post_stream_media?stream_uid=eq.${uid}&select=`)) {
      return Response.json([{ id:'media-1', post_id:'post-1', stream_uid:uid, status:'processing' }]);
    }
    if (value.includes(`post_stream_media?stream_uid=eq.${uid}`) && init.method === 'PATCH') {
      return Response.json([{ id:'media-1', status:'ready' }]);
    }
    if (value.includes('posts?id=eq.post-1&select=')) {
      return Response.json([{ id:'post-1', status:'pending', expected_media_count:2 }]);
    }
    if (value.includes('post_stream_media?post_id=eq.post-1&select=')) {
      return Response.json([{ stream_uid:uid, status:'ready' }, { stream_uid:'ready22345678901234567', status:'ready' }]);
    }
    if (value.includes('posts?id=eq.post-1&status=eq.pending') && init.method === 'PATCH') {
      return new Response(null, { status:204 });
    }
    return Response.json({ error:'unexpected request' }, { status:500 });
  };
  try {
    const body = JSON.stringify({ uid, readyToStream:true, status:{ state:'ready' }, duration:18.4, input:{ width:1280, height:720 } });
    const response = await onRequestPost({ request:await webhookRequest(body, secret, time), env:{ SUPABASE_SERVICE_ROLE_KEY:'service', CF_STREAM_WEBHOOK_SECRET:secret } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'published');
    const publish = calls.find(call => call.url.includes('posts?id=eq.post-1&status=eq.pending') && call.method === 'PATCH');
    assert.ok(publish);
    assert.deepEqual(JSON.parse(publish.body).status, 'published');
  } finally { globalThis.fetch = realFetch; }
});

test('processing failure remains private and becomes an author-visible failed post', async () => {
  const realFetch = globalThis.fetch;
  const secret = 'test-webhook-secret';
  const time = Math.floor(Date.now() / 1000);
  const uid = 'failed1234567890123456';
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const value = String(url);
    calls.push({ url:value, method:init.method || 'GET', body:init.body || '' });
    if (value.includes(`post_stream_media?stream_uid=eq.${uid}&select=`)) {
      return Response.json([{ id:'media-1', post_id:'post-1', stream_uid:uid, status:'processing' }]);
    }
    if (value.includes(`post_stream_media?stream_uid=eq.${uid}`) && init.method === 'PATCH') {
      return Response.json([{ id:'media-1', status:'error' }]);
    }
    if (value.includes('posts?id=eq.post-1&status=in.(pending,failed)') && init.method === 'PATCH') {
      return new Response(null, { status:204 });
    }
    return Response.json({ error:'unexpected request' }, { status:500 });
  };
  try {
    const body = JSON.stringify({ uid, readyToStream:false, status:{ state:'error', errReasonText:'Unsupported video data' } });
    const response = await onRequestPost({ request:await webhookRequest(body, secret, time), env:{ SUPABASE_SERVICE_ROLE_KEY:'service', CF_STREAM_WEBHOOK_SECRET:secret } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'failed');
    const failed = calls.find(call => call.url.includes('posts?id=eq.post-1&status=in.(pending,failed)') && call.method === 'PATCH');
    assert.ok(failed);
    assert.deepEqual(JSON.parse(failed.body).status, 'failed');
  } finally { globalThis.fetch = realFetch; }
});
