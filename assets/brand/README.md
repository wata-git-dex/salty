# Sodium Community App — Brand Assets

This folder is the canonical reusable asset pack for the **Sodium community app**.

## Primary identity

- The approved rounded-square swirl is the primary Sodium app icon.
- `logos/sodium-app-icon-standard.svg` is the canonical vector source.
- `logos/sodium-ios-app-icon.svg` and `png/sodium-ios-app-icon-1024.png` are the full-bleed, no-transparency iOS sources. iOS applies the corner mask itself.
- `logos/sodium-launch-screen.svg` is the native launch-screen source.
- The community app does **not** use the separate Sodium clothing-brand “S” logo.

## Variants

The ink icon is the standard product identity. Ocean, foam, amber, and pink are optional in-app appearance variants; they are not separate logos.

## Usage

- Keep the full rounded square intact when using the app icon.
- Do not redraw, rotate, stretch, outline, or combine the swirl with another mark.
- Leave clear space around the icon equal to at least one quarter of its width.
- Preserve the blue-to-amber swirl gradient in the standard icon.
- Use “Sodium” in normal product copy and “SODIUM” only where an existing layout intentionally uses all caps.
- “Saltyviewfinder” and “Saltyview Productions” are separate identities and should not be renamed.

## Core product colors

- Ink: `#0A141C`
- Deep launch background: `#02070B`
- Ocean blue: `#54ABEC`
- Sodium amber: `#F6A23C`
- Border blue-gray: `#324859`

The machine-readable versions live in `palette/sodium-colors.css` and `palette/sodium-colors.json`.

## Typography

The product wordmark and display headings use **Archivo** at heavy weights. Product copy uses the native system sans-serif stack. Do not substitute a decorative surf font.

## Folder contents

- `logos/` — editable SVG icon sources.
- `png/` — ready-to-use standard icon exports at common platform sizes.
- `themes/` — optional user-selectable app appearance icons.
- `palette/` — reusable color tokens.

The native iPhone build treats this folder as its source of truth. Running
`pnpm native:build` copies `png/sodium-ios-app-icon-1024.png` and
`png/sodium-launch-screen-2732.png` into the Xcode asset catalog. Edit or
replace the master files here first; do not independently replace the copies
inside `ios/App/App/Assets.xcassets/`.

The matching source pack is also mirrored to iCloud under:

`SODIUM/APPS/Sodium Community App/Sodium Brand Assets`
