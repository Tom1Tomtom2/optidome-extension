import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const spec = JSON.parse(await readFile('scripts/model-files.json', 'utf8'));
for (const [file, expected] of Object.entries(spec.files)) {
  const checksum = createHash('sha256').update(await readFile(`models/minilm/${file}`)).digest('hex');
  if (checksum !== expected) throw new Error(`Missing or unexpected model file: ${file}. See ANALYSIS.md.`);
}
await mkdir('dist/analyse', { recursive: true });
for (const file of await readdir('.')) {
  if (/\.(js|html|json)$/.test(file) && !['package.json', 'package-lock.json', 'rules.check.js'].includes(file)) await cp(file, `dist/${file}`);
}
for (const dir of ['icons', 'fonts', '_locales', 'models']) await cp(dir, `dist/${dir}`, { recursive: true });
for (const file of ['index.html', 'style.css', 'page.mjs', 'policy.mjs', 'launcher.js', 'background.js']) await cp(`analyse/${file}`, `dist/analyse/${file}`);
await build({ entryPoints: ['analyse/worker.mjs'], outfile: 'dist/analyse/worker.js', bundle: true, platform: 'browser', format: 'esm', minify: true, legalComments: 'eof' });
await mkdir('dist/vendor', { recursive: true });
for (const file of await readdir('node_modules/onnxruntime-web/dist')) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(file)) await cp(`node_modules/onnxruntime-web/dist/${file}`, `dist/vendor/${file}`);
}
await cp('LICENSE', 'dist/LICENSE');
const licenses = [];
for (const pkg of ['@huggingface/transformers']) {
  licenses.push(`\n${pkg}\n`, await readFile(`node_modules/${pkg}/LICENSE`, 'utf8'));
}
licenses.push('ONNX Runtime (MIT)', await readFile('scripts/ONNX-LICENSE.txt', 'utf8'), await readFile('scripts/ONNX-ThirdPartyNotices.txt', 'utf8'));
await writeFile('dist/THIRD_PARTY_LICENSES.txt', licenses.join('\n') + '\nMiniLM weights: Apache-2.0 (see LICENSE). Source: Xenova/paraphrase-multilingual-MiniLM-L12-v2; revision 2c4055b12046f11709e9df2c122e59ffbdc2f900.\n');
console.log('Built dist/ with local model and WASM runtime. No runtime downloads.');
