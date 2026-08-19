# Salty

Private, invite-only surf community PWA. Static HTML/CSS/vanilla JavaScript hosted at `https://wata-git-dex.github.io/salty/`, with Supabase Auth, Postgres, Realtime, and Storage.

## First-time setup

1. Open the Supabase SQL Editor and run all of `supabase/schema.sql` once.
2. Copy the `bootstrap_invite_code` returned by the final query.
3. In Supabase Authentication → URL Configuration, set the Site URL to `https://wata-git-dex.github.io/salty/` and add `https://wata-git-dex.github.io/salty/**` as a redirect URL.
4. Open `https://wata-git-dex.github.io/salty/?invite=YOUR_CODE` on your phone.

## Free-tier media limits

- 90 seconds maximum clip duration.
- 50 MB maximum file size.
- `CONFIG.maxUploadBytes` in `app.js` and the `salty-media` bucket limit in `supabase/schema.sql` are the two application limits.
- Upgrade runway: move `uploadMedia()` to TUS resumable uploads and raise both limits after enabling Supabase Pro.

## Phases

This checkpoint contains Foundation, Surfing, and the global Feed. Chat/DMs, Events/points UI, moderation/perks completion, and offline polish follow in the build-spec order. Clubs remain a marked post-launch preview only.
