# Sodium Phase 1 Manual Migration List

This list separates active Sodium materials from intentionally preserved legacy identifiers and historical SALTY archives.

## External or manual follow-up

| Asset or surface | Location | Current reference | Required change | Phase 2 URL impact |
| --- | --- | --- | --- | --- |
| Existing iPhone/iPad Home Screen installs | Members' devices | The installed label may remain `Salty` | Remove and re-add the PWA after v1.53 is live on the new community hostname | Yes; a new origin cannot inherit the old installed PWA or stored session |
| Supabase dashboard project display name | Supabase project `maihhnwrstewzapsvrec` | `Sodium` | Completed with the v1.53 launch | No |
| Cloudflare Pages project name | Cloudflare Pages | `salty-community-app` | Keep as a legacy internal deployment identifier | No; custom-domain work is Phase 2 |
| Current public hostname | Cloudflare custom domain | `community.saltyviewfinder.com` | Active; the former `app.saltyviewfinder.com` hostname is retained and redirected by the app | Completed |
| Supabase auth URLs and Google OAuth callbacks | Supabase/Google Cloud consoles | Site URL is `community.saltyviewfinder.com`; both old and new redirects are allowed | Keep the old allow-list entry during transition | Completed |
| Existing shared invite links and QR codes | Messages, PDFs, printed/digital assets outside this repository | `app.saltyviewfinder.com` and/or `SALTY-...` codes | Keep working; replace outward-facing assets when Phase 2 redirects are proven | Yes |
| Existing email template body/display name | Supabase Auth provider / SMTP provider | Subject, body, and sender name now say Sodium | OTP behavior and SMTP provider were preserved | Completed |
| iCloud document archive | `iCloud Drive/SODIUM/APPS/Salty Community App/` | Older SALTY-named guide and overview files | Retain as the old release archive; active Sodium files now also live in `Sodium Community App/` | Only embedded links/QRs would change in Phase 2 |

## Historical repository archives

The `docs/SALTY_*` PDFs/PNGs and `docs/guide-v4_5` through `docs/guide-v9` are historical release artifacts. They intentionally retain the old product name and are no longer linked by the app or service worker. They are not deleted so release history remains recoverable.

The current active materials are:

- `docs/SODIUM_Quick_Start_Guide_V11.pdf`
- `docs/guide-v11/page-01.jpg` through `page-04.jpg`
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
