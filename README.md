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

## Free-tier media limits

- 90 seconds maximum clip duration.
- 50 MB maximum file size.
- `CONFIG.maxUploadBytes` in `app.js` and the `salty-media` bucket limit in `supabase/schema.sql` are the two application limits.
- Upgrade runway: move `uploadMedia()` to TUS resumable uploads and raise both limits after enabling Supabase Pro.

## Phases

This checkpoint contains Foundation, Surfing, the global Stoke photo/clip stream, and regional Events with RSVP and calendar export. Chat/DMs, moderation/perks completion, and additional offline polish follow. Clubs remain a marked post-launch preview only.
