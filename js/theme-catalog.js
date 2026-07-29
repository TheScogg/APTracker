import {
  BUILT_IN_THEME_DEFS,
  getCustomThemeKey,
  inferThemeModeFromVars,
  normalizeThemeColors,
  normalizeThemeSelectionKey,
  normalizeThemeVars,
  themeLabelSansIcon
} from './theme-engine.js';

export function createBuiltInThemeStoreItems(themeDefs = BUILT_IN_THEME_DEFS) {
  return themeDefs.map(theme => ({
    id: `theme_${theme.key}`,
    type: 'theme',
    themeKey: theme.key,
    customVars: null,
    name: theme.name,
    price: Number(theme.price || 0),
    isActive: true,
    order: Number(theme.order || 0)
  }));
}

export function normalizeThemeStoreItem(item = {}, fallbackOrder = 0) {
  if (!item || typeof item !== 'object') return null;
  const themeKey = item.themeKey ? String(item.themeKey).trim() : null;
  const id = themeKey ? `theme_${themeKey}` : (String(item.id || '').trim() || `storeitem_${fallbackOrder}`);
  const customVars = item.customVars && typeof item.customVars === 'object'
    ? normalizeThemeVars(item.customVars)
    : null;
  return {
    ...item,
    id,
    type: 'theme',
    themeKey,
    name: String(item.name || 'Theme').trim() || 'Theme',
    price: Math.max(0, Number(item.price || 0)),
    isActive: item.isActive !== false,
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : fallbackOrder,
    customVars
  };
}

export function normalizeStoreItems(rawItems = [], options = {}) {
  const { defaults = createBuiltInThemeStoreItems() } = options;
  const byId = new Map();
  const addItem = (item, idx) => {
    if (!item || typeof item !== 'object') return;
    const type = String(item.type || 'theme');
    if (type !== 'theme') {
      const id = String(item.id || '').trim() || `storeitem_${idx}`;
      byId.set(id, {
        ...(byId.get(id) || {}),
        ...item,
        id,
        type,
        name: String(item.name || 'Store Item').trim() || 'Store Item',
        price: Math.max(0, Number(item.price || 0)),
        isActive: item.isActive !== false,
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : idx
      });
      return;
    }
    const normalized = normalizeThemeStoreItem(item, idx);
    if (!normalized?.id) return;
    byId.set(normalized.id, {
      ...(byId.get(normalized.id) || {}),
      ...normalized
    });
  };
  (Array.isArray(defaults) ? defaults : []).forEach(addItem);
  (Array.isArray(rawItems) ? rawItems : []).forEach(addItem);
  return [...byId.values()].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

export function getStoreItemForTheme(storeItems = [], themeKey) {
  const key = String(themeKey || '').trim();
  return (Array.isArray(storeItems) ? storeItems : [])
    .find(item => item?.type === 'theme' && item?.themeKey === key && item?.isActive !== false) || null;
}

export function buildThemeCatalog(options = {}) {
  const {
    builtInThemeDefs = BUILT_IN_THEME_DEFS,
    storeItems = [],
    customThemes = [],
    unlockedItems = [],
    includeUnpublishedBuiltInsWhenEmpty = true
  } = options;
  const unlocked = new Set(Array.isArray(unlockedItems) ? unlockedItems.map(String) : []);
  const builtInVarsByKey = new Map(builtInThemeDefs.map(theme => [theme.key, { ...theme.vars }]));
  const publishedBuiltInThemeKeys = new Set(
    (Array.isArray(storeItems) ? storeItems : [])
      .filter(item => item?.type === 'theme' && item?.isActive !== false && item?.themeKey)
      .map(item => String(item.themeKey))
  );
  if (includeUnpublishedBuiltInsWhenEmpty && !publishedBuiltInThemeKeys.size) {
    builtInThemeDefs.forEach(theme => publishedBuiltInThemeKeys.add(theme.key));
  }

  const builtIns = builtInThemeDefs
    .filter(theme => publishedBuiltInThemeKeys.has(theme.key))
    .map(theme => {
      const storeItem = getStoreItemForTheme(storeItems, theme.key);
      const price = Math.max(0, Number(storeItem?.price || 0));
      const isFree = !storeItem || price <= 0;
      const vars = normalizeThemeVars(builtInVarsByKey.get(theme.key) || {});
      return {
        key: theme.key,
        source: 'builtin',
        label: theme.label,
        shortLabel: themeLabelSansIcon(theme.label),
        colors: normalizeThemeColors(theme.colors, vars),
        vars,
        mode: theme.mode || inferThemeModeFromVars(vars),
        storeItemId: storeItem?.id || null,
        sortOrder: Number(storeItem?.order ?? theme.order ?? 9999),
        price,
        isFree,
        isOwned: isFree || !storeItem || unlocked.has(storeItem.id)
      };
    });

  const savedCustomThemes = (Array.isArray(customThemes) ? customThemes : [])
    .slice()
    .reverse()
    .filter(theme => theme && typeof theme === 'object')
    .map((theme, idx) => {
      const vars = normalizeThemeVars(theme.vars || {});
      return {
        key: getCustomThemeKey(theme.id),
        source: 'saved-custom',
        label: `🎨 ${theme.name || 'Custom Theme'}`,
        shortLabel: theme.name || 'Custom',
        colors: normalizeThemeColors(null, vars),
        vars,
        mode: inferThemeModeFromVars(vars),
        storeItemId: null,
        sortOrder: 50000 + idx,
        price: 0,
        isFree: true,
        isOwned: true
      };
    })
    .filter(theme => !!theme.key && !!theme.vars);

  const storeCustomThemes = (Array.isArray(storeItems) ? storeItems : [])
    .filter(item => item?.type === 'theme' && item?.isActive !== false && !item?.themeKey && item?.customVars)
    .map(item => {
      const vars = normalizeThemeVars(item.customVars);
      const price = Math.max(0, Number(item.price || 0));
      return {
        key: `storetheme_${item.id}`,
        source: 'store-custom',
        label: `🎨 ${item.name || 'Custom Theme'}`,
        shortLabel: item.name || 'Custom Theme',
        colors: normalizeThemeColors(null, vars),
        vars,
        mode: inferThemeModeFromVars(vars),
        storeItemId: item.id,
        sortOrder: Number(item.order ?? 9999),
        price,
        isFree: price <= 0,
        isOwned: price <= 0 || unlocked.has(item.id)
      };
    });

  return [...builtIns, ...savedCustomThemes, ...storeCustomThemes]
    .filter(theme => theme && typeof theme === 'object' && !!theme.key)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
    .map(theme => ({ ...theme, colors: normalizeThemeColors(theme.colors, theme.vars) }));
}

export function getThemeCatalogEntry(catalog = [], selection, options = {}) {
  const key = normalizeThemeSelectionKey(selection, options);
  return (Array.isArray(catalog) ? catalog : []).find(theme => theme.key === key) || null;
}

export function isThemeLocked(catalog = [], selection, options = {}) {
  const theme = getThemeCatalogEntry(catalog, selection, options);
  return !!theme && !theme.isOwned;
}
