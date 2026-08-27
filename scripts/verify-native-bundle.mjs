import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['app.js', 'native-web/app.js', 'ios/App/App/public/app.js'];

async function versionFor(file) {
  const source = await readFile(resolve(root, file), 'utf8');
  const match = source.match(/const APP_VERSION = ['"]([^'"]+)['"]/);
  if (!match) throw new Error(`${file} does not declare APP_VERSION.`);
  return match[1];
}

const versions = Object.fromEntries(await Promise.all(files.map(async file => [file, await versionFor(file)])));
const expected = versions['app.js'];
const stale = Object.entries(versions).filter(([, version]) => version !== expected);
if (stale.length) {
  throw new Error(`Native bundle is stale. Expected ${expected}; found ${stale.map(([file, version]) => `${file}=${version}`).join(', ')}.`);
}
console.log(`Native bundle verified: Sodium v${expected} in web, native-web, and iOS public assets.`);
