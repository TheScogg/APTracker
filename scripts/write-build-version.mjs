import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outPath = resolve(process.cwd(), 'build-info.js');
const indexPath = resolve(process.cwd(), 'index.html');

let version = 'dev';
let fullCommit = 'dev';
let branch = 'unknown';
let commitDate = '';
const builtAt = new Date().toISOString();
try {
  fullCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim() || 'dev';
  version = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() || 'dev';
  branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim() || 'unknown';
  commitDate = execSync('git log -1 --format=%cI', { encoding: 'utf8' }).trim();
} catch (_) {
  // Keep the build usable even outside a git checkout.
}
const dirty = (() => {
  try {
    return execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0;
  } catch (_) {
    return false;
  }
})();

const buildInfo = {
  version,
  commit: fullCommit,
  shortCommit: version,
  branch,
  commitDate,
  builtAt,
  dirty
};
const content = `window.__APP_BUILD_INFO__ = ${JSON.stringify(buildInfo, null, 2)};\nwindow.__APP_VERSION__ = ${JSON.stringify(version)};\n`;
writeFileSync(outPath, content, 'utf8');
try {
  const indexHtml = readFileSync(indexPath, 'utf8')
    .replace(/build-info\.js\?v=[^"']+/g, `build-info.js?v=${version}`)
    .replace(/app\.js\?v=[^"']+/g, `app.js?v=${version}`)
    .replace(/styles\.css\?v=[^"']+/g, `styles.css?v=${version}`)
    .replace(/(<span id="app-version-indicator"[^>]*>)([^<]*)(<\/span>)/, `$1rev: ${version}$3`);
  writeFileSync(indexPath, indexHtml, 'utf8');
} catch (_) {
  // Keep the build usable even if the HTML file is missing or already edited elsewhere.
}
console.log(`Wrote ${outPath} with version ${version}`);
