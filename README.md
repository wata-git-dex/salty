# Sodium

Private, invite-only surf community PWA. Static HTML/CSS/vanilla JavaScript hosted at `https://community.saltyviewfinder.com/` through Cloudflare Pages, with Supabase Auth, Postgres, Realtime, and Storage. The former `app.saltyviewfinder.com` address redirects to the community URL.

Current cross-thread product decisions and release status are consolidated in [`SODIUM_MASTER_STATE.md`](./SODIUM_MASTER_STATE.md).

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

Before release v1.60, run `supabase/session-attribution-invites-v1-migration.sql` once. It separates the member who entered a session from the person who initiated it, preserves all existing sessions, adds claimable task-specific invitations, allows pending clip recipients, and adds isolated guest clip links. Guest links never expose sessions, community chat, profiles, or other member data. The legacy migration also created a clip-message table, but v1.92 intentionally removes delivery messaging from the product UI; clip delivery is a clean folder handoff.

Release v1.82 adds multiple linked member tags to Stoke through the existing `post_tags` relationship and author-written visual labels through `supabase/stoke-visual-tags-v1-migration.sql`. The migration is additive, preserves every existing post, and is safe to run more than once.

Before release v1.61, run `supabase/push-test-notification-v1-migration.sql` once. It adds a signed-in, self-only, rate-limited notification test so each member can verify their own installed device from Settings. Sodium continues to suppress self-notifications for content a member created.

Before release v1.86, run `supabase/nonprofit-events-weekly-recap-v1-migration.sql` once. It adds a lightweight, admin-managed nonprofit layer inside Events while preserving every existing event as a community event. Organization cards can exist without a scheduled event and include a private Storage-backed logo, short description, and website; Water Access To All is seeded as the first placeholder. Members can RSVP and export nonprofit events to their calendar. The data model includes stable external-source IDs so a future server-side calendar importer can sync approved feeds without changing the member experience. Weekly crew and personal recaps are calculated automatically from existing participation data and require no journal entry.

Before release v1.87, run `supabase/profile-activity-stats-v1-migration.sql` once. It records the real start time when a member taps **Start surf**, keeps scheduled times separate from active time, and expands profile stats into Community, Surf, and Film + photo views. Older sessions retain all existing counts; a duration is only backfilled when the old timestamps safely describe a manually started session, so auto-archived plans cannot inflate time totals.

Release v1.94 separates the top personal Inbox (DMs and clip deliveries) from the regional Community Chat. The `sodium-clip-sync` scheduled Worker checks connected Google Drive deliveries every minute through the protected Pages endpoint; when the completed-video count reaches the promised total, the existing database trigger queues the recipient's **Your clips are ready** push notification.

On iPhone, Web Push requires iOS 16.4 or later and the installed Home Screen app. Each member opens **Settings → Enable notifications on this device**, accepts Apple's prompt, and can then enable or disable new surfs, Stoke, DMs, events, surf updates, and Community Chat individually. Community Chat is off by default.

## Stoke media limits

- Five minutes maximum clip duration.
- Five Cloudflare Stream clips per video post, up to 1 GB each.
- Device-local Stoke drafts preserve selected photos or clips and post details for 30 days without consuming Stream storage until publishing.
- Ten Supabase-hosted photos per photo post, up to 50 MB each.
- Video uploads use direct, resumable TUS chunks; the Cloudflare API token remains a Pages secret and is never sent to the browser.
- Before enabling Stream posts, run `supabase/stoke-cloudflare-stream-v1-migration.sql`, enable Cloudflare Stream billing, and set the Pages secret `CF_STREAM_API_TOKEN`.

## Phases

This checkpoint contains Foundation, Surfing, the global Stoke photo/clip stream, realtime regional Chat with photo sharing, text-only private DMs, regional Events with RSVP/calendar export, live admin-managed perks, and a visible points/streak/rewards guide. Deeper moderation and additional offline polish follow. Clubs remain a marked post-launch preview only.

Admins can create, edit, hide, and delete discounts from the Perks screen. Deletion requires an explicit confirmation inside the app.

## Current member guide

The member documentation has three levels. `docs/SODIUM_App_Overview_One_Pager_V10.png` is the simple first-contact overview. `docs/SODIUM_Setup_One_Pager_V3.png` is the four-step phone setup sheet. `docs/SODIUM_Quick_Start_Guide_V14.pdf` is the optional four-page manual; its in-app pages live in `docs/guide-v14/`. Task-specific invites attach `SODIUM_Plan_A_Surf_One_Pager_V2.png` or `SODIUM_Get_Your_Clips_One_Pager_V2.png`. The clip guide makes the two routes explicit: members open the delivery in Sodium; guests tap **Open your clips** with no account, while joining remains optional.

Before deploying Marketplace to a fresh Supabase project, run `supabase/marketplace-v1-migration.sql` after the base schema. It is additive, preserves existing data, enables RLS, and creates the private `sodium-marketplace` image bucket.
