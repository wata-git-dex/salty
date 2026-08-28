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
const xcodeProject = read('ios/App/App.xcodeproj/project.pbxproj');
const sessionChatMigration = read('supabase/session-chat-v1-migration.sql');
const clipReceiptMigration = read('supabase/clip-delivery-receipts-v1-migration.sql');
const sessionLifecycleMigration = read('supabase/session-lifecycle-v1-migration.sql');
const sessionAttendanceMigration = read('supabase/session-attendance-v1-migration.sql');
const sessionCrewTransactionMigration = read('supabase/session-crew-transaction-v1-migration.sql');
const apiMiddleware = read('functions/api/_middleware.js');
const streamUpload = read('functions/api/stream/upload.js');
const streamWebhook = read('functions/api/stream/webhook.js');
const streamPublishMigration = read('supabase/stoke-server-publish-v1-migration.sql');

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
  const nativeVersions = [...xcodeProject.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(match => match[1]);
  assert.ok(nativeVersions.length >= 2);
  assert.deepEqual([...new Set(nativeVersions)], [version]);
  const nativeBuilds = [...xcodeProject.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map(match => Number(match[1]));
  assert.ok(nativeBuilds.length >= 2 && nativeBuilds.every(build => build > 1));
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

test('past sessions use a separate no-reward logging path', () => {
  assert.match(html, /id="sessionModeSheet"/);
  assert.match(html, /data-action="open-session-plan"/);
  assert.match(html, /data-action="open-session-past"/);
  assert.match(app, /const loggingPast = !state\.editingSessionId && state\.sessionEntryMode === 'past'/);
  assert.match(app, /if \(loggingPast\) \{[\s\S]*payload\.status = 'ended';[\s\S]*payload\.ended_at = savedSurfTime;/);
  assert.match(app, /started_at: loggingPast \? null : startedAt/);
  assert.doesNotMatch(app.match(/if \(loggingPast\) \{[\s\S]*?\n    \}/)?.[0] || '', /points_awarded_at|streak/);
});

test('existing-member login ignores stale one-time invite codes', () => {
  assert.match(app, /if \(!isNew\) \{[\s\S]*state\.pendingInvite = '';[\s\S]*localStorage\.removeItem\('salty:invite'\)/);
  assert.match(app, /if \(profile\) \{[\s\S]*localStorage\.removeItem\('salty:invite'\);[\s\S]*\} else if \(state\.pendingInvite\) \{/);
  assert.match(app, /if \(!profile\) \{[\s\S]*This account is not in the community/);
});

test('active sessions have one Start/Finish lifecycle with linked-crew alerts', () => {
  assert.match(html, /id="activeSessionDock"/);
  assert.match(app, /function activeSessionForCurrentMember/);
  assert.match(app, /data-open-active-session/);
  assert.match(app, /reminder_sent_at:null/);
  assert.match(html, /Who actually showed up\?/);
  assert.match(app, /function openFinishSession/);
  assert.match(app, /It stays here through today/);
  assert.match(sessionAttendanceMigration, /public\.finish_session/);
  assert.match(sessionAttendanceMigration, /attendance_status='confirmed'/);
  assert.doesNotMatch(app, /pauseSession|Pause session/);
  assert.match(sessionLifecycleMigration, /public\.add_session_member/);
  assert.match(sessionLifecycleMigration, /selected_user is distinct from actor/);
  assert.match(sessionLifecycleMigration, /finished the surf/);
  assert.match(sessionLifecycleMigration, /started the surf/);
  assert.match(sessionLifecycleMigration, /Still surfing\?/);
  assert.match(sessionLifecycleMigration, /sodium-active-session-reminders/);
  assert.match(sessionLifecycleMigration, /new\.when_label = 'Logged'/);
});

test('session identity is explicit and session plus crew save atomically', () => {
  assert.match(app, /sessionParticipants: \[\]/);
  assert.doesNotMatch(app, /state\.sessionPeople|state\.sessionLinkedPeople/);
  assert.match(app, /kind:'member',userId:person\.id,name:person\.name/);
  assert.match(app, /kind:'guest',name,role:'surf'/);
  assert.match(app, /Link “\$\{guest\.name\}” to \$\{identity\}\?/);
  assert.match(app, /This replaces the guest text with this exact Sodium account/);
  assert.match(app, /db\.rpc\('save_session_with_crew'/);
  assert.doesNotMatch(app, /db\.rpc\('add_session_member'/);
  assert.match(sessionCrewTransactionMigration, /create or replace function public\.save_session_with_crew/);
  assert.match(sessionCrewTransactionMigration, /for update/);
  assert.match(sessionCrewTransactionMigration, /participant_names=cleaned_guests/);
  assert.match(sessionCrewTransactionMigration, /delete from public\.session_rsvps/);
  assert.match(sessionCrewTransactionMigration, /on conflict\(session_id,user_id\) do update/);
  assert.doesNotMatch(sessionCrewTransactionMigration, /normalized_name|join public\.profiles[\s\S]{0,100}lower/);
});

test('session chat stays tied to the surf crew across UI, RLS, and realtime', () => {
  assert.match(html, /id="view-session-chat"/);
  assert.match(html, /id="sessionChatThreads"/);
  assert.match(app, /function sessionChatParticipantIds/);
  assert.match(app, /data-session-chat=/);
  assert.match(app, /const showSessionChat = canAccessSessionChat\(session\);/);
  assert.match(app, /data-session-actions=/);
  assert.match(app, /function openSessionActions\(sessionId\)/);
  assert.doesNotMatch(app, /<div class="card-actions">\$\{actions\}/);
  assert.match(app, /table: 'session_messages'/);
  assert.match(sessionChatMigration, /create table if not exists public\.session_messages/);
  assert.match(sessionChatMigration, /public\.is_session_chat_member\(session_id\)/);
  assert.match(sessionChatMigration, /session\.author = auth\.uid\(\)/);
  assert.match(sessionChatMigration, /rsvp\.user_id = auth\.uid\(\)/);
  assert.match(sessionChatMigration, /alter publication supabase_realtime add table public\.session_messages/);
});

test('clip receipts are recipient-authorized and never claim external downloads', () => {
  assert.match(clipReceiptMigration, /recipient = auth\.uid\(\)/);
  assert.match(clipReceiptMigration, /guest_access_token = guest_token/);
  assert.match(clipReceiptMigration, /status <> 'cancelled'/);
  assert.match(clipReceiptMigration, /revoke all on function public\.record_clip_delivery_receipt/);
  assert.match(app, /data-clip-folder-delivery=/);
  assert.match(app, /recordClipDeliveryReceipt\(delivery\.id, 'viewed'\)/);
  assert.match(app, /Delivery viewed/);
  assert.match(app, /Folder link tapped/);
  assert.match(app, /not proof of download/);
  assert.doesNotMatch(app, /clips downloaded|files downloaded/i);
});

test('Google Drive picker is narrow and sync can never erase a filmer-confirmed clip count', () => {
  const driveShared = read('functions/api/google-drive/_shared.js');
  const driveSync = read('functions/api/google-drive/sync.js');
  const scheduledDriveSync = read('functions/api/google-drive/sync-all.js');
  assert.match(driveSync, /Math\.max\(Number\(delivery\.uploaded_count\) \|\| 0, driveVisibleCount\)/);
  assert.match(scheduledDriveSync, /Math\.max\(Number\(delivery\.uploaded_count\) \|\| 0, driveVisibleCount\)/);
  assert.match(driveShared, /GOOGLE_SERVICE_ACCOUNT_JSON/);
  assert.match(driveShared, /googleServiceAccountAccessToken/);
  assert.match(driveShared, /drive\.metadata\.readonly/);
  assert.match(driveShared, /Share this Google Drive folder with Sodium as a Viewer/);
  assert.match(driveShared, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
  assert.match(driveShared, /trigger_onepick/);
  assert.match(driveShared, /allow_folder_selection/);
  assert.match(driveShared, /authorizeSelectedFolder/);
  assert.match(app, /\$\('#clipUploadedCount'\)\.readOnly = false/);
  assert.match(html, /Drive will never lower this number/);
  assert.match(html, /Connect Google Drive/);
  assert.match(html, /Choose folder/);
  assert.match(app, /function pickGoogleDriveFolder/);
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

test('Stream publication is server-owned and survives a killed client', () => {
  assert.match(app, /status:'pending'/);
  assert.match(app, /expected_media_count:files\.length/);
  assert.match(app, /body:JSON\.stringify\(\{ filename:file\.name, size:file\.size, postId:context\.postId, position:context\.position \}\)/);
  assert.match(app, /waitForPostPublication\(postId\)/);
  assert.match(app, /\.eq\('status', 'published'\)/);
  assert.doesNotMatch(app, /db\.from\('post_stream_media'\)\.insert\(rows\)/);
  assert.match(streamUpload, /post_id:postId/);
  assert.match(streamUpload, /status:'uploading'/);
  assert.match(streamWebhook, /request\.headers\.get\('Webhook-Signature'\)/);
  assert.match(streamWebhook, /crypto\.subtle\.sign\('HMAC'/);
  assert.match(streamWebhook, /Math\.abs\(nowSeconds - parsed\.time\) > MAX_SIGNATURE_AGE_SECONDS/);
  assert.match(streamWebhook, /status:'failed'/);
  assert.match(streamWebhook, /allMedia\.length === expected && allMedia\.every\(item => item\.status === 'ready'\)/);
  assert.match(streamWebhook, /status:'published'/);
  assert.match(streamWebhook, /serviceSupabase\(env/);
  assert.match(streamPublishMigration, /Post publication state is server managed/);
  assert.match(streamPublishMigration, /post\.status = 'published' or post\.author = auth\.uid\(\)/);
  assert.match(streamPublishMigration, /post_stream_media[\s\S]*post\.status = 'published'/);
  assert.match(streamPublishMigration, /post_tags_read[\s\S]*post\.status = 'published'/);
  assert.match(streamPublishMigration, /comments_read[\s\S]*post\.status = 'published'/);
  assert.match(streamPublishMigration, /likes_read[\s\S]*post\.status = 'published'/);
  assert.match(streamPublishMigration, /after insert or update of status on public\.posts/);
});

test('native Sodium routes protected APIs to production and compresses before Stream upload', () => {
  assert.match(app, /const NATIVE_APP = location\.protocol === 'capacitor:' \|\| Boolean\(globalThis\.Capacitor\?\.isNativePlatform/);
  assert.match(app, /const API_ORIGIN = NATIVE_APP \? 'https:\/\/community\.saltyviewfinder\.com' : ''/);
  assert.match(app, /flowType: NATIVE_APP \? 'pkce' : 'implicit'/);
  assert.match(app, /return new URL\('sodium:\/\/auth'\)/);
  assert.match(app, /exchangeCodeForSession\(authorizationCode\)/);
  assert.match(app, /registerPlugin\('SodiumMedia'\)/);
  assert.match(app, /pickAndCompressVideos/);
  assert.match(app, /NATIVE_MEDIA\.uploadTus/);
  assert.match(app, /isNativeClip\(file\)/);
  assert.doesNotMatch(app, /fetch\(localUrl\)[\s\S]{0,500}new File\(\[blob\]/);
  assert.match(app, /Compressed on this iPhone\. Ready to upload\./);
  assert.match(app, /new URL\('sodium:\/\/auth'\)/);
  assert.match(app, /addListener\('appUrlOpen', async event =>/);
  assert.match(app, /handleNativeDriveUrl/);
  assert.match(apiMiddleware, /capacitor:\/\/localhost/);
  assert.match(apiMiddleware, /request\.method === 'OPTIONS'/);
  const nativeController = read('ios/App/App/AppDelegate.swift');
  assert.match(nativeController, /CAPPluginMethod\(name: "uploadTus"/);
  assert.match(nativeController, /AVAssetExportPreset1280x720/);
  assert.match(nativeController, /private static let chunkSize = 5 \* 1024 \* 1024/);
  assert.match(nativeController, /application\/offset\+octet-stream/);
  assert.match(nativeController, /URLSessionConfiguration\.background/);
  assert.match(nativeController, /sessionSendsLaunchEvents = true/);
  assert.match(nativeController, /applicationSupportDirectory/);
  assert.match(nativeController, /handleEventsForBackgroundURLSession/);
  assert.match(app, /const uploadId = fingerprint/);
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
  assert.match(app, /const CLIP_POSTING_TEMPORARILY_PAUSED = !NATIVE_APP/);
  assert.match(app, /selectedPostKind\(\) === 'clip'/);
  assert.match(app, /for \(let index = 0; index < files\.length; index \+= 1\)[\s\S]*await uploadMedia\(selected, path\)/);
  assert.doesNotMatch(html.match(/<input id="mediaFile"[^>]+>/)?.[0] || '', /disabled/);
});

test('profile onboarding never requires device location services', () => {
  assert.match(html, /Sodium never requires Location Services to finish your profile/);
  assert.match(html, /Home location not listed\? Add it/);
  assert.match(app, /Location Services are not required/);
  assert.doesNotMatch(app, /navigator\.geolocation\.getCurrentPosition/);
});
