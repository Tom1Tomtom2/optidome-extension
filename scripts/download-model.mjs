// Developer build step only. The installed extension has no remote access.
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const spec = JSON.parse(await readFile('scripts/model-files.json', 'utf8'));
for (const [file, expected] of Object.entries(spec.files)) {
  const destination = resolve('models/minilm', file);
  await mkdir(dirname(destination), { recursive: true });
  let hash;
  try { hash = createHash('sha256').update(await readFile(destination)).digest('hex'); } catch {}
  if (hash !== expected) {
    execFileSync('curl', ['--fail', '--location', '--retry', '2', '--output', destination, `https://huggingface.co/${spec.repository}/resolve/${spec.revision}/${file}`], { stdio: 'inherit' });
  }
  const actual = createHash('sha256').update(await readFile(destination)).digest('hex');
  if (actual !== expected) throw new Error(`Checksum mismatch: ${file}`);
  console.log(`Verified ${file}`);
}
