import assert from 'node:assert/strict';
import test from 'node:test';

import { BUILT_IN_THEME_DEFS } from '../js/theme-engine.js';

function relativeLuminance(hex) {
  const normalized = String(hex || '').replace('#', '');
  assert.match(normalized, /^[0-9a-f]{6}$/i);
  const channels = [0, 2, 4].map(index => {
    const value = parseInt(normalized.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

test('built-in themes keep readable text and accent contrast', () => {
  assert.equal(BUILT_IN_THEME_DEFS.length, 17);

  for (const theme of BUILT_IN_THEME_DEFS) {
    const vars = theme.vars;
    const surface = vars['--bg2'];
    assert.ok(contrastRatio(vars['--text'], surface) >= 7, `${theme.key}: primary text`);
    assert.ok(contrastRatio(vars['--text2'], surface) >= 4.5, `${theme.key}: muted text`);
    assert.ok(contrastRatio(vars['--text3'], surface) >= 3.8, `${theme.key}: subtle text`);
    assert.ok(contrastRatio(vars['--accent'], surface) >= 4.5, `${theme.key}: accent`);

    const bestAccentText = Math.max(
      contrastRatio('#ffffff', vars['--accent']),
      contrastRatio('#081018', vars['--accent'])
    );
    assert.ok(bestAccentText >= 4.5, `${theme.key}: text on accent`);
    assert.deepEqual(theme.colors, [vars['--bg'], vars['--accent'], vars['--text']]);
  }
});
