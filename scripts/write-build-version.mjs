import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outPath = resolve(process.cwd(), 'build-info.js');

let version = 'dev';
try {
  version = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() || 'dev';
} catch (_) {
  // Keep the build usable even outside a git checkout.
}

const content = `window.__APP_VERSION__ = ${JSON.stringify(version)};\n`;
writeFileSync(outPath, content, 'utf8');
console.log(`Wrote ${outPath} with version ${version}`);
