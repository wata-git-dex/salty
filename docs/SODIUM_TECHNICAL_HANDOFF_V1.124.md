# Sodium technical handoff — v1.124

Updated: August 27, 2026

This is the independent engineering handoff for the current Sodium community app. It is written so another engineer or coding agent can audit the system without relying on prior chat claims.

## Product and runtime

- Web/PWA: static HTML, CSS, and vanilla JavaScript (`index.html`, `styles.css`, `app.js`, `sw.js`).
- Native iPhone: Capacitor 8 shell in `ios/App`, containing a bundled copy of the same web application plus custom Swift bridges.
- Data/auth: Supabase. The public publishable client key is intentionally in the client; authorization depends on Row Level Security.
- Edge APIs: Cloudflare Pages Functions in `functions/api`.
- Video: Cloudflare Stream direct creator uploads using TUS.
- Production web URL: `https://community.saltyviewfinder.com/`.
- iOS bundle id: `com.saltyviewfinder.sodium`.

The PWA and iPhone app use the same Supabase project and therefore the same users, sessions, chats, posts, and events. They are two clients, not two communities.

## Authentication flow

Primary implementation: `app.js` plus `SodiumAuthPlugin` and `SceneDelegate.swift`.

- Google sign-in uses Supabase OAuth.
- Native iPhone starts OAuth with `ASWebAuthenticationSession` and returns through `sodium://auth`.
- Existing profiles bypass invite redemption. One-time invites are used only when a profile does not exist.
- `enterCommunity()` calls `get_my_profile`; a valid existing profile must not be rejected because a stale invite remains in the URL or local storage.

Known/observed onboarding failure:

- A new member authenticated but could not finish profile setup because the home-location choice blocked saving.
- v1.124 makes location a manual choice, explicitly states that Location Services are not required, and adds a manual “Home location not listed? Add it” route.
- This change has automated coverage but still requires a real new-account device test.

Required authentication acceptance tests:

1. Existing member on a clean desktop browser.
2. Existing member on a clean iPhone install.
3. New member from a fresh invite.
4. New member who chooses an existing location.
5. New member who manually adds a location.
6. Relaunch and second-device login without reusing an invite.

## Stoke video pipeline

### Intended flow

1. `PHPickerViewController` selects up to five videos.
2. Swift immediately copies each picker-owned file before the temporary picker URL disappears.
3. `AVAssetExportSession` creates a 720p MP4 in Application Support.
4. The web layer requests a one-time Cloudflare Stream TUS upload URL from `functions/api/stream/upload.js`.
5. Swift uploads 5 MiB chunks directly to Cloudflare Stream.
6. When upload bytes finish, the post is created and `post_stream_media` records the Stream uid.
7. Cloudflare processing is displayed separately from byte upload.

### Root cause of prior failures

The old native implementation used `URLSession.shared` and an in-memory Swift operation. Compression was native, but upload ownership was not durable. Backgrounding, connection changes, WebView suspension, or process termination could lose the Swift operation and JavaScript promise. This explains repeated paused uploads, retry loops, and failure after leaving the screen.

### v1.124 candidate fix

`SodiumBackgroundUploadManager` in `ios/App/App/AppDelegate.swift` now:

- uses `URLSessionConfiguration.background`;
- uploads chunks from files, which iOS can continue outside the foreground process;
- stores compressed files and chunk files in Application Support;
- persists job id, file path, Cloudflare upload URL, byte offset, status, and retry attempt;
- recreates the same background session at launch;
- handles background-session wake-up callbacks;
- recovers Cloudflare's authoritative offset with TUS `HEAD`;
- uses a stable JavaScript/native job id across draft retries.

This code compiles and signs. It has not yet passed the required real-device interruption test, so it must not be described as beta-ready.

### Current release behavior

- Photo posts remain enabled in web and native clients.
- Clip posting remains paused in the web/PWA client.
- Clip posting is enabled only inside the native iPhone app, where the background owner exists.

### Required media acceptance test

Use a real 200–800 MB clip, not a tiny fixture:

1. Select the video.
2. Confirm compression completes and the preview is playable.
3. Start upload on Wi-Fi.
4. Lock the phone for at least one minute.
5. Reopen and confirm progress resumes from Cloudflare's offset.
6. Switch between Wi-Fi and cellular and confirm no restart from zero.
7. Force-quit during upload, relaunch, reopen the draft, and confirm resume.
8. Confirm the Stream video processes and plays in Stoke.
9. Confirm no post becomes visible before all selected clips have a Stream uid.
10. Repeat with five clips.

## Cloudflare Stream boundary

- Upload provisioning: `functions/api/stream/upload.js`.
- Authorization: `functions/api/stream/_shared.js` verifies the Supabase member.
- Constraints: five minutes and 1 GB per clip in the current product UI/API.
- Cloudflare TUS requires at least 5 MiB chunks; Sodium currently uses 5 MiB to limit repeated data on weak connections.
- The Cloudflare API token remains server-side and must never enter the app bundle.

## Google Drive clip delivery

This is separate from Stoke video posting.

- Drive delivery shares a folder link/count; it does not upload Stoke media.
- OAuth uses the narrow `drive.file` scope.
- Browser uses Google Picker; native returns through `sodium://drive`.
- Service-side folder counting only works for a folder the member explicitly selected/shared as required by the current flow.
- Google Drive counts are not proof that a recipient downloaded every clip.

## Build and verification commands

From the repository root:

```sh
pnpm check
pnpm native:sync
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath /private/tmp/sodium-ios-derived build
```

Latest verified results on August 27, 2026:

- JavaScript syntax/tests: 21 passed, 0 failed.
- Capacitor bundle sync: passed.
- Signed arm64 iPhone build: passed.
- Real-device native background-upload test: not yet completed.
- Fresh new-member onboarding test: not yet completed.

## Important code locations

- Main client: `app.js`
- Main UI: `index.html`, `styles.css`
- Native Swift: `ios/App/App/AppDelegate.swift`, `ios/App/App/SceneDelegate.swift`
- Capacitor config: `capacitor.config.json`
- Stream APIs: `functions/api/stream`
- Drive APIs: `functions/api/google-drive`
- Database schema/migrations: `supabase`
- Automated release tests: `functions/test/release-integrity.test.mjs`
- Canonical project status: `SODIUM_MASTER_STATE.md`

## Do not assume

- A successful Xcode build does not prove an upload survives suspension.
- A successful Google OAuth screen does not prove onboarding completed.
- “Clips ready” means the configured delivery folder/count is ready; it does not prove recipient download.
- The native shell does not automatically make web uploads native.
- The PWA and iOS clients must not independently change schema or business rules.

## Release gate

Do not send v1.124 to beta testers until the two uncompleted real-device tests above pass with evidence. If another engineer takes over, they should reproduce those tests before refactoring the current implementation.
