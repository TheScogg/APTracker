export function deepCopy(obj) {
  if (obj === undefined) return undefined;
  return JSON.parse(JSON.stringify(obj));
}

export function normalizeSubsInput(value) {
  return String(value || '')
    .split(/\n|,/)
    .map(v => v.trim())
    .filter(Boolean)
    .sort(compareSubcategoryLabels);
}

const SUBCATEGORY_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

export function compareSubcategoryLabels(a, b) {
  const left = typeof a === 'string' ? a : String(a?.label || a?.subcategory || a || '');
  const right = typeof b === 'string' ? b : String(b?.label || b?.subcategory || b || '');
  return SUBCATEGORY_COLLATOR.compare(left.trim(), right.trim());
}

export function slugifyStatusLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '') || 'status';
}

export function statusKeyFromLabel(label, statuses = {}) {
  const base = slugifyStatusLabel(label);
  let key = base;
  let n = 2;
  while (statuses[key]) {
    key = `${base}${n}`;
    n += 1;
  }
  return key;
}

export function routeKeyFromLabel(label, routes = {}) {
  const base = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'subcategory';
  let key = base;
  let n = 2;
  while (routes[key]) {
    key = `${base}_${n}`;
    n += 1;
  }
  return key;
}

export function responseTreeEdgeId(sourceKey, targetKey, existingEdges = []) {
  const base = `${String(sourceKey || 'source').trim().toLowerCase()}_to_${String(targetKey || 'target').trim().toLowerCase()}`
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'edge';
  const used = new Set((existingEdges || []).map(edge => String(edge?.id || '').trim()).filter(Boolean));
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}_${n}`;
    n += 1;
  }
  return id;
}

export function assignableStatusKeys(statuses = {}) {
  return Object.entries(statuses || {})
    .filter(([key]) => key !== 'open' && key !== 'resolved' && !String(key || '').startsWith('__'))
    .sort((a, b) => (a[1]?.order ?? 999) - (b[1]?.order ?? 999))
    .map(([key]) => key);
}

export function normalizeStatusRecord(key, item, order) {
  const safeLabel = String(item?.label || key || 'Status').trim() || key;
  const slug = slugifyStatusLabel(safeLabel);
  const color = String(item?.cssColor || item?.swipeColor || '#8b949e');
  const icon = String(item?.icon || '●');
  const defaultIconUpgrades = {
    open: { '●': '📍', '＋': '📍' },
    attention: { '◇': '⚠️', '👁️': '⚠️' }
  };
  return {
    label: safeLabel,
    shortLabel: String(item?.shortLabel || safeLabel),
    icon: defaultIconUpgrades[key]?.[icon] || icon,
    cssColor: color,
    swipeColor: String(item?.swipeColor || color),
    floorCls: String(item?.floorCls || (key === 'resolved' ? 'all-resolved' : `has-${slug}`)),
    cls: String(item?.cls || `status-${slug}`),
    subs: Array.isArray(item?.subs) ? item.subs.map(v => String(v).trim()).filter(Boolean).sort(compareSubcategoryLabels) : [],
    statLabel: String(item?.statLabel || safeLabel),
    order: Number.isFinite(Number(item?.order)) ? Number(item.order) : order
  };
}

function addUniqueSub(subs, label) {
  const safeLabel = String(label || '').trim();
  if (!safeLabel) return;
  if (!subs.some(sub => sub.toLowerCase() === safeLabel.toLowerCase())) subs.push(safeLabel);
}

export function migrateRetiredStatusCategories(statuses = {}) {
  const migrated = deepCopy(statuses || {});
  if (!migrated.attention) return migrated;

  migrated.attention.subs = Array.isArray(migrated.attention.subs)
    ? migrated.attention.subs.map(v => String(v || '').trim()).filter(Boolean)
    : [];

  if (migrated.open) {
    migrated.open.subs = Array.isArray(migrated.open.subs)
      ? migrated.open.subs.map(v => String(v || '').trim()).filter(sub => sub.toLowerCase() !== 'do020: trial run')
      : [];
  }
  addUniqueSub(migrated.attention.subs, 'DO020: Trial Run');

  if (migrated.alert) {
    (Array.isArray(migrated.alert.subs) ? migrated.alert.subs : [])
      .forEach(sub => addUniqueSub(migrated.attention.subs, sub));
    delete migrated.alert;
  }

  migrated.attention.order = Number.isFinite(Number(migrated.attention.order))
    ? Math.min(Number(migrated.attention.order), 1)
    : 1;
  return migrated;
}

export function normalizeStatusesForSave(rawStatuses = {}, defaultStatuses = {}, canonicalOptionalStatuses = {}) {
  const normalized = {};
  const entries = Object.entries(rawStatuses || {}).sort((a, b) => (a[1]?.order ?? 999) - (b[1]?.order ?? 999));
  entries.forEach(([key, item], idx) => {
    if (String(key || '').startsWith('__')) return;
    normalized[key] = normalizeStatusRecord(key, item, idx);
  });
  if (!normalized.open && defaultStatuses.open) normalized.open = normalizeStatusRecord('open', defaultStatuses.open, 0);
  if (!normalized.resolved && defaultStatuses.resolved) {
    normalized.resolved = normalizeStatusRecord('resolved', defaultStatuses.resolved, Object.keys(normalized).length);
  }
  Object.entries(canonicalOptionalStatuses || {}).forEach(([key, value]) => {
    if (!normalized[key]) normalized[key] = normalizeStatusRecord(key, value, Object.keys(normalized).length);
  });
  return migrateRetiredStatusCategories(normalized);
}

export function normalizeResponseTree(rawTree = {}, statuses = {}, routes = {}) {
  const validStatusKeys = new Set(assignableStatusKeys(statuses));
  const validRouteKeys = new Set(Object.entries(routes || {})
    .filter(([, route]) => route?.isActive !== false)
    .map(([key]) => String(key || '').trim())
    .filter(Boolean));
  const rawEdges = Array.isArray(rawTree?.edges) ? rawTree.edges : [];
  const normalizedEdges = [];
  const seenIds = new Set();

  rawEdges.forEach((edge, idx) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) return;
    const sourceKey = String(edge.sourceKey || edge.from || '').trim().toLowerCase();
    const targetKey = String(edge.targetKey || edge.to || '').trim().toLowerCase();
    if (!validStatusKeys.has(sourceKey) || !validStatusKeys.has(targetKey) || sourceKey === targetKey) return;
    const legacyRouteKeys = Array.isArray(edge.routeKeys)
      ? Array.from(new Set(edge.routeKeys
        .map(v => String(v || '').trim())
        .filter(v => validRouteKeys.has(v))))
      : [];
    const sourceRouteKey = String(edge.sourceRouteKey || edge.routeKey || legacyRouteKeys[0] || '').trim();
    const targetRouteKey = String(edge.targetRouteKey || edge.toRouteKey || legacyRouteKeys[0] || sourceRouteKey || '').trim();
    const cleanSourceRouteKey = validRouteKeys.has(sourceRouteKey) ? sourceRouteKey : '';
    const cleanTargetRouteKey = validRouteKeys.has(targetRouteKey) ? targetRouteKey : cleanSourceRouteKey;
    const mode = cleanSourceRouteKey && cleanTargetRouteKey && cleanSourceRouteKey !== cleanTargetRouteKey ? 'translate' : 'pass-through';
    const routeKeys = cleanSourceRouteKey ? [cleanSourceRouteKey] : [];
    const trigger = String(edge.trigger || edge.label || '').trim();
    const fallbackId = responseTreeEdgeId(sourceKey, targetKey, normalizedEdges);
    let id = String(edge.id || fallbackId).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    if (!id || seenIds.has(id)) id = responseTreeEdgeId(sourceKey, targetKey, normalizedEdges);
    seenIds.add(id);
    normalizedEdges.push({
      id,
      sourceKey,
      targetKey,
      trigger: trigger || 'Suggested response path',
      sourceRouteKey: cleanSourceRouteKey,
      targetRouteKey: cleanTargetRouteKey,
      mode,
      routeKeys,
      isActive: edge.isActive !== false,
      order: Number.isFinite(Number(edge.order)) ? Number(edge.order) : idx
    });
  });

  return {
    version: 1,
    edges: normalizedEdges.sort((a, b) =>
      (a.order ?? 999) - (b.order ?? 999)
      || a.sourceKey.localeCompare(b.sourceKey)
      || a.targetKey.localeCompare(b.targetKey)
    )
  };
}

export function stripResponseTreeFromStatuses(statuses = {}) {
  const clean = {};
  Object.entries(statuses || {}).forEach(([key, value]) => {
    if (!String(key || '').startsWith('__')) clean[key] = value;
  });
  return clean;
}

export function attachResponseTreeToStatuses(statuses = {}, responseTree = {}) {
  const clean = stripResponseTreeFromStatuses(statuses);
  const edges = Array.isArray(responseTree?.edges) ? responseTree.edges : [];
  return edges.length ? { ...clean, __responseTree: { version: 1, edges } } : clean;
}

export function normalizeSubcategoryRoutes(rawRoutes, statuses = {}, options = {}) {
  const {
    includeStatusSubs = false,
    lowercaseRouteKeys = false,
    lowercaseBoundStatusKeys = false,
    sortRoutes = true
  } = options;
  if (!rawRoutes || typeof rawRoutes !== 'object' || Array.isArray(rawRoutes)) {
    rawRoutes = {};
  }

  const normalized = {};
  const validStatusKeys = new Set(assignableStatusKeys(statuses));
  const labelToKey = new Map();

  Object.entries(rawRoutes || {}).forEach(([rawKey, raw], idx) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const label = String(raw.label || raw.subcategory || rawKey || '').trim();
    if (!label) return;
    const fallbackKey = lowercaseRouteKeys
      ? String(rawKey || label).trim().toLowerCase()
      : routeKeyFromLabel(label, normalized);
    const key = String(rawKey || '').trim()
      ? (lowercaseRouteKeys ? String(rawKey).trim().toLowerCase() : String(rawKey).trim())
      : fallbackKey;
    const boundSource = raw.boundStatusKeys || raw.categoryKeys || raw.statusKeys || [];
    const boundStatusKeys = Array.isArray(boundSource)
      ? Array.from(new Set(boundSource
        .map(v => String(v || '').trim())
        .map(v => lowercaseBoundStatusKeys ? v.toLowerCase() : v)
        .filter(v => validStatusKeys.has(v))))
      : [];
    normalized[key] = {
      label,
      boundStatusKeys,
      isActive: raw.isActive !== false,
      order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : idx
    };
    labelToKey.set(label.toLowerCase(), key);
  });

  if (includeStatusSubs) {
    Object.entries(statuses || {}).forEach(([statusKey, status]) => {
      if (!validStatusKeys.has(statusKey)) return;
      (status.subs || []).forEach(sub => {
        const label = String(sub || '').trim();
        if (!label) return;
        const labelKey = label.toLowerCase();
        const existingKey = labelToKey.get(labelKey);
        if (existingKey) {
          const route = normalized[existingKey];
          if (!route.boundStatusKeys.includes(statusKey)) route.boundStatusKeys.push(statusKey);
          return;
        }
        const key = routeKeyFromLabel(label, normalized);
        normalized[key] = {
          label,
          boundStatusKeys: [statusKey],
          isActive: true,
          order: Object.keys(normalized).length
        };
        labelToKey.set(labelKey, key);
      });
    });
  }

  if (!sortRoutes) return normalized;
  return Object.fromEntries(Object.entries(normalized).sort((a, b) =>
    compareSubcategoryLabels(a[1]?.label, b[1]?.label)
    || (a[1].order ?? 999) - (b[1].order ?? 999)
  ));
}

export function syncStatusesFromSubcategoryRoutes(statuses, routes) {
  const synced = deepCopy(stripResponseTreeFromStatuses(statuses || {}));
  const validStatusKeys = assignableStatusKeys(synced);
  const routeLabels = new Set(Object.values(routes || {})
    .map(route => String(route?.label || '').trim().toLowerCase())
    .filter(Boolean));

  validStatusKeys.forEach(statusKey => {
    synced[statusKey].subs = Array.isArray(synced[statusKey].subs)
      ? synced[statusKey].subs.map(v => String(v || '').trim()).filter(Boolean)
      : [];
    if (routeLabels.size) {
      synced[statusKey].subs = synced[statusKey].subs.filter(sub => !routeLabels.has(sub.toLowerCase()));
    }
  });

  Object.values(routes || {}).forEach(route => {
    if (!route || route.isActive === false) return;
    const label = String(route.label || '').trim();
    if (!label) return;
    (route.boundStatusKeys || []).forEach(statusKey => {
      if (!validStatusKeys.includes(statusKey) || !synced[statusKey]) return;
      const exists = (synced[statusKey].subs || []).some(sub => sub.toLowerCase() === label.toLowerCase());
      if (!exists) synced[statusKey].subs.push(label);
    });
  });

  validStatusKeys.forEach(statusKey => {
    synced[statusKey].subs = Array.from(new Map((synced[statusKey].subs || [])
      .map(sub => [sub.toLowerCase(), sub])).values())
      .sort(compareSubcategoryLabels);
  });
  return synced;
}
