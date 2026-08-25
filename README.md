# Sodium

Private, invite-only surf community PWA. Static HTML/CSS/vanilla JavaScript hosted at `https://community.saltyviewfinder.com/` through Cloudflare Pages, with Supabase Auth, Postgres, Realtime, and Storage. The former `app.saltyviewfinder.com` address redirects to the community URL.

## First-time setup

1. Open the Supabase SQL Editor and run all of `supabase/schema.sql` once.
2. Copy the `bootstrap_invite_code` returned by the final query.
3. In Supabase Authentication → URL Configuration, set the Site URL to `https://community.saltyviewfinder.com/` and add `https://community.saltyviewfinder.com/**` as a redirect URL. Keep the former app URL temporarily for old links.
4. Open `https://community.saltyviewfinder.com/?invite=YOUR_CODE` on your phone.

## Phone sign-in and installation

1. Open the invite or member sign-in page in the phone browser. Do not install the public landing page.
2. Continue with Google. If you prefer email, request one sign-in email and enter the full eight-digit code from the newest email; requesting another email invalidates the previous code.
3. Finish the profile and enter the authenticated app.
4. Use the in-app **Add Sodium to Home Screen** prompt. The installed app then reuses Supabase's persisted local session and opens directly into the community.

If a Home Screen copy has no stored session, it opens the compact member sign-in screen instead of the public marketing page. A pending code screen also survives switching to an email app and returning.

Google sign-in requires a Google OAuth web client with `https://community.saltyviewfinder.com` as an authorized JavaScript origin and `https://maihhnwrstewzapsvrec.supabase.co/auth/v1/callback` as an authorized redirect URI. Keep the former app origin during the transition. Enable that client under Supabase Authentication → Sign In / Providers → Google before publishing this release.

For an existing database created before release v13, run `supabase/session-places-migration.sql` once. It adds broad spot locations (for example, Old Man's → San Onofre) and multiple starting surfers without removing existing data.

Before release v23, run `supabase/events-v2-migration.sql` once. It safely adds event end times, venue names, searchable map locations, and the broad spot-location field if the earlier migration was missed.

Before release v24, run `supabase/perks-admin-migration.sql` once. It activates the Saltyviewfinder and WATA discount cards, adds admin-only perk management, and makes `saltyviewfinder@gmail.com` the first Sodium admin.

Before release v1.48, run `supabase/beta-feedback-v1-migration.sql` once. It adds member issue reports, a private screenshot bucket, and the RLS used by the admin-only Beta Feedback dashboard.

Before release v1.50, run `supabase/security-hardening-v1-migration.sql` once. It limits SQL grants to the operations Sodium uses, keeps phone/admin profile fields self-only, hardens privileged function name resolution, makes Stoke media member-only, and tightens Storage-path ownership checks.

Before release v26, run `supabase/chat-v1-migration.sql` once. It adds photo-only attachments to regional community rooms, creates the private `salty-chat` image bucket, and enforces text-only DMs at the database level. Community chat photos are capped at 10 MB; video remains exclusive to Stoke.

For databases that show `gen_random_bytes(integer) does not exist` when inviting a friend or a missing `sessions.participant_names` column when sharing a surf, run `supabase/invites-sessions-hotfix.sql` once. It preserves existing data and is safe to run more than once.

Before release v36, run `supabase/push-points-v1-migration.sql` once. It moves surf points from posting/joining to the moment the organizer marks the surf finished, prevents repeat awards per person/session, and adds push subscriptions plus member notification preferences. Deploy the `push` Edge Function and webhook using `supabase/PUSH_SETUP.md`; the VAPID private key and webhook secret must remain Supabase secrets and must never be committed.

Before the travel-locations release, run `supabase/location-memberships-v1-migration.sql` once. It keeps one home location per member, lets members join real travel locations, carries the inviter's current location into new invites, scopes regional notifications to joined locations, and adds completed-session participation stats. Locations are U.S. states inside the United States and countries everywhere else; named spots and broader map areas remain attached to individual sessions.

For the Sodium Phase 1 rename, run `supabase/sodium-brand-v1-migration.sql` once. It preserves existing invite codes and all community data, changes the two seeded perk labels to Sodium, and makes newly generated invite codes start with `SODIUM-`.

Before release v1.59, run `supabase/clip-deliveries-v1-migration.sql` once. It adds provider-neutral clip handoffs to the Inbox: sender, recipient, surfers in the footage, optional related session, external folder link, and manual progress. Videos remain in Drive, Dropbox, iCloud, or another provider. When the uploaded count reaches the expected total, the delivery becomes **Clips ready** and notifies the recipient automatically. Future provider OAuth can automate the count without changing this data model.

On iPhone, Web Push requires iOS 16.4 or later and the installed Home Screen app. Each member opens **Settings → Enable notifications on this device**, accepts Apple's prompt, and can then enable or disable new surfs, Stoke, DMs, events, surf updates, and Community Chat individually. Community Chat is off by default.

## Free-tier media limits

- 90 seconds maximum clip duration.
- 50 MB maximum file size.
- `CONFIG.maxUploadBytes` in `app.js` and the `salty-media` bucket limit in `supabase/schema.sql` are the two application limits.
- Upgrade runway: move `uploadMedia()` to TUS resumable uploads and raise both limits after enabling Supabase Pro.

## Phases

This checkpoint contains Foundation, Surfing, the global Stoke photo/clip stream, realtime regional Chat with photo sharing, text-only private DMs, regional Events with RSVP/calendar export, live admin-managed perks, and a visible points/streak/rewards guide. Deeper moderation and additional offline polish follow. Clubs remain a marked post-launch preview only.

Admins can create, edit, hide, and delete discounts from the Perks screen. Deletion requires an explicit confirmation inside the app.

## Current member guide

The member documentation has three levels. `docs/SODIUM_App_Overview_One_Pager_V8.png` is the simple first-contact overview. `docs/SODIUM_Setup_One_Pager_V1.png` is the four-step phone setup sheet. `docs/SODIUM_Quick_Start_Guide_V12.pdf` is the optional four-page manual; its in-app pages live in `docs/guide-v12/`. Profile sharing offers the invite alone, the app overview, phone setup, or the full manual.

Before deploying Marketplace to a fresh Supabase project, run `supabase/marketplace-v1-migration.sql` after the base schema. It is additive, preserves existing data, enables RLS, and creates the private `sodium-marketplace` image bucket.
