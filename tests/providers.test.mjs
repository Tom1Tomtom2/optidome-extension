import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const providers = require('../providers.js');

test('every content script runs on exactly the counted providers', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url)));
  const expected = providers.definitions.flatMap(p => p.hosts.map(h => `https://${h}/*`)).sort();
  for (const script of manifest.content_scripts) assert.deepEqual([...script.matches].sort(), expected);
  for (const p of providers.definitions) {
    for (const host of p.hosts) assert.equal(providers.forUrl(`https://${host}/chat/a`).id, p.id);
  }
});

test('only exact HTTPS provider origins are accepted', () => {
  for (const url of [undefined, '', 'garbage', 'http://claude.ai/', 'https://evil.claude.ai/',
    'https://chatgpt.com.evil.test/', 'https://claude.ai@evil.test/', 'https://claude.ai:8443/',
    'https://mistral.ai/', 'https://google.com/']) assert.equal(providers.forUrl(url), null);
});

test('published source and package versions agree', () => {
  const load = name => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url)));
  assert.equal(load('manifest.json').version, load('package.json').version);
});
