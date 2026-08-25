import assert from 'node:assert/strict';
import test from 'node:test';
import { publicVideo } from '../api/stream/_shared.js';

test('publicVideo exposes only playback-safe fields', () => {
  const result = publicVideo({
    uid:'abc123', creator:'member-1', duration:12.5, readyToStream:true,
    status:{ state:'ready', pctComplete:'100' },
    preview:'https://customer.example/abc123/watch', thumbnail:'https://customer.example/abc123/thumb.jpg',
    secret:'never-return-this',
  });
  assert.equal(result.iframeUrl, 'https://customer.example/abc123/iframe');
  assert.equal(result.ready, true);
  assert.equal(result.secret, undefined);
});
