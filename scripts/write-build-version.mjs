import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outPath = resolve(process.cwd(), 'build-info.js');
const indexPath = resolve(process.cwd(), 'index.html');

let version = 'dev';
try {
  version = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() || 'dev';
} catch (_) {
  // Keep the build usable even outside a git checkout.
}

const content = `window.__APP_VERSION__ = ${JSON.stringify(version)};\n`;
writeFileSync(outPath, content, 'utf8');
try {
  const indexHtml = readFileSync(indexPath, 'utf8')
    .replace(/build-info\.js\?v=[^"']+/g, `build-info.js?v=${version}`)
    .replace(/styles\.css\?v=[^"']+/g, `styles.css?v=${version}`)
    .replace(/(<span id="app-version-indicator"[^>]*>)([^<]*)(<\/span>)/, `$1rev: ${version}$3`);
  writeFileSync(indexPath, indexHtml, 'utf8');
} catch (_) {
  // Keep the build usable even if the HTML file is missing or already edited elsewhere.
}
console.log(`Wrote ${outPath} with version ${version}`);
