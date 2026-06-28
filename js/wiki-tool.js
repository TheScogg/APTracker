export function initWikiTool(deps) {
  const {
    getCurrentUser, getCurrentPlantId, getCurrentUserRole, getPresses, currentActor,
    toPressId, esc, alphaColor, localDateStr,
    completeDemoGuideStep, readFileAsDataUrl, uploadAttachmentToPreferredStorage,
    _bindToolModalShellNavigation, shouldUseSqlStagingReads, requireSqlRead, dataApi,
    doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
    onSnapshot, query, where, orderBy, limit, serverTimestamp, writeBatch, runTransaction, increment,
    firebasePaths, db, parseDataUrlMeta, extFromContentType,
    _closeToolModalByKey, _cycleToolModal, closeUserMenus, closeSortDropdown, _relativeTime,
    pressWikiPagesCol, pressWikiPageDoc, pressWikiRevisionsCol, pressWikiAttachmentsCol,
    wikiCollectionPath, wikiPagesColForScope, wikiPageDocForScope,
    wikiRevisionsColForScope, wikiAttachmentsColForScope, wikiStoragePrefixForScope
  } = deps;

  const WIKI_SCOPE_PRESS = 'press';
  const WIKI_SCOPE_SHARED = 'shared';

  let _pressWikiScope = WIKI_SCOPE_PRESS;

let _pressWikiModalPressId = null;
let _pressWikiSelectedPressId = null;
let _pressWikiSelectedPageId = null;
let _pressWikiCanEdit = false;
let _pressWikiAttachmentsCache = [];
let _pressWikiMachineCode = null;
let _pressWikiRenderedBodyRaw = '';
let _pressWikiPageListCache = [];
let _pressWikiExpandedPageIds = new Set();
let _pressWikiKnownTreeNodeIds = new Set();
let _pressWikiPickerOpen = false;
let _pressWikiPressPickerOpen = false;
const PRESS_WIKI_SHARED_INDEX_PAGE_ID = 'shared-library-index';

function _pressWikiStateSnapshot() {
  return {
    modalPressId: _pressWikiModalPressId,
    selectedPressId: _pressWikiSelectedPressId,
    selectedPageId: _pressWikiSelectedPageId,
    machineCode: _pressWikiMachineCode,
    scope: _pressWikiScope
  };
}

function _pressWikiHasRestorableState() {
  return Boolean(
    _pressWikiSelectedPageId ||
    _pressWikiModalPressId ||
    _pressWikiSelectedPressId ||
    _pressWikiMachineCode ||
    _pressWikiExpandedPageIds?.size ||
    _pressWikiKnownTreeNodeIds?.size
  );
}

function _pressWikiResolveKnownPressId(...values) {
  for (const value of values) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    if (_pressWikiIsKnownPressId(raw)) return raw;
    const normalized = toPressId(raw);
    if (_pressWikiIsKnownPressId(normalized)) return normalized;
  }
  return null;
}

function _pressWikiClearState() {
  _pressWikiModalPressId = null;
  _pressWikiSelectedPressId = null;
  _pressWikiSelectedPageId = null;
  _pressWikiMachineCode = null;
  _pressWikiRenderedBodyRaw = '';
  _pressWikiAttachmentsCache = [];
  _pressWikiPageListCache = [];
  _pressWikiExpandedPageIds = new Set();
  _pressWikiKnownTreeNodeIds = new Set();
  _pressWikiScope = WIKI_SCOPE_PRESS;
}

function _pressWikiScopeLabel(scope = _pressWikiScope) {
  return scope === WIKI_SCOPE_SHARED ? 'Shared Library' : 'This Press';
}

function _pressWikiBaseTitle(scope = _pressWikiScope) {
  return scope === WIKI_SCOPE_SHARED ? 'Shared Library' : 'Shift Notes';
}

function _pressWikiEmptySelectionMessage(scope = _pressWikiScope) {
  return scope === WIKI_SCOPE_SHARED
    ? 'The shared library is empty. Create the first page to seed it.'
    : 'Choose a press to view its wiki pages.';
}

function _pressWikiIsKnownPressId(pressId) {
  const target = String(pressId || '').trim();
  if (!target) return false;
  return Object.values(getPresses() || {}).some(machines => (machines || []).some(machineCode => toPressId(machineCode) === target));
}

function _pressWikiPressInfo(pressId) {
  const target = String(pressId || '').trim();
  if (!target) return null;
  for (const [rowName, machines] of Object.entries(getPresses() || {})) {
    for (const machineCode of (machines || [])) {
      if (toPressId(machineCode) === target) {
        return {
          pressId: target,
          machineCode: String(machineCode || '').trim(),
          rowName: String(rowName || '').trim(),
          label: String(machineCode || '').trim()
        };
      }
    }
  }
  return null;
}

function _pressWikiDefaultSharedPageId(sourcePages = _pressWikiPageListCache) {
  const pages = Array.isArray(sourcePages) ? sourcePages : [];
  const targetSlug = _pressWikiSlugify('Shared Library Index');
  const match = pages.find(page => {
    const pageTitle = String(page?.title || '').trim();
    const pageSlug = _pressWikiSlugify(page?.slug || page?.id || pageTitle);
    return page?.id === PRESS_WIKI_SHARED_INDEX_PAGE_ID ||
      pageSlug === targetSlug ||
      _pressWikiSlugify(pageTitle) === targetSlug;
  });
  return match?.id || PRESS_WIKI_SHARED_INDEX_PAGE_ID;
}

function _pressWikiRowSortValue(rowName) {
  const raw = String(rowName || '').trim();
  const match = raw.match(/(\d+)/);
  if (match) return Number(match[1]);
  if (!raw) return Number.MAX_SAFE_INTEGER - 1;
  if (raw.toLowerCase() === 'other') return Number.MAX_SAFE_INTEGER;
  return 1000 + raw.toLowerCase().charCodeAt(0);
}

function _pressWikiActivePressId() {
  if (_pressWikiScope !== WIKI_SCOPE_PRESS) return null;
  if (_pressWikiSelectedPressId && _pressWikiIsKnownPressId(_pressWikiSelectedPressId)) return _pressWikiSelectedPressId;
  if (_pressWikiIsKnownPressId(_pressWikiModalPressId)) return _pressWikiModalPressId;
  return null;
}

function _pressWikiSetPressPickerOpen(open) {
  _pressWikiPressPickerOpen = Boolean(open) && _pressWikiScope === WIKI_SCOPE_PRESS;
  const wrap = document.querySelector('.press-wiki-press-picker-wrap');
  const btn = document.getElementById('press-wiki-scope-press');
  if (wrap) {
    wrap.classList.toggle('visible', _pressWikiPressPickerOpen);
    wrap.style.display = _pressWikiPressPickerOpen ? 'flex' : 'none';
  }
  if (btn) btn.setAttribute('aria-expanded', String(_pressWikiPressPickerOpen));
  renderPressWikiPressPicker();
}

function _pressWikiSyncPressPickerSummary() {
  const panelCopy = document.getElementById('press-wiki-press-picker-panel-copy');
  if (!panelCopy) return;
  panelCopy.textContent = _pressWikiActivePressId()
    ? 'Pick a different press to switch wiki context.'
    : 'Pick a press to load its wiki.';
}

async function _pressWikiSelectPress(pressId) {
  const info = _pressWikiPressInfo(pressId);
  if (!info) return;
  _pressWikiSelectedPressId = info.pressId;
  _pressWikiModalPressId = info.pressId;
  _pressWikiMachineCode = info.machineCode;
  _pressWikiSetScope(WIKI_SCOPE_PRESS, { reload: false });
  await loadPressWikiPageList();
  if (_pressWikiSelectedPageId) {
    await loadPressWikiPage(_pressWikiSelectedPageId);
  } else {
    renderPressWikiEmptySelection(_pressWikiEmptySelectionMessage());
  }
}

function renderPressWikiPressPicker() {
  const wrap = document.querySelector('.press-wiki-press-picker-wrap');
  const treeEl = document.getElementById('press-wiki-press-picker-tree');
  const closeBtn = document.getElementById('press-wiki-press-picker-close');
  const pressBtn = document.getElementById('press-wiki-scope-press');
  if (!wrap || !treeEl || !pressBtn) return;
  const activePressId = _pressWikiActivePressId();
  const showPicker = _pressWikiScope === WIKI_SCOPE_PRESS && _pressWikiPressPickerOpen;

  wrap.style.display = showPicker ? '' : 'none';
  treeEl.innerHTML = '';

  if (!showPicker) {
    return;
  }

  wrap.classList.add('visible');
  wrap.setAttribute('aria-hidden', 'false');

  _pressWikiSyncPressPickerSummary();
  if (closeBtn) {
    closeBtn.onclick = () => _pressWikiSetPressPickerOpen(false);
  }

  const rowEntries = Object.entries(getPresses() || {})
    .map(([rowName, machines]) => ({
      rowName: String(rowName || '').trim(),
      rowSort: _pressWikiRowSortValue(rowName),
      machines: (machines || []).map(machineCode => String(machineCode || '').trim()).filter(Boolean)
    }))
    .sort((a, b) => a.rowSort - b.rowSort || a.rowName.localeCompare(b.rowName));

  if (!rowEntries.length) {
    treeEl.innerHTML = '<div class="press-wiki-press-picker-empty">No presses found in this plant.</div>';
    return;
  }

  rowEntries.forEach(({ rowName, machines }) => {
    if (!machines.length) return;
    const section = document.createElement('div');
    section.className = 'press-wiki-press-picker-row';
    const label = document.createElement('div');
    label.className = 'press-wiki-press-picker-row-label';
    label.textContent = rowName;
    const grid = document.createElement('div');
    grid.className = 'press-wiki-press-picker-grid';
    machines.forEach(machineCode => {
      const pressId = toPressId(machineCode);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `press-wiki-press-picker-item ${activePressId === pressId ? 'active' : ''}`;
      item.setAttribute('aria-current', activePressId === pressId ? 'true' : 'false');
      item.textContent = machineCode || pressId;
      item.onclick = () => {
        void _pressWikiSelectPress(pressId);
      };
      grid.appendChild(item);
    });
    section.appendChild(label);
    section.appendChild(grid);
    treeEl.appendChild(section);
  });
}

function _pressWikiNormalizeParentId(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : null;
}

function _pressWikiSortValue(page, fallbackIndex = 0) {
  const raw = Number(page?.sortOrder);
  return Number.isFinite(raw) ? raw : fallbackIndex;
}

function _pressWikiComparePages(a, b) {
  const sortDelta = _pressWikiSortValue(a) - _pressWikiSortValue(b);
  if (sortDelta !== 0) return sortDelta;
  const titleDelta = String(a.title || '').localeCompare(String(b.title || ''));
  if (titleDelta !== 0) return titleDelta;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function _pressWikiBuildTree(sourcePages = _pressWikiPageListCache) {
  const nodesById = new Map();
  const parentById = new Map();
  const childrenById = new Map();
  const roots = [];

  sourcePages.forEach((page, index) => {
    if (!page?.id) return;
    nodesById.set(page.id, {
      ...page,
      parentPageId: _pressWikiNormalizeParentId(page.parentPageId),
      sortOrder: Number.isFinite(Number(page.sortOrder)) ? Number(page.sortOrder) : index
    });
  });

  nodesById.forEach((page, pageId) => {
    const parentId = page.parentPageId && nodesById.has(page.parentPageId) && page.parentPageId !== pageId
      ? page.parentPageId
      : null;
    parentById.set(pageId, parentId);
    if (parentId) {
      if (!childrenById.has(parentId)) childrenById.set(parentId, []);
      childrenById.get(parentId).push(page);
    } else {
      roots.push(page);
    }
  });

  const sortList = list => list.sort(_pressWikiComparePages);
  sortList(roots);
  childrenById.forEach(sortList);
  return { nodesById, parentById, childrenById, roots };
}

function _pressWikiDescendants(pageId, childrenById, output = new Set()) {
  const children = childrenById.get(pageId) || [];
  children.forEach(child => {
    if (!child?.id || output.has(child.id)) return;
    output.add(child.id);
    _pressWikiDescendants(child.id, childrenById, output);
  });
  return output;
}

function _pressWikiAncestors(pageId, parentById) {
  const output = [];
  const seen = new Set();
  let parentId = parentById.get(pageId) || null;
  while (parentId && !seen.has(parentId)) {
    output.push(parentId);
    seen.add(parentId);
    parentId = parentById.get(parentId) || null;
  }
  return output;
}

function _pressWikiPickerLabelForScope(scope = _pressWikiScope) {
  return scope === WIKI_SCOPE_SHARED ? 'Shared Library' : _pressWikiPressLabel();
}

function _pressWikiPickerTrail(tree, pageId = _pressWikiSelectedPageId) {
  const page = tree?.nodesById?.get(pageId) || null;
  if (!page) {
    const pageCount = _pressWikiPageListCache.length;
    return {
      title: _pressWikiScope === WIKI_SCOPE_PRESS && !_pressWikiActivePressId()
        ? 'Choose a press'
        : 'No page selected',
      path: _pressWikiPickerLabelForScope(_pressWikiScope),
      count: `${pageCount} page${pageCount === 1 ? '' : 's'}`
    };
  }
  const ancestorNodes = _pressWikiAncestors(pageId, tree.parentById)
    .reverse()
    .map(id => tree.nodesById.get(id))
    .filter(Boolean);
  return {
    title: page.title || page.id || 'Untitled',
    path: [
      _pressWikiPickerLabelForScope(page.scope || _pressWikiScope),
      ...ancestorNodes.map(node => node.title || node.id || 'Untitled')
    ].join(' / '),
    count: `${_pressWikiPageListCache.length} page${_pressWikiPageListCache.length === 1 ? '' : 's'}`
  };
}

function _pressWikiSetPickerOpen(open) {
  _pressWikiPickerOpen = Boolean(open);
  const wrap = document.querySelector('.press-wiki-picker-wrap');
  const btn = document.getElementById('press-wiki-picker-btn');
  const panel = document.getElementById('press-wiki-picker-panel');
  if (wrap) wrap.classList.toggle('open', _pressWikiPickerOpen);
  if (btn) btn.setAttribute('aria-expanded', String(_pressWikiPickerOpen));
  if (panel) {
    panel.classList.toggle('visible', _pressWikiPickerOpen);
    panel.setAttribute('aria-hidden', String(!_pressWikiPickerOpen));
  }
}

function _pressWikiSyncPickerSummary(tree = null) {
  const titleEl = document.getElementById('press-wiki-picker-title');
  const pathEl = document.getElementById('press-wiki-picker-path');
  const countEl = document.getElementById('press-wiki-picker-count');
  if (!titleEl || !pathEl || !countEl) return;
  const summary = _pressWikiPickerTrail(tree, _pressWikiSelectedPageId);
  titleEl.textContent = summary.title;
  pathEl.textContent = summary.path;
  countEl.textContent = summary.count;
}

function _pressWikiRenderPickerNode(parentEl, node, tree, depth = 0) {
  const children = tree.childrenById.get(node.id) || [];
  const wrapper = document.createElement('div');
  wrapper.className = 'press-wiki-picker-node';
  wrapper.style.setProperty('--press-wiki-depth', String(depth));

  const row = document.createElement('div');
  row.className = `press-wiki-picker-row ${node.id === _pressWikiSelectedPageId ? 'active' : ''}`;
  row.style.setProperty('--press-wiki-depth', String(depth));

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'press-wiki-picker-toggle';
  toggle.disabled = !children.length;
  toggle.setAttribute('aria-label', children.length
    ? (_pressWikiExpandedPageIds.has(node.id) ? 'Collapse section' : 'Expand section')
    : 'Leaf page');
  toggle.textContent = children.length ? (_pressWikiExpandedPageIds.has(node.id) ? '▾' : '▸') : '•';
  if (!children.length) toggle.classList.add('leaf');
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!children.length) return;
    if (_pressWikiExpandedPageIds.has(node.id)) _pressWikiExpandedPageIds.delete(node.id);
    else _pressWikiExpandedPageIds.add(node.id);
    renderPressWikiPageTree();
  });

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'press-wiki-picker-main';
  main.setAttribute('aria-current', node.id === _pressWikiSelectedPageId ? 'page' : 'false');
  main.addEventListener('click', async (e) => {
    e.stopPropagation();
    await loadPressWikiPage(node.id);
    _pressWikiSetPickerOpen(false);
  });

  const copy = document.createElement('div');
  copy.className = 'press-wiki-picker-main-copy';
  const title = document.createElement('div');
  title.className = 'press-wiki-picker-row-title';
  title.textContent = node.title || node.id || 'Untitled';
  const meta = document.createElement('div');
  meta.className = 'press-wiki-picker-row-meta';
  meta.textContent = `${children.length ? `${children.length} child${children.length === 1 ? '' : 'ren'} · ` : ''}${node.id}`;
  copy.appendChild(title);
  copy.appendChild(meta);
  main.appendChild(copy);

  const badges = document.createElement('div');
  badges.className = 'press-wiki-picker-row-badges';
  const showSharedBadge = node.scope === WIKI_SCOPE_SHARED && node.id === PRESS_WIKI_SHARED_INDEX_PAGE_ID;
  if (node.scope === WIKI_SCOPE_SHARED || node.scope === WIKI_SCOPE_PRESS) {
    const scopeBadge = document.createElement('span');
    scopeBadge.className = `press-wiki-picker-scope ${node.scope === WIKI_SCOPE_SHARED ? 'shared' : 'press'}`;
    scopeBadge.textContent = showSharedBadge ? 'Shared' : 'Press';
    if (showSharedBadge || node.scope === WIKI_SCOPE_PRESS) badges.appendChild(scopeBadge);
  }
  if (node.id === _pressWikiSelectedPageId) {
    const currentBadge = document.createElement('span');
    currentBadge.className = 'press-wiki-picker-current';
    currentBadge.textContent = 'Current';
    badges.appendChild(currentBadge);
  }
  main.appendChild(badges);

  row.appendChild(toggle);
  row.appendChild(main);
  row.addEventListener('click', async () => {
    await loadPressWikiPage(node.id);
    _pressWikiSetPickerOpen(false);
  });
  wrapper.appendChild(row);

  if (children.length) {
    const childWrap = document.createElement('div');
    childWrap.className = 'press-wiki-picker-children';
    childWrap.style.display = _pressWikiExpandedPageIds.has(node.id) ? 'grid' : 'none';
    children.forEach(child => _pressWikiRenderPickerNode(childWrap, child, tree, depth + 1));
    wrapper.appendChild(childWrap);
  }

  parentEl.appendChild(wrapper);
}

function _pressWikiExpandDefaults(tree) {
  tree.nodesById.forEach((page, pageId) => {
    if (!_pressWikiKnownTreeNodeIds.has(pageId) && (tree.childrenById.get(pageId) || []).length > 0) {
      _pressWikiExpandedPageIds.add(pageId);
    }
    _pressWikiKnownTreeNodeIds.add(pageId);
  });
}

function _pressWikiRenderTreeNode(parentEl, node, tree, depth = 0) {
  const children = tree.childrenById.get(node.id) || [];
  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.gap = '2px';

  const row = document.createElement('div');
  row.style.width = '100%';
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.gap = '8px';
  row.style.padding = `10px 12px 10px ${12 + depth * 18}px`;
  row.style.borderBottom = '1px solid var(--color-border, var(--border))';
  row.style.background = node.id === _pressWikiSelectedPageId ? 'color-mix(in srgb, var(--ios-blue) 14%, transparent)' : 'transparent';
  row.style.color = 'var(--color-text, var(--text))';
  row.style.cursor = 'pointer';
  row.style.textAlign = 'left';

  const spacer = document.createElement('span');
  spacer.style.width = '22px';
  spacer.style.flex = '0 0 auto';

  if (children.length) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = _pressWikiExpandedPageIds.has(node.id) ? '▾' : '▸';
    toggle.style.width = '22px';
    toggle.style.height = '22px';
    toggle.style.borderRadius = '6px';
    toggle.style.border = '1px solid var(--color-border, var(--border))';
    toggle.style.background = 'var(--color-surface, var(--bg2))';
    toggle.style.color = 'var(--color-text-muted, var(--text2))';
    toggle.style.display = 'inline-flex';
    toggle.style.alignItems = 'center';
    toggle.style.justifyContent = 'center';
    toggle.onclick = (e) => {
      e.stopPropagation();
      if (_pressWikiExpandedPageIds.has(node.id)) _pressWikiExpandedPageIds.delete(node.id);
      else _pressWikiExpandedPageIds.add(node.id);
      renderPressWikiPageTree();
    };
    row.appendChild(toggle);
  } else {
    row.appendChild(spacer);
  }

  const main = document.createElement('div');
  main.style.flex = '1';
  main.style.minWidth = '0';
  const title = document.createElement('div');
  title.style.fontSize = '14px';
  title.style.fontWeight = '700';
  title.style.lineHeight = '1.2';
  title.textContent = node.title || node.id || 'Untitled';
  const meta = document.createElement('div');
  meta.style.fontSize = '11px';
  meta.style.color = 'var(--color-text-subtle, var(--text3))';
  meta.style.fontFamily = "'Share Tech Mono', monospace";
  meta.textContent = `Photos: ${node.photoCount || 0}`;
  main.appendChild(title);
  main.appendChild(meta);
  row.appendChild(main);

  if (node.scope === WIKI_SCOPE_SHARED && node.id === PRESS_WIKI_SHARED_INDEX_PAGE_ID) {
    const badge = document.createElement('span');
    badge.className = 'scope-link-badge';
    badge.textContent = 'Shared';
    row.appendChild(badge);
  }

  row.onclick = () => loadPressWikiPage(node.id);
  wrapper.appendChild(row);

  if (children.length) {
    const childWrap = document.createElement('div');
    childWrap.style.display = _pressWikiExpandedPageIds.has(node.id) ? 'block' : 'none';
    childWrap.style.marginLeft = '0';
    children.forEach(child => _pressWikiRenderTreeNode(childWrap, child, tree, depth + 1));
    wrapper.appendChild(childWrap);
  }

  parentEl.appendChild(wrapper);
}

function renderPressWikiPageTree() {
  const panel = document.getElementById('press-wiki-picker-panel');
  const treeEl = document.getElementById('press-wiki-picker-tree');
  const btn = document.getElementById('press-wiki-picker-btn');
  if (!panel || !treeEl) return;
  treeEl.innerHTML = '';
  if (btn) btn.disabled = _pressWikiScope === WIKI_SCOPE_PRESS && !_pressWikiActivePressId();

  if (_pressWikiScope === WIKI_SCOPE_PRESS && !_pressWikiActivePressId()) {
    panel.classList.add('empty');
    treeEl.innerHTML = '<div class="press-wiki-picker-empty">Choose a press first.</div>';
    _pressWikiSyncPickerSummary(null);
    return;
  }

  if (!_pressWikiPageListCache.length) {
    panel.classList.add('empty');
    treeEl.innerHTML = '<div class="press-wiki-picker-empty">No pages found in this scope.</div>';
    _pressWikiSyncPickerSummary(null);
    return;
  }

  panel.classList.remove('empty');

  const tree = _pressWikiBuildTree(_pressWikiPageListCache);
  _pressWikiExpandDefaults(tree);
  if (_pressWikiSelectedPageId) {
    _pressWikiAncestors(_pressWikiSelectedPageId, tree.parentById).forEach(id => _pressWikiExpandedPageIds.add(id));
  }

  if (!tree.nodesById.has(_pressWikiSelectedPageId)) {
    _pressWikiSelectedPageId = tree.roots[0]?.id || null;
  }

  _pressWikiSyncPickerSummary(tree);
  tree.roots.forEach(node => _pressWikiRenderPickerNode(treeEl, node, tree, 0));
}

document.getElementById('press-wiki-picker-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  _pressWikiSetPickerOpen(!_pressWikiPickerOpen);
});

function _pressWikiPressLabel() {
  return _pressWikiMachineCode ? `Press ${_pressWikiMachineCode}` : 'This Press';
}

function _pressWikiSyncScopeBadge(scope = _pressWikiScope) {
  const badge = document.getElementById('press-wiki-scope-badge');
  if (!badge) return;
  const isShared = scope === WIKI_SCOPE_SHARED;
  badge.style.display = isShared ? 'inline-flex' : 'none';
  badge.title = isShared ? 'Open the shared library view' : '';
  badge.onclick = isShared ? () => _pressWikiSetScope(WIKI_SCOPE_SHARED) : null;
}

function _pressWikiSetScope(scope, { reload = true } = {}) {
  _pressWikiScope = scope === WIKI_SCOPE_SHARED ? WIKI_SCOPE_SHARED : WIKI_SCOPE_PRESS;
  const pressBtn = document.getElementById('press-wiki-scope-press');
  const sharedBtn = document.getElementById('press-wiki-scope-shared');
  const isShared = _pressWikiScope === WIKI_SCOPE_SHARED;
  [pressBtn, sharedBtn].forEach(btn => {
    if (!btn) return;
    btn.style.background = 'var(--color-surface-raised, var(--bg3))';
    btn.style.borderColor = 'var(--color-border, var(--border))';
    btn.style.color = 'var(--color-text-muted, var(--text2))';
  });
  if (pressBtn) {
    pressBtn.style.background = !isShared ? 'var(--color-accent, var(--accent))' : 'var(--color-surface-raised, var(--bg3))';
    pressBtn.style.borderColor = !isShared ? 'var(--color-accent, var(--accent))' : 'var(--color-border, var(--border))';
    pressBtn.style.color = !isShared ? 'white' : 'var(--color-text-muted, var(--text2))';
  }
  if (sharedBtn) {
    sharedBtn.style.background = isShared ? 'var(--color-accent, var(--accent))' : 'var(--color-surface-raised, var(--bg3))';
    sharedBtn.style.borderColor = isShared ? 'var(--color-accent, var(--accent))' : 'var(--color-border, var(--border))';
    sharedBtn.style.color = isShared ? 'white' : 'var(--color-text-muted, var(--text2))';
  }
  const pressLabelBtn = document.getElementById('press-wiki-scope-press');
  if (pressLabelBtn) pressLabelBtn.textContent = _pressWikiPressLabel();
  if (isShared) _pressWikiSetPressPickerOpen(false);
  const hasActivePressContext = _pressWikiScope === WIKI_SCOPE_SHARED || !!_pressWikiActivePressId();
  const actionsBtn = document.getElementById('press-wiki-actions-btn');
  const newBtn = document.getElementById('press-wiki-new-page-btn');
  const editBtn = document.getElementById('press-wiki-edit-btn');
  const cmsBtn = document.getElementById('press-wiki-cms-btn');
  if (actionsBtn) actionsBtn.disabled = !_pressWikiCanEdit || !hasActivePressContext;
  if (newBtn) newBtn.disabled = !_pressWikiCanEdit || !hasActivePressContext;
  if (editBtn) editBtn.disabled = !_pressWikiCanEdit || !hasActivePressContext;
  if (cmsBtn) cmsBtn.disabled = !_pressWikiCanEdit || !hasActivePressContext;
  renderPressWikiPressPicker();
  if (reload && _pressWikiModalPressId) {
    if (_pressWikiScope === WIKI_SCOPE_PRESS && !_pressWikiActivePressId()) {
      renderPressWikiEmptySelection(_pressWikiEmptySelectionMessage());
      return;
    }
    loadPressWikiPageList()
      .then(() => (_pressWikiSelectedPageId ? loadPressWikiPage(_pressWikiSelectedPageId) : renderPressWikiEmptySelection()))
      .catch(err => console.warn('scope reload failed', err));
  }
}

function _pressWikiSlugify(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function _pressWikiResolveLinkTarget(href) {
  const raw = String(href || '').trim();
  if (!raw) return null;
  if (/^(https?:|mailto:|tel:|#)/i.test(raw)) return { kind: 'external', href: raw };
  const rawSlug = _pressWikiSlugify(raw);
  const match = _pressWikiPageListCache.find(page => {
    const title = String(page.title || '').trim();
    return page.id === raw || page.id === rawSlug || title.toLowerCase() === raw.toLowerCase() || _pressWikiSlugify(title) === rawSlug;
  });
  return match ? { kind: 'internal', pageId: match.id } : { kind: 'internal', pageId: raw };
}

function _pressWikiAppendInlineMarkdown(parent, text) {
  const raw = String(text || '');
  const tokenRe = /(\*\*[\s\S]+?\*\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  const appendText = chunk => {
    if (chunk) parent.appendChild(document.createTextNode(chunk));
  };
  for (const match of raw.matchAll(tokenRe)) {
    const token = match[0];
    appendText(raw.slice(lastIndex, match.index));
    if (token.startsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const label = linkMatch[1];
        const href = linkMatch[2];
        const target = _pressWikiResolveLinkTarget(href);
        const a = document.createElement('a');
        a.textContent = label;
        a.href = target?.kind === 'external' ? target.href : '#';
        a.style.color = 'var(--ios-blue)';
        a.style.textDecoration = 'underline';
        a.style.cursor = 'pointer';
        a.addEventListener('click', evt => {
          if (target?.kind === 'external') return;
          evt.preventDefault();
          if (target?.pageId) loadPressWikiPage(target.pageId);
        });
        parent.appendChild(a);
      } else {
        appendText(token);
      }
    }
    lastIndex = match.index + token.length;
  }
  appendText(raw.slice(lastIndex));
}

function _pressWikiAppendMarkdownBlock(bodyEl, line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;

  const imgMatch = trimmed.match(/^!\[(.*?)\]\((https?:\/\/[^\s)]+)\)$/);
  if (imgMatch) {
    const figure = document.createElement('figure');
    figure.style.margin = '8px 0';
    const img = document.createElement('img');
    img.src = imgMatch[2];
    img.alt = imgMatch[1] || 'wiki image';
    img.style.maxWidth = '100%';
    img.style.borderRadius = '10px';
    img.style.cursor = 'zoom-in';
    img.onclick = () => openLightbox(0, [imgMatch[2]]);
    figure.appendChild(img);
    if (imgMatch[1]) {
      const cap = document.createElement('figcaption');
      cap.style.fontSize = '12px';
      cap.style.color = 'var(--color-text-subtle, var(--text3))';
      cap.style.marginTop = '4px';
      cap.textContent = imgMatch[1];
      figure.appendChild(cap);
    }
    bodyEl.appendChild(figure);
    return true;
  }

  const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const heading = document.createElement(`h${level}`);
    heading.style.margin = level === 1 ? '10px 0 8px' : '8px 0 6px';
    heading.style.lineHeight = '1.2';
    heading.style.fontSize = level === 1 ? '18px' : level === 2 ? '16px' : '14px';
    heading.style.fontWeight = '700';
    _pressWikiAppendInlineMarkdown(heading, headingMatch[2]);
    bodyEl.appendChild(heading);
    return true;
  }

  if (/^---+$/.test(trimmed)) {
    const hr = document.createElement('hr');
    hr.style.border = 'none';
    hr.style.borderTop = '1px solid var(--color-border, var(--border))';
    hr.style.margin = '10px 0';
    bodyEl.appendChild(hr);
    return true;
  }

  return false;
}

function renderPressWikiEmptySelection(message = _pressWikiEmptySelectionMessage()) {
  const titleEl = document.getElementById('press-wiki-title');
  const metaEl = document.getElementById('press-wiki-meta');
  const bodyEl = document.getElementById('press-wiki-body');
  const revisionsEl = document.getElementById('press-wiki-revisions');
  const attachmentsEl = document.getElementById('press-wiki-attachments');
  if (titleEl) titleEl.textContent = 'No page selected';
  if (metaEl) metaEl.textContent = `${_pressWikiScopeLabel(_pressWikiScope)} · No page selected`;
  if (bodyEl) {
    bodyEl.innerHTML = '';
    const empty = document.createElement('div');
    empty.style.color = 'var(--color-text-subtle, var(--text3))';
    empty.style.fontSize = '13px';
    empty.style.lineHeight = '1.45';
    empty.textContent = message;
    bodyEl.appendChild(empty);
  }
  if (revisionsEl) revisionsEl.innerHTML = '';
  if (attachmentsEl) attachmentsEl.innerHTML = '';
  _pressWikiRenderedBodyRaw = '';
  _pressWikiAttachmentsCache = [];
}

async function openPressWikiModal(pressId, machineCode, options = {}) {
  if (!getCurrentPlantId()) return;
  _bindToolModalShellNavigation();
  const preserveState = !!options.preserveState && _pressWikiHasRestorableState();
  const initialScope = preserveState
    ? _pressWikiScope
    : (options.scope === WIKI_SCOPE_SHARED ? WIKI_SCOPE_SHARED : WIKI_SCOPE_PRESS);
  const initialTitle = String(options.title || '').trim() || _pressWikiBaseTitle(initialScope);
  const knownPressId = preserveState
    ? (_pressWikiScope === WIKI_SCOPE_PRESS
      ? _pressWikiResolveKnownPressId(_pressWikiSelectedPressId, _pressWikiModalPressId, pressId, machineCode)
      : null)
    : _pressWikiResolveKnownPressId(pressId, machineCode);
  const initialPageId = preserveState
    ? (_pressWikiSelectedPageId || (initialScope === WIKI_SCOPE_SHARED ? PRESS_WIKI_SHARED_INDEX_PAGE_ID : null))
    : (String(options.pageId || '').trim() || (initialScope === WIKI_SCOPE_SHARED ? PRESS_WIKI_SHARED_INDEX_PAGE_ID : null));
  if (preserveState && initialScope === WIKI_SCOPE_PRESS && knownPressId && !_pressWikiActivePressId()) {
    _pressWikiModalPressId = knownPressId;
    _pressWikiSelectedPressId = knownPressId;
    _pressWikiMachineCode = String(machineCode || _pressWikiPressInfo(knownPressId)?.machineCode || _pressWikiMachineCode || '').trim();
  }
  if (!preserveState) {
    _pressWikiModalPressId = initialScope === WIKI_SCOPE_SHARED ? 'shared-library' : (knownPressId || null);
    _pressWikiSelectedPressId = initialScope === WIKI_SCOPE_PRESS ? knownPressId : null;
    _pressWikiSelectedPageId = initialPageId;
    _pressWikiMachineCode = initialScope === WIKI_SCOPE_PRESS ? String(machineCode || '').trim() : '';
    _pressWikiExpandedPageIds = new Set();
    _pressWikiKnownTreeNodeIds = new Set();
  }
  _pressWikiSetScope(initialScope, { reload: false });
  const modal = document.getElementById('press-wiki-modal');
  const titleEl = document.getElementById('press-wiki-title');
  const metaEl = document.getElementById('press-wiki-meta');
  const bodyEl = document.getElementById('press-wiki-body');
  const revisionsEl = document.getElementById('press-wiki-revisions');
  const attachmentsEl = document.getElementById('press-wiki-attachments');
  if (!modal || !titleEl || !metaEl || !bodyEl || !revisionsEl || !attachmentsEl) return;
  _pressWikiCanEdit = (getCurrentUserRole() === 'admin' || getCurrentUserRole() === 'editor');
  if (!preserveState) {
    togglePressWikiEditor(false);
    togglePressWikiCreateRow(false);
  }
  closePressWikiActionsMenu();
  const editBtn = document.getElementById('press-wiki-edit-btn');
  const newBtn = document.getElementById('press-wiki-new-page-btn');
  const cmsBtn = document.getElementById('press-wiki-cms-btn');
  if (editBtn) editBtn.style.display = _pressWikiCanEdit ? '' : 'none';
  if (newBtn) newBtn.style.display = _pressWikiCanEdit ? '' : 'none';
  if (cmsBtn) cmsBtn.style.display = _pressWikiCanEdit ? '' : 'none';
  const actionsWrap = document.getElementById('press-wiki-actions-wrap');
  if (actionsWrap) actionsWrap.style.display = _pressWikiCanEdit ? 'inline-flex' : 'none';
  _setPressWikiError('');
  if (!preserveState) {
    titleEl.textContent = initialTitle;
    metaEl.textContent = initialScope === WIKI_SCOPE_SHARED
      ? 'Plant-wide shared knowledge surface'
      : (_pressWikiPressInfo(_pressWikiActivePressId())?.machineCode
        ? `Press ${_pressWikiPressInfo(_pressWikiActivePressId()).machineCode} · ${_pressWikiScopeLabel()}`
        : 'Choose a press to view its wiki pages.');
  }
  _pressWikiSyncScopeBadge();
  _pressWikiSetScope(_pressWikiScope, { reload: false });
  _pressWikiSetPickerOpen(false);
  _pressWikiSetPressPickerOpen(_pressWikiScope === WIKI_SCOPE_PRESS);
  bodyEl.textContent = 'Loading wiki...';
  revisionsEl.innerHTML = '';
  attachmentsEl.innerHTML = '';
  _setPressWikiModalVisible(true);
  try {
    if (_pressWikiScope === WIKI_SCOPE_PRESS && !_pressWikiActivePressId()) {
      renderPressWikiEmptySelection(_pressWikiEmptySelectionMessage());
    } else {
      await loadPressWikiPageList();
      if (_pressWikiSelectedPageId) {
        await loadPressWikiPage(_pressWikiSelectedPageId);
      } else {
        renderPressWikiEmptySelection(_pressWikiEmptySelectionMessage());
      }
    }
    renderPressWikiPressPicker();
  } catch (e) {
    console.error('openPressWikiModal error', e);
    bodyEl.textContent = 'Could not load wiki content.';
  }
}

async function loadPressWikiPageList() {
  const activePressId = _pressWikiActivePressId();
  if (_pressWikiScope === WIKI_SCOPE_PRESS && !activePressId) {
    _pressWikiPageListCache = [];
    renderPressWikiPageTree();
    renderPressWikiPressPicker();
    return [];
  }
  if (!_pressWikiModalPressId) return [];
  const queryPressId = _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId;
  let pages = [];
  if (shouldUseSqlStagingReads(getCurrentPlantId())) {
    const payload = await requireSqlRead(
      `wiki pages ${getCurrentPlantId()}:${_pressWikiScope}:${queryPressId || 'shared'}`,
      () => dataApi.listWikiPages(getCurrentPlantId(), {
        scope: _pressWikiScope,
        pressId: _pressWikiScope === WIKI_SCOPE_SHARED ? '' : queryPressId
      }),
      `Wiki pages are missing in D1 for plant ${getCurrentPlantId()}.`
    );
    pages = (payload?.pages || []).map(page => ({ ...page, id: page.id || page.pageId || '' }));
  } else {
    const pagesSnap = await getDocs(wikiPagesColForScope(_pressWikiScope, queryPressId));
    pages = pagesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  _pressWikiPageListCache = pages;
  if (!pages.length) {
    _pressWikiSelectedPageId = null;
  } else if (!pages.some(page => page.id === _pressWikiSelectedPageId)) {
    _pressWikiSelectedPageId = _pressWikiScope === WIKI_SCOPE_SHARED
      ? _pressWikiDefaultSharedPageId(pages)
      : (pages[0]?.id || null);
  }
  renderPressWikiPageTree();
  renderPressWikiPressPicker();
  return pages;
}

async function loadPressWikiPage(pageId) {
  const activePressId = _pressWikiActivePressId();
  if ((_pressWikiScope === WIKI_SCOPE_PRESS && !activePressId) || !pageId) return;
  _pressWikiSelectedPageId = pageId;
  renderPressWikiPageTree();
  const titleEl = document.getElementById('press-wiki-title');
  const metaEl = document.getElementById('press-wiki-meta');
  const bodyEl = document.getElementById('press-wiki-body');
  const revisionsEl = document.getElementById('press-wiki-revisions');
  const attachmentsEl = document.getElementById('press-wiki-attachments');
  if (!titleEl || !metaEl || !bodyEl || !revisionsEl || !attachmentsEl) return;
  _renderPressWikiBody('Loading wiki...');
  revisionsEl.innerHTML = '';
  attachmentsEl.innerHTML = '';
  try {
    let page = null;
    let revisions = [];
    let attachments = [];
    if (shouldUseSqlStagingReads(getCurrentPlantId())) {
      const payload = await requireSqlRead(
        `wiki page ${getCurrentPlantId()}:${pageId}`,
        () => dataApi.getWikiPage(getCurrentPlantId(), pageId, {
          scope: _pressWikiScope,
          pressId: _pressWikiScope === WIKI_SCOPE_SHARED ? '' : activePressId
        }),
        `Wiki page ${pageId} is missing in D1 for plant ${getCurrentPlantId()}.`
      );
      page = payload?.page ? { ...payload.page, id: payload.page.id || payload.page.pageId || pageId } : null;
      revisions = (payload?.revisions || []).map(rev => ({ ...rev, id: rev.id || rev.revisionId || '' }));
      attachments = (payload?.attachments || []).map(att => ({ ...att, id: att.id || att.attachmentId || '' }));
    } else {
      const pageRef = wikiPageDocForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId);
      const pageSnap = await getDoc(pageRef);
      if (!pageSnap.exists()) {
        _pressWikiSelectedPageId = null;
        renderPressWikiEmptySelection(_pressWikiEmptySelectionMessage());
        _pressWikiSyncScopeBadge(_pressWikiScope);
        return;
      }
      page = pageSnap.data() || {};
      const revSnap = await getDocs(query(wikiRevisionsColForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId), orderBy('editedAt', 'desc'), limit(30)));
      revisions = revSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const attachSnap = await getDocs(query(wikiAttachmentsColForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId), orderBy('uploadedAt', 'desc'), limit(24)));
      attachments = attachSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    }
    if (!page) {
      _pressWikiSelectedPageId = null;
      renderPressWikiEmptySelection(_pressWikiEmptySelectionMessage());
      _pressWikiSyncScopeBadge(_pressWikiScope);
      return;
    }
    const currentRevisionId = page.currentRevisionId || null;
    titleEl.textContent = page.title || pageId;
    metaEl.textContent = `${_pressWikiScopeLabel(page.scope || _pressWikiScope)} · Updated ${_relativeTime(page.updatedAt) || 'recently'}`;
    _pressWikiSyncScopeBadge(page.scope || _pressWikiScope);
    const currentRevision = revisions.find(r => r.id === currentRevisionId) || revisions[0] || null;
    _renderPressWikiBody(currentRevision?.body || 'No revision body available.');
    revisionsEl.innerHTML = revisions.length ? '' : '<div style="color:var(--color-text-subtle, var(--text3));">No revisions yet.</div>';
    revisions.forEach(rev => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'btn btn-ghost';
      row.style.display = 'block';
      row.style.width = '100%';
      row.style.textAlign = 'left';
      row.style.marginBottom = '6px';
      row.textContent = `${_relativeTime(rev.editedAt) || 'just now'} · ${rev.editedBy?.name || 'Unknown'} · ${rev.changeNote || 'Update'}`;
      row.onclick = () => { _renderPressWikiBody(rev.body || ''); };
      revisionsEl.appendChild(row);
    });
    _pressWikiAttachmentsCache = attachments;
    _pressWikiAttachmentsCache.forEach((data, idx) => {
      if (!data.url) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'notes-photo-thumb-btn';
      btn.title = data.caption || `Attachment ${idx + 1}`;
      const img = document.createElement('img');
      img.className = 'notes-photo-thumb';
      img.src = data.url;
      img.alt = data.caption || `Attachment ${idx + 1}`;
      btn.appendChild(img);
      btn.onclick = () => openLightbox(0, [data.url]);
      attachmentsEl.appendChild(btn);
    });
    renderPressWikiPhotoPicker();
    renderPressWikiPageTree();
  } catch (e) {
    console.error('loadPressWikiPage error', e);
    _renderPressWikiBody('Could not load wiki content.');
  }
}

function _renderPressWikiBody(text) {
  const bodyEl = document.getElementById('press-wiki-body');
  if (!bodyEl) return;
  const raw = String(text || '');
  _pressWikiRenderedBodyRaw = raw;
  bodyEl.innerHTML = '';
  bodyEl.style.whiteSpace = 'normal';
  const lines = raw.split('\n');
  let currentList = null;
  let currentListType = null;
  const closeList = () => { currentList = null; currentListType = null; };
  lines.forEach(line => {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      closeList();
      const spacer = document.createElement('div');
      spacer.style.height = '8px';
      bodyEl.appendChild(spacer);
      return;
    }
    if (_pressWikiAppendMarkdownBlock(bodyEl, line)) {
      closeList();
      return;
    }
    const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (ulMatch || olMatch) {
      const listType = olMatch ? 'ol' : 'ul';
      const itemText = (olMatch || ulMatch)[1];
      if (!currentList || currentListType !== listType) {
        closeList();
        currentListType = listType;
        currentList = document.createElement(listType);
        currentList.style.margin = '6px 0 6px 22px';
        currentList.style.paddingLeft = listType === 'ol' ? '20px' : '18px';
        bodyEl.appendChild(currentList);
      }
      const li = document.createElement('li');
      li.style.margin = '2px 0';
      _pressWikiAppendInlineMarkdown(li, itemText);
      currentList.appendChild(li);
      return;
    }
    closeList();
    const p = document.createElement('div');
    p.style.margin = '6px 0';
    _pressWikiAppendInlineMarkdown(p, line);
    bodyEl.appendChild(p);
  });
}

window.insertMarkdown = function (textareaId, prefix, suffix) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  const selectedText = ta.value.slice(start, end);
  const replacement = prefix + selectedText + suffix;
  ta.value = ta.value.slice(0, start) + replacement + ta.value.slice(end);
  ta.focus();
  const newPos = start + prefix.length + selectedText.length;
  ta.setSelectionRange(newPos, newPos);
};

window.closePressWikiModal = (options = {}) => {
  _setPressWikiModalVisible(false);
  _pressWikiSetPickerOpen(false);
  _pressWikiSetPressPickerOpen(false);
  closePressWikiActionsMenu();
  if (options.preserveState) return;
  _pressWikiClearState();
};

async function savePressWikiRevision() {
  if (!_pressWikiCanEdit) return;
  const activePressId = _pressWikiActivePressId();
  if (!_pressWikiSelectedPageId || !getCurrentUser() || (_pressWikiScope === WIKI_SCOPE_PRESS && !activePressId)) return;
  const title = String(document.getElementById('press-wiki-edit-title')?.value || '').trim();
  const body = String(document.getElementById('press-wiki-edit-body')?.value || '').trim();
  const rawChangeNote = String(document.getElementById('press-wiki-edit-change-note')?.value || '').trim();
  if (!body) return _setPressWikiError('Body is required.');
  const fallbackActorName = String(currentActor()?.name || getCurrentUser()?.displayName || getCurrentUser()?.email || 'Unknown').trim() || 'Unknown';
  const fallbackTime = new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  const changeNote = rawChangeNote || `${fallbackActorName} saved ${fallbackTime}`;
  if (shouldUseSqlStagingReads(getCurrentPlantId())) {
    await dataApi.saveWikiRevision(getCurrentPlantId(), _pressWikiSelectedPageId, {
      scope: _pressWikiScope,
      pressId: _pressWikiScope === WIKI_SCOPE_SHARED ? '' : activePressId,
      title,
      body,
      changeNote,
      actor: currentActor()
    });
  } else {
    const pageRef = wikiPageDocForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, _pressWikiSelectedPageId);
    const revisionRef = doc(wikiRevisionsColForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, _pressWikiSelectedPageId));
    await runTransaction(db, async tx => {
      const snap = await tx.get(pageRef);
      const prevRevisionId = snap.exists() ? (snap.data()?.currentRevisionId || null) : null;
      const existingParentId = snap.exists() ? _pressWikiNormalizeParentId(snap.data()?.parentPageId) : null;
      const existingSortOrder = snap.exists() ? (Number.isFinite(Number(snap.data()?.sortOrder)) ? Number(snap.data()?.sortOrder) : 0) : 0;
      tx.set(revisionRef, { body, changeNote, prevRevisionId, editedBy: currentActor(), editedAt: serverTimestamp() });
      tx.set(pageRef, {
        title: title || snap.data()?.title || _pressWikiSelectedPageId,
        slug: _pressWikiSelectedPageId,
        machineCode: _pressWikiScope === WIKI_SCOPE_SHARED ? '' : (_pressWikiPressInfo(activePressId)?.machineCode || _pressWikiMachineCode || ''),
        scope: _pressWikiScope,
        pressId: _pressWikiScope === WIKI_SCOPE_SHARED ? null : activePressId,
        currentRevisionId: revisionRef.id,
        updatedBy: currentActor(),
        updatedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        photoCount: snap.exists() ? (snap.data()?.photoCount || 0) : 0,
        createdBy: snap.exists() ? (snap.data()?.createdBy || currentActor()) : currentActor(),
        createdAt: snap.exists() ? (snap.data()?.createdAt || serverTimestamp()) : serverTimestamp(),
        parentPageId: existingParentId,
        sortOrder: existingSortOrder,
        schemaVersion: 2
      }, { merge: true });
    });
  }
  togglePressWikiEditor(false);
  await loadPressWikiPageList();
  await loadPressWikiPage(_pressWikiSelectedPageId);
  _setPressWikiError('');
}

async function _deleteWikiDocsInBatches(colRef) {
  while (true) {
    const snap = await getDocs(query(colRef, limit(400)));
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 400) return;
  }
}

async function deletePressWikiPage() {
  if (!_pressWikiCanEdit) return;
  const activePressId = _pressWikiActivePressId();
  if (!_pressWikiSelectedPageId || !getCurrentUser() || (_pressWikiScope === WIKI_SCOPE_PRESS && !activePressId)) return;
  const pageId = _pressWikiSelectedPageId;
  if (_pressWikiPageListCache.some(page => _pressWikiNormalizeParentId(page.parentPageId) === pageId)) {
    _setPressWikiError('Move child pages first before deleting this page.');
    return;
  }
  const pageTitle = document.getElementById('press-wiki-title')?.textContent || pageId;
  const ok = confirm(`Delete "${pageTitle}"? This will remove the page, its revisions, and its attachments.`);
  if (!ok) return;
  _setPressWikiError('');
  try {
    const attachments = shouldUseSqlStagingReads(getCurrentPlantId())
      ? (_pressWikiAttachmentsCache || [])
      : (await getDocs(wikiAttachmentsColForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId))).docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    await Promise.allSettled(attachments.map(async a => {
      await deleteStoredAttachmentBlob(getCurrentPlantId(), a);
    }));
    if (shouldUseSqlStagingReads(getCurrentPlantId())) {
      await dataApi.deleteWikiPage(getCurrentPlantId(), pageId, {
        scope: _pressWikiScope,
        pressId: _pressWikiScope === WIKI_SCOPE_SHARED ? '' : activePressId
      });
    } else {
      await _deleteWikiDocsInBatches(wikiAttachmentsColForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId));
      await _deleteWikiDocsInBatches(wikiRevisionsColForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId));
      await deleteDoc(wikiPageDocForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId));
    }
    _pressWikiSelectedPageId = null;
    await loadPressWikiPageList();
    if (_pressWikiSelectedPageId) {
      await loadPressWikiPage(_pressWikiSelectedPageId);
    } else {
      renderPressWikiEmptySelection();
    }
    togglePressWikiEditor(false);
  } catch (e) {
    console.error('deletePressWikiPage error', e);
    _setPressWikiError('Could not delete the page.');
  }
}

function togglePressWikiEditor(show) {
  const editor = document.getElementById('press-wiki-editor');
  if (!editor) return;
  if (show && !_pressWikiCanEdit) return;
  editor.style.display = show ? 'block' : 'none';
  if (!show) return;
  document.getElementById('press-wiki-edit-title').value = document.getElementById('press-wiki-title')?.textContent || '';
  document.getElementById('press-wiki-edit-body').value = _pressWikiCurrentBodyText();
  document.getElementById('press-wiki-edit-change-note').value = '';
  renderPressWikiPhotoPicker();
}

function _pressWikiCurrentBodyText() {
  return String(_pressWikiRenderedBodyRaw || '');
}

function _pressWikiSqlParams(pageId = _pressWikiSelectedPageId) {
  return {
    scope: _pressWikiScope === WIKI_SCOPE_SHARED ? WIKI_SCOPE_SHARED : WIKI_SCOPE_PRESS,
    pressId: _pressWikiScope === WIKI_SCOPE_SHARED ? '' : (_pressWikiActivePressId() || ''),
    pageId: String(pageId || '').trim()
  };
}

function togglePressWikiCreateRow(show) {
  const row = document.getElementById('press-wiki-new-page-row');
  if (!row) return;
  row.style.display = show ? 'flex' : 'none';
  if (show) {
    const inp = document.getElementById('press-wiki-new-page-id');
    if (inp) inp.value = '';
  }
}

function _setPressWikiError(msg) {
  const el = document.getElementById('press-wiki-error');
  if (!el) return;
  const text = String(msg || '').trim();
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
}

function _setPressWikiModalVisible(isVisible) {
  const modal = document.getElementById('press-wiki-modal');
  if (!modal) return;
  modal.classList.toggle('visible', !!isVisible);
  document.body.classList.toggle('press-wiki-open', !!isVisible);
}

async function createPressWikiPageFromInput() {
  if (!_pressWikiCanEdit) return;
  const activePressId = _pressWikiActivePressId();
  if (_pressWikiScope === WIKI_SCOPE_PRESS && !activePressId) {
    _setPressWikiError('Choose a press before creating a page.');
    return;
  }
  const inp = document.getElementById('press-wiki-new-page-id');
  const raw = String(inp?.value || '');
  const pageId = raw.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-');
  if (!pageId) return _setPressWikiError('Enter a valid page id (letters, numbers, dash, underscore).');
  _pressWikiSelectedPageId = pageId;
  togglePressWikiCreateRow(false);
  await loadPressWikiPageList();
  if (!shouldUseSqlStagingReads(getCurrentPlantId())) {
    await loadPressWikiPage(pageId);
  } else {
    document.getElementById('press-wiki-title').textContent = pageId;
    _renderPressWikiBody('');
    _pressWikiAttachmentsCache = [];
    renderPressWikiPhotoPicker();
  }
  togglePressWikiEditor(true);
  _setPressWikiError('');
}

function renderPressWikiPhotoPicker() {
  const picker = document.getElementById('press-wiki-photo-picker');
  if (!picker) return;
  if (!_pressWikiCanEdit || !_pressWikiAttachmentsCache.length || document.getElementById('press-wiki-editor')?.style.display === 'none') {
    picker.style.display = 'none';
    picker.innerHTML = '';
    return;
  }
  picker.style.display = 'block';
  picker.innerHTML = '<div style="font-size:12px;color:var(--color-text-subtle, var(--text3));margin-bottom:6px;">Insert from press wiki photos</div>';
  _pressWikiAttachmentsCache.forEach((a, idx) => {
    if (!a.url) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notes-photo-thumb-btn';
    btn.title = a.caption || `Photo ${idx + 1}`;
    btn.style.marginRight = '6px';
    const img = document.createElement('img');
    img.className = 'notes-photo-thumb';
    img.src = a.url;
    img.alt = a.caption || `Photo ${idx + 1}`;
    btn.appendChild(img);
    btn.onclick = () => insertWikiPhotoIntoEditor(a);
    picker.appendChild(btn);
  });
}

function insertWikiPhotoIntoEditor(photo) {
  const ta = document.getElementById('press-wiki-edit-body');
  if (!ta || !photo?.url) return;
  const snippet = `![${photo.caption || 'Photo'}](${photo.url})`;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + snippet + ta.value.slice(end);
  ta.focus();
  const pos = start + snippet.length;
  ta.setSelectionRange(pos, pos);
}




document.getElementById('press-wiki-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('press-wiki-modal')) closePressWikiModal();
});
document.addEventListener('click', e => {
  const pickerWrap = document.querySelector('.press-wiki-picker-wrap');
  if (pickerWrap && !pickerWrap.contains(e.target)) _pressWikiSetPickerOpen(false);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') _pressWikiSetPickerOpen(false);
  if (e.key === 'Escape') _pressWikiSetPressPickerOpen(false);
});
document.getElementById('press-wiki-edit-btn')?.addEventListener('click', () => {
  closePressWikiActionsMenu();
  togglePressWikiEditor(true);
});
document.getElementById('press-wiki-cancel-edit-btn')?.addEventListener('click', () => togglePressWikiEditor(false));
document.getElementById('press-wiki-save-btn')?.addEventListener('click', () => savePressWikiRevision());
document.getElementById('press-wiki-delete-btn')?.addEventListener('click', () => deletePressWikiPage());
document.getElementById('press-wiki-insert-photo-btn')?.addEventListener('click', () => {
  document.getElementById('press-wiki-file-input')?.click();
});

document.getElementById('press-wiki-file-input')?.addEventListener('change', async (e) => {
  await handlePressWikiFilesUpload(e.target.files, false);
  e.target.value = '';
});

function togglePressWikiActionsMenu() {
  const wrap = document.getElementById('press-wiki-actions-wrap');
  const menu = document.getElementById('press-wiki-actions-menu');
  const btn = document.getElementById('press-wiki-actions-btn');
  if (!wrap || !menu || !btn) return;
  const isOpen = menu.classList.contains('visible');
  menu.classList.toggle('visible', !isOpen);
  btn.classList.toggle('open', !isOpen);
  btn.setAttribute('aria-expanded', String(!isOpen));
}

function closePressWikiActionsMenu() {
  const menu = document.getElementById('press-wiki-actions-menu');
  const btn = document.getElementById('press-wiki-actions-btn');
  if (!menu || !btn) return;
  menu.classList.remove('visible');
  btn.classList.remove('open');
  btn.setAttribute('aria-expanded', 'false');
}

document.getElementById('press-wiki-actions-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  togglePressWikiActionsMenu();
});

const wikiEditBody = document.getElementById('press-wiki-edit-body');
if (wikiEditBody) {
  wikiEditBody.addEventListener('dragover', (e) => {
    e.preventDefault();
    wikiEditBody.style.borderColor = 'var(--color-accent, var(--accent))';
    wikiEditBody.style.background = 'var(--color-surface, var(--bg2))';
  });
  wikiEditBody.addEventListener('dragleave', (e) => {
    e.preventDefault();
    wikiEditBody.style.borderColor = 'var(--color-border, var(--border))';
    wikiEditBody.style.background = 'var(--color-surface-raised, var(--bg3))';
  });
  wikiEditBody.addEventListener('drop', async (e) => {
    e.preventDefault();
    wikiEditBody.style.borderColor = 'var(--color-border, var(--border))';
    wikiEditBody.style.background = 'var(--color-surface-raised, var(--bg3))';
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handlePressWikiFilesUpload(e.dataTransfer.files, true);
    }
  });
}

async function handlePressWikiFilesUpload(files, autoInsert) {
  const activePressId = _pressWikiActivePressId();
  if (!files || !files.length || !_pressWikiSelectedPageId || (_pressWikiScope === WIKI_SCOPE_PRESS && !activePressId)) return;
  _setPressWikiError("Uploading photos...");
  try {
    let uploadedCount = 0;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const attId = 'att_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      const ext = file.name.split('.').pop() || 'png';
      const dataUrl = await readFileAsDataUrl(file);
      let uploadedBlob = await uploadAttachmentToPreferredStorage(getCurrentPlantId(), {
        scope: 'wiki',
        wikiScope: _pressWikiScope,
        pageId: _pressWikiSelectedPageId,
        pressId: _pressWikiScope === WIKI_SCOPE_SHARED ? '' : activePressId,
        fileName: file.name || `wiki_attachment_${attId}.${ext}`,
        contentType: file.type || 'image/png',
        dataUrl
      });
      if (!uploadedBlob?.storagePath) {
        throw new Error('R2 upload returned no storage path.');
      }

      const attDoc = {
        attachmentId: attId,
        storagePath: uploadedBlob.storagePath,
        storageBucket: uploadedBlob.storageBucket || '',
        url: uploadedBlob.downloadUrl || uploadedBlob.url || '',
        contentType: uploadedBlob.contentType || file.type,
        caption: uploadedBlob.fileName || file.name,
        uploadedBy: currentActor(),
        uploadedAt: uploadedBlob.uploadedAt || (shouldUseSqlStagingReads(getCurrentPlantId()) ? new Date().toISOString() : serverTimestamp())
      };
      if (shouldUseSqlStagingReads(getCurrentPlantId())) {
        await dataApi.createWikiAttachment(getCurrentPlantId(), _pressWikiSelectedPageId, {
          ...attDoc,
          scope: _pressWikiScope,
          pressId: _pressWikiScope === WIKI_SCOPE_SHARED ? '' : activePressId
        });
      } else {
        await setDoc(doc(db, ...wikiStoragePrefixForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, _pressWikiSelectedPageId).split('/'), 'attachments', attId), attDoc);
      }
      uploadedCount++;

      if (autoInsert) {
        const md = `\n![${attDoc.caption}](${attDoc.url})\n`;
        const pos = wikiEditBody.selectionStart;
        const text = wikiEditBody.value;
        wikiEditBody.value = text.slice(0, pos) + md + text.slice(pos);
        wikiEditBody.focus();
        const newPos = pos + md.length;
        wikiEditBody.setSelectionRange(newPos, newPos);
      }
    }

    if (uploadedCount > 0 && !shouldUseSqlStagingReads(getCurrentPlantId())) {
      const pageRef = wikiPageDocForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, _pressWikiSelectedPageId);
      const snap = await getDoc(pageRef);
      if (snap.exists()) {
        const currentCount = snap.data()?.photoCount || 0;
        await updateDoc(pageRef, { photoCount: currentCount + uploadedCount });
      }
    }

    _setPressWikiError('');
    await loadPressWikiPage(_pressWikiSelectedPageId);
  } catch (err) {
    _setPressWikiError("Upload failed: " + err.message);
  }
}
document.getElementById('press-wiki-new-page-btn')?.addEventListener('click', () => {
  closePressWikiActionsMenu();
  togglePressWikiCreateRow(true);
});
document.getElementById('press-wiki-cancel-create-page-btn')?.addEventListener('click', () => togglePressWikiCreateRow(false));
document.getElementById('press-wiki-create-page-btn')?.addEventListener('click', () => createPressWikiPageFromInput());
document.getElementById('press-wiki-scope-press')?.addEventListener('click', e => {
  e.stopPropagation();
  if (_pressWikiScope !== WIKI_SCOPE_PRESS) {
    _pressWikiSetScope(WIKI_SCOPE_PRESS);
    _pressWikiSetPressPickerOpen(true);
    return;
  }
  _pressWikiSetPressPickerOpen(!_pressWikiPressPickerOpen);
});
document.getElementById('press-wiki-scope-shared')?.addEventListener('click', () => _pressWikiSetScope(WIKI_SCOPE_SHARED));
document.getElementById('press-wiki-press-picker-close')?.addEventListener('click', e => {
  e.stopPropagation();
  _pressWikiSetPressPickerOpen(false);
});
document.getElementById('press-wiki-cms-btn')?.addEventListener('click', () => {
  closePressWikiActionsMenu();
  if (!_pressWikiModalPressId) return;
  const url = `wiki-cms.html?plantId=${encodeURIComponent(getCurrentPlantId())}&pressId=${encodeURIComponent(_pressWikiScope === WIKI_SCOPE_PRESS ? _pressWikiModalPressId : '')}&pageId=${encodeURIComponent(_pressWikiSelectedPageId || '')}&scope=${encodeURIComponent(_pressWikiScope)}`;
  window.location.href = url;
});

function _bindPressWikiToolNavButtons() {
  const prevBtn = document.getElementById('press-wiki-prev-tool-btn');
  const nextBtn = document.getElementById('press-wiki-next-tool-btn');
  if (prevBtn && prevBtn.dataset.toolNavBound !== '1') {
    prevBtn.dataset.toolNavBound = '1';
    prevBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      void _cycleToolModal(-1);
    });
  }
  if (nextBtn && nextBtn.dataset.toolNavBound !== '1') {
    nextBtn.dataset.toolNavBound = '1';
    nextBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      void _cycleToolModal(1);
    });
  }
}

_bindPressWikiToolNavButtons();

window.openSharedLibraryWiki = async function (options = {}) {
  if (!getCurrentPlantId()) return;
  closeUserMenus();
  closeSortDropdown();
  window.closeExportDropdown?.();
  await openPressWikiModal('shared-library', '', {
    scope: WIKI_SCOPE_SHARED,
    title: 'Shared Library',
    pageId: PRESS_WIKI_SHARED_INDEX_PAGE_ID,
    preserveState: !!options.preserveState
  });
  completeDemoGuideStep('tools');
};

document.addEventListener('click', e => {
  const wrap = document.getElementById('press-wiki-actions-wrap');
  if (wrap && !wrap.contains(e.target)) closePressWikiActionsMenu();
});


  return {
    open: openPressWikiModal,
    close: closePressWikiModal,
    openSharedLibrary: openSharedLibraryWiki,
    hasState: _pressWikiHasRestorableState,
    pressInfo: _pressWikiPressInfo,
    get state() {
      return _pressWikiStateSnapshot();
    },
    renderPageTree: renderPressWikiPageTree,
    handleScopePressPickerClick: _pressWikiSetPressPickerOpen
  };
}
