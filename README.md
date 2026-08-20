# Salty

Private, invite-only surf community PWA. Static HTML/CSS/vanilla JavaScript hosted at `https://app.saltyviewfinder.com/` through GitHub Pages, with Supabase Auth, Postgres, Realtime, and Storage.

## First-time setup

1. Open the Supabase SQL Editor and run all of `supabase/schema.sql` once.
2. Copy the `bootstrap_invite_code` returned by the final query.
3. In Supabase Authentication → URL Configuration, set the Site URL to `https://app.saltyviewfinder.com/` and add `https://app.saltyviewfinder.com/**` as a redirect URL.
4. Open `https://app.saltyviewfinder.com/?invite=YOUR_CODE` on your phone.

## Phone sign-in and installation

1. Open the invite or member sign-in page in the phone browser. Do not install the public landing page.
2. Continue with Google. If you prefer email, request one sign-in email and enter the full eight-digit code from the newest email; requesting another email invalidates the previous code.
3. Finish the profile and enter the authenticated app.
4. Use the in-app **Add Salty to Home Screen** prompt. The installed app then reuses Supabase's persisted local session and opens directly into the community.

If a Home Screen copy has no stored session, it opens the compact member sign-in screen instead of the public marketing page. A pending code screen also survives switching to an email app and returning.

Google sign-in requires a Google OAuth web client with `https://app.saltyviewfinder.com` as an authorized JavaScript origin and `https://maihhnwrstewzapsvrec.supabase.co/auth/v1/callback` as an authorized redirect URI. Enable that client under Supabase Authentication → Sign In / Providers → Google before publishing this release.

For an existing database created before release v13, run `supabase/session-places-migration.sql` once. It adds broad spot locations (for example, Old Man's → San Onofre) and multiple starting surfers without removing existing data.

Before release v23, run `supabase/events-v2-migration.sql` once. It safely adds event end times, venue names, searchable map locations, and the broad spot-location field if the earlier migration was missed.

Before release v24, run `supabase/perks-admin-migration.sql` once. It activates the Saltyviewfinder and WATA discount cards, adds admin-only perk management, and makes `saltyviewfinder@gmail.com` the first Salty admin.

Before release v26, run `supabase/chat-v1-migration.sql` once. It adds photo-only attachments to regional community rooms, creates the private `salty-chat` image bucket, and enforces text-only DMs at the database level. Community chat photos are capped at 10 MB; video remains exclusive to Stoke.

## Free-tier media limits

- 90 seconds maximum clip duration.
- 50 MB maximum file size.
- `CONFIG.maxUploadBytes` in `app.js` and the `salty-media` bucket limit in `supabase/schema.sql` are the two application limits.
- Upgrade runway: move `uploadMedia()` to TUS resumable uploads and raise both limits after enabling Supabase Pro.

## Phases

This checkpoint contains Foundation, Surfing, the global Stoke photo/clip stream, realtime regional Chat with photo sharing, text-only private DMs, regional Events with RSVP/calendar export, live admin-managed perks, and a visible points/streak/rewards guide. Deeper moderation and additional offline polish follow. Clubs remain a marked post-launch preview only.

Admins can create, edit, hide, and delete discounts from the Perks screen. Deletion requires an explicit confirmation inside the app.
