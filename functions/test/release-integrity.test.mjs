import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => readFileSync(resolve(root, file), 'utf8');
const html = read('index.html');
const app = read('app.js');
const worker = read('sw.js');
const sessionChatMigration = read('supabase/session-chat-v1-migration.sql');
const apiMiddleware = read('functions/api/_middleware.js');

test('HTML IDs are unique and hard JavaScript selectors resolve', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, []);

  const dynamicIds = new Set(['clipReadyAlert', 'notificationTestButton']);
  const selectors = [...app.matchAll(/\$\(['"]#([A-Za-z][\w:-]*)['"]/g)].map(match => match[1]);
  const missing = [...new Set(selectors.filter(id => !ids.includes(id) && !dynamicIds.has(id)))];
  assert.deepEqual(missing, []);
});

test('every static action and form is routed', () => {
  const actions = [...new Set([...html.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]))];
  const actionMap = new Set([...app.matchAll(/^\s{4}['"`]([^'"`]+)['"`]:/gm)].map(match => match[1]));
  assert.deepEqual(actions.filter(action => !actionMap.has(action)), []);

  const forms = [...html.matchAll(/<form\s+id="([^"]+)"/g)].map(match => match[1]);
  const handled = new Set([...app.matchAll(/event\.target\.id === ['"]([^'"]+)['"]/g)].map(match => match[1]));
  assert.deepEqual(forms.filter(form => !handled.has(form)), []);
});

test('offline shell contains real files and never intercepts APIs', () => {
  const shellBlock = worker.match(/const SHELL = \[(.*?)\];/s)?.[1] || '';
  const shellPaths = [...shellBlock.matchAll(/['"](\.\/[^'"]+)['"]/g)]
    .map(match => match[1].split('?')[0])
    .filter(path => path !== './');
  const guidePaths = Array.from({ length:4 }, (_, index) => `./docs/guide-v14/page-${String(index + 1).padStart(2, '0')}.jpg`);
  const missing = [...shellPaths, ...guidePaths].filter(path => !existsSync(resolve(root, path)));
  assert.deepEqual(missing, []);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)\) return/);
  assert.equal([...worker.matchAll(/caches\.match\('\.\/index\.html'\)/g)].length, 1);
});

test('release labels, cache busting, and Stoke limits stay aligned', () => {
  const version = app.match(/const APP_VERSION = '([^']+)'/)?.[1];
  assert.ok(version);
  const escapedVersion = version.replace('.', '\\.');
  assert.match(html, new RegExp(`boot-credit[^>]*>[^<]*v${escapedVersion}`));
  assert.match(html, new RegExp(`NEW IN V${escapedVersion}`));
  const assetVersion = html.match(/app\.js\?v=([^"']+)/)?.[1];
  assert.ok(assetVersion);
  assert.match(worker, new RegExp(`sodium-shell-v${assetVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(worker, new RegExp(`app\\.js\\?v=${assetVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(html, /<b>Clips<\/b><small>up to 5 · 5 min each<\/small>/);

  const postSheet = html.match(/<section id="postSheet"[\s\S]*?<section id="eventSheet"/)?.[0] || '';
  assert.doesNotMatch(postSheet, /data-open-post-draft|postDraftsPanel/);
});

test('finished Now sessions display their recorded date instead of a permanent Now label', () => {
  assert.match(app, /const liveNow = session\.when_label === 'Now' && !isPastSession\(session\)/);
  assert.match(app, /session\.surf_time \|\| session\.started_at \|\| session\.ended_at \|\| session\.created_at/);
});

test('session chat stays tied to the surf crew across UI, RLS, and realtime', () => {
  assert.match(html, /id="view-session-chat"/);
  assert.match(html, /id="sessionChatThreads"/);
  assert.match(app, /function sessionChatParticipantIds/);
  assert.match(app, /data-session-chat=/);
  assert.match(app, /table: 'session_messages'/);
  assert.match(sessionChatMigration, /create table if not exists public\.session_messages/);
  assert.match(sessionChatMigration, /public\.is_session_chat_member\(session_id\)/);
  assert.match(sessionChatMigration, /session\.author = auth\.uid\(\)/);
  assert.match(sessionChatMigration, /rsvp\.user_id = auth\.uid\(\)/);
  assert.match(sessionChatMigration, /alter publication supabase_realtime add table public\.session_messages/);
});

test('large Stream uploads recover stale sessions and tolerate mobile interruptions', () => {
  assert.match(app, /const STREAM_UPLOAD_SESSION_TTL = 6 \* 60 \* 60 \* 1000/);
  assert.match(app, /const STREAM_UPLOAD_RETRY_DELAYS = Object\.freeze/);
  assert.match(app, /status === 412/);
  assert.match(app, /status === 425/);
  assert.match(app, /staleUpload = \[401, 403, 404, 410\]/);
  assert.match(app, /starting a fresh upload automatically/);
  assert.match(app, /navigator\.wakeLock\.request\('screen'\)/);
  assert.match(app, /chunkSize:5 \* 1024 \* 1024/);
});

test('native Sodium routes protected APIs to production and compresses before Stream upload', () => {
  assert.match(app, /const NATIVE_APP = location\.protocol === 'capacitor:' \|\| Boolean\(globalThis\.Capacitor\?\.isNativePlatform/);
  assert.match(app, /const API_ORIGIN = NATIVE_APP \? 'https:\/\/community\.saltyviewfinder\.com' : ''/);
  assert.match(app, /flowType: NATIVE_APP \? 'pkce' : 'implicit'/);
  assert.match(app, /return new URL\('sodium:\/\/auth'\)/);
  assert.match(app, /exchangeCodeForSession\(authorizationCode\)/);
  assert.match(app, /registerPlugin\('SodiumMedia'\)/);
  assert.match(app, /pickAndCompressVideos/);
  assert.match(app, /Compressed on this iPhone\. Ready to upload\./);
  assert.match(app, /new URL\('sodium:\/\/auth'\)/);
  assert.match(app, /addListener\('appUrlOpen', event =>/);
  assert.match(apiMiddleware, /capacitor:\/\/localhost/);
  assert.match(apiMiddleware, /request\.method === 'OPTIONS'/);
});

test('native refresh uses one system trigger and respects full-screen overlays', () => {
  const nativeController = read('ios/App/App/AppDelegate.swift');
  const capacitorConfig = read('capacitor.config.json');
  assert.match(nativeController, /sodiumRefreshControl\.addTarget\(self, action: #selector\(refreshSodium\), for: \.valueChanged\)/);
  assert.doesNotMatch(nativeController, /handleRefreshPan|sodiumRefreshArmed|setContentOffset/);
  assert.match(nativeController, /#guideViewer:not\(\.hidden\)/);
  assert.match(capacitorConfig, /"contentInset": "never"/);
});

test('clip posting is clearly paused without disabling photo posting or existing media', () => {
  assert.match(html, /id="clipPostingNotice"/);
  assert.match(app, /const CLIP_POSTING_TEMPORARILY_PAUSED = true/);
  assert.match(app, /selectedPostKind\(\) === 'clip'/);
  assert.match(app, /for \(let index = 0; index < files\.length; index \+= 1\)[\s\S]*await uploadMedia\(selected, path\)/);
  assert.doesNotMatch(html.match(/<input id="mediaFile"[^>]+>/)?.[0] || '', /disabled/);
});
