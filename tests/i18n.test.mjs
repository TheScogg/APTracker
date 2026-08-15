import assert from 'node:assert/strict';
import test from 'node:test';

import {
  catalogKeys,
  getDirection,
  languagePrefs,
  missingCatalogKeys,
  normalizeLanguagePrefs,
  normalizeLocale,
  resolveInitialLocale,
  setLocale,
  t
} from '../js/i18n.js';

test('locale normalization accepts supported regional language tags', () => {
  assert.equal(normalizeLocale('fr-CA'), 'fr');
  assert.equal(normalizeLocale('es_MX'), 'es');
  assert.equal(normalizeLocale('ar-SA'), 'ar');
  assert.equal(normalizeLocale('de-DE'), 'en');
});

test('initial locale uses profile, device, browser, then English priority', () => {
  assert.equal(resolveInitialLocale({ profileLocale: 'ar', storedLocale: 'es', browserLocales: ['fr-CA'] }), 'ar');
  assert.equal(resolveInitialLocale({ storedLocale: 'es', browserLocales: ['fr-CA'] }), 'es');
  assert.equal(resolveInitialLocale({ browserLocales: ['fr-CA'] }), 'fr');
  assert.equal(resolveInitialLocale({ browserLocales: ['de-DE'] }), 'en');
});

test('all supported catalogs match the English key contract', () => {
  const expected = catalogKeys('en');
  for (const locale of ['fr', 'es', 'ar']) {
    assert.deepEqual(missingCatalogKeys(locale), [], `${locale} has missing keys`);
    assert.deepEqual(catalogKeys(locale), expected, `${locale} has extra or mismatched keys`);
  }
});

test('translations interpolate values and fall back to English', () => {
  setLocale('fr', { persistLocal: false, emit: false });
  assert.equal(t('language.saved', { language: 'Français' }), 'Langue changée en Français.');
  assert.equal(t('missing.key', {}, { fallback: 'Fallback' }), 'Fallback');
});

test('language preferences are versioned and Arabic is RTL', () => {
  assert.deepEqual(languagePrefs('es'), { locale: 'es', schemaVersion: 1 });
  assert.deepEqual(normalizeLanguagePrefs({ locale: 'fr-FR' }), { locale: 'fr', schemaVersion: 1 });
  assert.equal(normalizeLanguagePrefs({ locale: 'de' }), null);
  assert.equal(getDirection('ar'), 'rtl');
  assert.equal(getDirection('en'), 'ltr');
});
