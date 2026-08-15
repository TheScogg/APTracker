import en from './locales/en.js';
import fr from './locales/fr.js';
import es from './locales/es.js';
import ar from './locales/ar.js';

export const DEFAULT_LOCALE = 'en';
export const LOCALE_STORAGE_KEY = 'apTrackerLocale';
export const SUPPORTED_LOCALES = Object.freeze({
  en: { code: 'en', labelKey: 'language.english', direction: 'ltr' },
  fr: { code: 'fr', labelKey: 'language.french', direction: 'ltr' },
  es: { code: 'es', labelKey: 'language.spanish', direction: 'ltr' },
  ar: { code: 'ar', labelKey: 'language.arabic', direction: 'rtl' },
});

const catalogs = { en, fr, es, ar };
let activeLocale = DEFAULT_LOCALE;

export function normalizeLocale(value, fallback = DEFAULT_LOCALE) {
  const normalized = String(value || '').trim().toLowerCase().replace('_', '-').split('-')[0];
  return Object.hasOwn(SUPPORTED_LOCALES, normalized) ? normalized : fallback;
}

export function normalizeLanguagePrefs(value) {
  const candidate = typeof value === 'string' ? value : value?.locale;
  const locale = normalizeLocale(candidate, '');
  return locale ? { locale, schemaVersion: 1 } : null;
}

export function resolveInitialLocale({ profileLocale, storedLocale, browserLocales } = {}) {
  const candidates = [
    typeof profileLocale === 'object' ? profileLocale?.locale : profileLocale,
    storedLocale,
    ...(Array.isArray(browserLocales) ? browserLocales : [browserLocales]),
  ];
  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate, '');
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export function getLocale() {
  return activeLocale;
}

export function getDirection(locale = activeLocale) {
  return SUPPORTED_LOCALES[normalizeLocale(locale)]?.direction || 'ltr';
}

export function t(key, variables = {}, options = {}) {
  const locale = normalizeLocale(options.locale || activeLocale);
  const fallback = options.fallback;
  let message = catalogs[locale]?.[key] ?? catalogs.en[key] ?? fallback ?? key;
  message = String(message);
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
    Object.hasOwn(variables, name) ? String(variables[name]) : match
  ));
}

function browserLocaleCandidates() {
  if (typeof navigator === 'undefined') return [];
  return Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language];
}

export function readStoredLocale() {
  if (typeof localStorage === 'undefined') return '';
  try { return localStorage.getItem(LOCALE_STORAGE_KEY) || ''; } catch (_) { return ''; }
}

export function detectInitialLocale(profileLocale = '') {
  return resolveInitialLocale({
    profileLocale,
    storedLocale: readStoredLocale(),
    browserLocales: browserLocaleCandidates(),
  });
}

export function applyTranslations(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n);
  });
  const attributes = [
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-title', 'title'],
    ['data-i18n-aria-label', 'aria-label'],
  ];
  attributes.forEach(([dataAttribute, targetAttribute]) => {
    root.querySelectorAll(`[${dataAttribute}]`).forEach(element => {
      element.setAttribute(targetAttribute, t(element.getAttribute(dataAttribute)));
    });
  });
  root.querySelectorAll('[data-language-option]').forEach(option => {
    const locale = normalizeLocale(option.getAttribute('data-language-option'));
    option.textContent = t(SUPPORTED_LOCALES[locale].labelKey);
    option.toggleAttribute('selected', locale === activeLocale);
  });
  const select = root.querySelector('#language-select');
  if (select) select.value = activeLocale;
}

export function setLocale(locale, { persistLocal = true, emit = true } = {}) {
  const normalized = normalizeLocale(locale);
  const previous = activeLocale;
  activeLocale = normalized;
  if (persistLocal && typeof localStorage !== 'undefined') {
    try { localStorage.setItem(LOCALE_STORAGE_KEY, normalized); } catch (_) { }
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = normalized;
    document.documentElement.dir = getDirection(normalized);
    document.body?.classList.toggle('rtl', normalized === 'ar');
    applyTranslations(document);
    if (emit && (previous !== normalized || !document.documentElement.dataset.localeReady)) {
      document.documentElement.dataset.localeReady = 'true';
      document.dispatchEvent(new CustomEvent('aptracker:localechange', { detail: { locale: normalized, previous } }));
    }
  }
  return normalized;
}

export function languagePrefs(locale = activeLocale) {
  return { locale: normalizeLocale(locale), schemaVersion: 1 };
}

export function formatDate(value, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(activeLocale, options).format(date);
}

export function formatNumber(value, options = {}) {
  return new Intl.NumberFormat(activeLocale, options).format(value);
}

export function catalogKeys(locale = DEFAULT_LOCALE) {
  return Object.keys(catalogs[normalizeLocale(locale)] || {}).sort();
}

export function missingCatalogKeys(locale) {
  const target = new Set(catalogKeys(locale));
  return catalogKeys(DEFAULT_LOCALE).filter(key => !target.has(key));
}
