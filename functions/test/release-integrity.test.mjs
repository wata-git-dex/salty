import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => readFileSync(resolve(root, file), 'utf8');
const html = read('index.html');
const app = read('app.js');
const worker = read('sw.js');

test('HTML IDs are unique and hard JavaScript selectors resolve', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, []);

  const dynamicIds = new Set(['clipReadyAlert', 'notificationTestButton']);
  const selectors = [...app.matchAll(/\$\(['"]#([A-Za-z][\w:-]*)['"]/g)].map(match => match[1]);
  const missing = [...new Set(selectors.filter(id => !ids.includes(id) && !dynamicIds.has(id)))];
  assert.deepEqual(missing, []);
});

test('every static action and form is routed', () => {
  const actions = [...new Set([...html.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]))];
  const actionMap = new Set([...app.matchAll(/^\s{4}['"`]([^'"`]+)['"`]:/gm)].map(match => match[1]));
  assert.deepEqual(actions.filter(action => !actionMap.has(action)), []);

  const forms = [...html.matchAll(/<form\s+id="([^"]+)"/g)].map(match => match[1]);
  const handled = new Set([...app.matchAll(/event\.target\.id === ['"]([^'"]+)['"]/g)].map(match => match[1]));
  assert.deepEqual(forms.filter(form => !handled.has(form)), []);
});

test('offline shell contains real files and never intercepts APIs', () => {
  const shellBlock = worker.match(/const SHELL = \[(.*?)\];/s)?.[1] || '';
  const shellPaths = [...shellBlock.matchAll(/['"](\.\/[^'"]+)['"]/g)]
    .map(match => match[1].split('?')[0])
    .filter(path => path !== './');
  const guidePaths = Array.from({ length:4 }, (_, index) => `./docs/guide-v14/page-${String(index + 1).padStart(2, '0')}.jpg`);
  const missing = [...shellPaths, ...guidePaths].filter(path => !existsSync(resolve(root, path)));
  assert.deepEqual(missing, []);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)\) return/);
  assert.equal([...worker.matchAll(/caches\.match\('\.\/index\.html'\)/g)].length, 1);
});

test('release labels, cache busting, and Stoke limits stay aligned', () => {
  const version = app.match(/const APP_VERSION = '([^']+)'/)?.[1];
  assert.ok(version);
  const escapedVersion = version.replace('.', '\\.');
  const cacheVersion = version.replace(/^1\./, '');
  assert.match(html, new RegExp(`boot-credit[^>]*>[^<]*v${escapedVersion}`));
  assert.match(html, new RegExp(`NEW IN V${escapedVersion}`));
  assert.match(html, new RegExp(`app\\.js\\?v=${cacheVersion}-release-audit`));
  assert.match(worker, new RegExp(`sodium-shell-v${cacheVersion}-release-audit`));
  assert.match(html, /<b>Clips<\/b><small>up to 5 · 5 min each<\/small>/);

  const postSheet = html.match(/<section id="postSheet"[\s\S]*?<section id="eventSheet"/)?.[0] || '';
  assert.doesNotMatch(postSheet, /data-open-post-draft|postDraftsPanel/);
});
