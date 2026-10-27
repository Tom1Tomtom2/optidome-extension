import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const providers = require('../analyse/providers.js');

test('all counted providers have a manual analysis launcher', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url)));
  const launcher = manifest.content_scripts.find(s => s.js.includes('analyse/launcher.js'));
  const measurements = manifest.content_scripts.find(s => s.js.includes('intercept.js'));
  const expected = providers.definitions.flatMap(p => p.hosts.map(h => `https://${h}/*`)).sort();
  assert.deepEqual([...launcher.matches].sort(), expected);
  assert.deepEqual([...measurements.matches].sort(), expected);
  assert.deepEqual(launcher.js, ['analyse/providers.js', 'analyse/launcher.js']);
  for (const p of providers.definitions) {
    assert.ok(p.selectors.length);
    for (const host of p.hosts) assert.equal(providers.forUrl(`https://${host}/chat/a`).id, p.id);
  }
});

test('only exact HTTPS provider origins can open the analysis window', () => {
  for (const url of [undefined, '', 'garbage', 'http://claude.ai/', 'https://evil.claude.ai/',
    'https://chatgpt.com.evil.test/', 'https://claude.ai@evil.test/', 'https://claude.ai:8443/',
    'https://mistral.ai/', 'https://google.com/']) assert.equal(providers.forUrl(url), null);
});

test('published source and package versions agree', () => {
  const load = name => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url)));
  assert.equal(load('manifest.json').version, load('package.json').version);
  assert.equal(load('package.json').version, load('package-lock.json').version);
});
