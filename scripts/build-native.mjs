import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'native-web');

// The checked-in brand pack is the single source of truth for native artwork.
// Sync these files on every native build so Xcode cannot drift from the
// approved Sodium community identity stored in assets/brand/.
const nativeBrandAssets = [
  {
    source: 'assets/brand/png/sodium-ios-app-icon-1024.png',
    destinations: [
      'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
    ],
  },
  {
    source: 'assets/brand/png/sodium-launch-screen-2732.png',
    destinations: [
      'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png',
      'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png',
      'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png',
    ],
  },
];

const files = [
  'app.js',
  'styles.css',
  'privacy.html',
  'manifest.webmanifest',
  'manifest-amber.webmanifest',
  'manifest-foam.webmanifest',
  'manifest-ocean.webmanifest',
  'icon.svg',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'icon-ink.svg',
  'icon-amber.svg',
  'icon-foam.svg',
  'icon-ocean.svg',
  'icon-pink.svg',
  'native/startup-diagnostics.js',
  'docs/SODIUM_Quick_Start_Guide_V14.pdf',
  'docs/SODIUM_Master_Instruction_Manual_V2.pdf',
  'docs/SODIUM_App_Overview_One_Pager_V10.png',
  'docs/SODIUM_Setup_One_Pager_V3.png',
  'docs/SODIUM_Plan_A_Surf_One_Pager_V2.png',
  'docs/SODIUM_Get_Your_Clips_One_Pager_V2.png',
];

const directories = [
  'assets/emojis',
  'docs/guide-v14',
  'vendor',
];

await rm(output, { recursive:true, force:true });
await mkdir(output, { recursive:true });

for (const asset of nativeBrandAssets) {
  for (const destination of asset.destinations) {
    await cp(resolve(root, asset.source), resolve(root, destination));
  }
}

for (const file of files) {
  const destination = resolve(output, file);
  await mkdir(dirname(destination), { recursive:true });
  await cp(resolve(root, file), destination);
}

for (const directory of directories) {
  await cp(resolve(root, directory), resolve(output, directory), { recursive:true });
}

// Capacitor serves the bundled app from capacitor://localhost. The production
// Content Security Policy must explicitly allow Sodium's own API origin.
const html = (await readFile(resolve(root, 'index.html'), 'utf8'))
  .replace("connect-src 'self'", "connect-src 'self' https://community.saltyviewfinder.com")
  .replace('<link id="appManifest" rel="manifest" href="./manifest.webmanifest">', '')
  .replace(/<meta name="apple-mobile-web-app-[^>]+>\n?/g, '')
  // Install the native error listener before Supabase, Capacitor-dependent app
  // code, or even the small theme bootstrap can execute. Keeping diagnostics
  // at the end of <body> missed exceptions thrown by earlier scripts and only
  // reported a misleading timeout.
  .replace('<script>try{document.documentElement.dataset.theme=', '<script src="./native/startup-diagnostics.js"></script>\n  <script>try{document.documentElement.dataset.theme=');
await writeFile(resolve(output, 'index.html'), html);

console.log(`Prepared Sodium native web bundle in ${output}`);
