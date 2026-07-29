import { BUILT_IN_THEME_DEFS, THEME_TOKEN_MAP } from '../theme-engine.js';

const REQUIRED_LEGACY_VARS = [
  '--bg',
  '--bg2',
  '--bg3',
  '--border',
  '--text',
  '--text2',
  '--text3',
  '--accent',
  '--accent2',
  '--accent-glow',
  '--green',
  '--green-dim',
  '--red',
  '--red-dim',
  '--blue',
  '--blue-dim',
  '--yellow',
  '--yellow-dim',
  '--orange',
  '--orange-dim',
  '--purple',
  '--purple-dim',
  '--teal',
  '--teal-dim',
  '--babyblue',
  '--babyblue-dim'
];

const REQUIRED_SEMANTIC_VARS = [
  ...Object.values(THEME_TOKEN_MAP),
  '--color-success-soft',
  '--color-danger-soft',
  '--color-info-soft',
  '--color-warning-soft',
  '--color-orange-soft',
  '--color-purple-soft',
  '--color-teal-soft',
  '--color-babyblue-soft'
];

const failures = [];
const seenKeys = new Set();

if (!Array.isArray(BUILT_IN_THEME_DEFS) || BUILT_IN_THEME_DEFS.length === 0) {
  failures.push('No built-in themes were exported.');
}

for (const theme of BUILT_IN_THEME_DEFS) {
  if (!theme || typeof theme !== 'object') {
    failures.push('Encountered a non-object theme entry.');
    continue;
  }

  if (!theme.key) failures.push('Theme is missing key.');
  if (seenKeys.has(theme.key)) failures.push(`Duplicate theme key: ${theme.key}`);
  seenKeys.add(theme.key);

  if (!['dark', 'light'].includes(theme.mode)) {
    failures.push(`${theme.key}: invalid mode "${theme.mode}"`);
  }

  if (!Array.isArray(theme.colors) || theme.colors.length < 3) {
    failures.push(`${theme.key}: preview colors must include at least 3 colors.`);
  }

  for (const cssVar of [...REQUIRED_LEGACY_VARS, ...REQUIRED_SEMANTIC_VARS]) {
    if (!theme.vars?.[cssVar]) failures.push(`${theme.key}: missing ${cssVar}`);
  }
}

if (failures.length) {
  console.error(`Theme catalog check failed with ${failures.length} issue(s):`);
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Theme catalog OK: ${BUILT_IN_THEME_DEFS.length} built-in themes checked.`);
