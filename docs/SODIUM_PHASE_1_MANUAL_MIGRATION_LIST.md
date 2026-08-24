# Sodium Phase 1 Manual Migration List

This list separates active Sodium materials from intentionally preserved legacy identifiers and historical SALTY archives.

## External or manual follow-up

| Asset or surface | Location | Current reference | Required change | Phase 2 URL impact |
| --- | --- | --- | --- | --- |
| Existing iPhone/iPad Home Screen installs | Members' devices | The installed label may remain `Salty` | If the label does not refresh, remove and re-add the PWA after v1.52 is live | Re-add again only if Phase 2 changes the install origin |
| Supabase dashboard project display name | Supabase project `maihhnwrstewzapsvrec` | `salty app` | Optional admin-only cosmetic rename to `Sodium` | No |
| Cloudflare Pages project name | Cloudflare Pages | `salty-community-app` | Keep as a legacy internal deployment identifier | No; custom-domain work is Phase 2 |
| Current public hostname | Cloudflare custom domain | `app.saltyviewfinder.com` | Keep during Phase 1 | Yes; migrate to `community.saltyviewfinder.com` in Phase 2 |
| Supabase auth URLs and Google OAuth callbacks | Supabase/Google Cloud consoles | `app.saltyviewfinder.com` and Supabase callback URL | Keep during Phase 1 | Yes; audit and change only in Phase 2 |
| Existing shared invite links and QR codes | Messages, PDFs, printed/digital assets outside this repository | `app.saltyviewfinder.com` and/or `SALTY-...` codes | Keep working; replace outward-facing assets when Phase 2 redirects are proven | Yes |
| Existing email template body/display name | Supabase Auth provider / SMTP provider | May still contain `Salty` | Review manually in the provider dashboard; do not change auth delivery in Phase 1 | Yes; coordinate with Phase 2 auth work |
| iCloud document archive | `iCloud Drive/SODIUM/APPS/Salty Community App/` | Older SALTY-named guide and overview files | Retain as the old release archive; active Sodium files now also live in `Sodium Community App/` | Only embedded links/QRs would change in Phase 2 |

## Historical repository archives

The `docs/SALTY_*` PDFs/PNGs and `docs/guide-v4_5` through `docs/guide-v9` are historical release artifacts. They intentionally retain the old product name and are no longer linked by the app or service worker. They are not deleted so release history remains recoverable.

The current active materials are:

- `docs/SODIUM_Quick_Start_Guide_V10.pdf`
- `docs/guide-v10/page-01.jpg` through `page-04.jpg`
- `docs/SODIUM_App_Overview_One_Pager_V6.pdf`
- `docs/SODIUM_App_Overview_One_Pager_V6.png`

## Intentional legacy internal names

These are invisible implementation identifiers and remain unchanged to preserve users and data:

- Supabase Storage buckets: `salty-media`, `salty-avatars`, `salty-chat`, `salty-feedback`
- localStorage/user-metadata keys beginning `salty:` or `salty_`
- Realtime channel `salty-live`
- webhook header `x-salty-webhook-secret`
- existing database policy/function/job names containing `salty`
- existing invite codes beginning `SALTY-` (new invites use `SODIUM-` after the Phase 1 migration)
- repository/directory and historical builder filenames containing `salty`

The following are separate approved identities and must not be renamed:

- Saltyviewfinder and `saltyviewfinder.com`
- Saltyview Productions
