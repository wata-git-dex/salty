import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'native-web');

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
  .replace(/<meta name="apple-mobile-web-app-[^>]+>\n?/g, '');
await writeFile(resolve(output, 'index.html'), html);

console.log(`Prepared Sodium native web bundle in ${output}`);
