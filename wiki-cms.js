import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut as fbSignOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, runTransaction, query, orderBy, writeBatch, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyABjasNBbJnsqq4M_UxKruKrN6-O2FXCwc",
  authDomain: "press-tracker-9d9c9.firebaseapp.com",
  projectId: "press-tracker-9d9c9",
  storageBucket: "press-tracker-9d9c9.firebasestorage.app",
  messagingSenderId: "943200266003",
  appId: "1:943200266003:web:4d24eab551a3fb145c1ce6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storageFallback = firebaseConfig.storageBucket && firebaseConfig.storageBucket.includes('.appspot.com')
  ? getStorage(app, `gs://${firebaseConfig.projectId}.appspot.com`)
  : getStorage(app);
const provider = new GoogleAuthProvider();

const DEFAULT_PRESSES = {
  "Row 1": ["1.01","1.02","1.03","1.04","1.05","1.06","1.07","1.08","1.09","1.10","1.11","1.12","1.13","1.14","1.15","1.16","1.17"],
  "Row 2": ["2.01","2.02","2.03","2.04","2.05","2.06","2.07","2.08","2.09","2.10","2.11","2.12","2.13","2.14","2.15","2.16","2.17","2.18","2.19","2.20","2.21","2.22"],
  "Row 3": ["3.01","3.02","3.03","3.04","3.05","3.06","3.07","3.08","3.09","3.10","3.12","3.13","3.14","3.15","3.16","3.17","3.18","3.19"],
  "Row 4": ["4.01","4.02","4.03","4.04","4.05","4.06","4.07","4.08","4.09","4.10","4.11","4.12","4.13","4.14","4.15","4.16","4.17"],
  "Row 5": ["5.01","5.02","5.03","5.04","5.05","5.06","5.07","5.08","5.09","5.10","5.11","5.12"],
  "Row 6": ["6.01","6.02","6.03","6.05","6.06","6.07"],
  "Other": ["Auto Cell","BR-1","CR-1","CR-2"]
};

// DOM Elements
const elLogin = document.getElementById('login-screen');
const elApp = document.getElementById('app-screen');
const elWhoami = document.getElementById('whoami');
const elPlantSelect = document.getElementById('plant-select');
const elPressSelect = document.getElementById('press-select');
const elPageList = document.getElementById('page-list');
const elNewPageBtn = document.getElementById('new-page-btn');
const elEditorContainer = document.getElementById('editor-container');
const elEmptyState = document.getElementById('empty-state');
const elScopeSummary = document.getElementById('scope-summary');

// Editor DOM
const elTitle = document.getElementById('edit-title');
const elSlug = document.getElementById('edit-slug');
const elSummary = document.getElementById('edit-summary');
const elTags = document.getElementById('edit-tags');
const elBody = document.getElementById('edit-body');
const elPreview = document.getElementById('edit-preview');
const elChangeNote = document.getElementById('edit-change-note');
const elFileInput = document.getElementById('edit-file-input');
const elAttachments = document.getElementById('edit-attachments');
const elRevisionList = document.getElementById('revision-list');
const elSaveFeedback = document.getElementById('save-feedback');
const elDeletePageBtn = document.getElementById('delete-page-btn');
const elParentPage = document.getElementById('edit-parent');
const elMovePageUpBtn = document.getElementById('move-page-up-btn');
const elMovePageDownBtn = document.getElementById('move-page-down-btn');

const WIKI_SCOPE_PRESS = 'press';
const WIKI_SCOPE_SHARED = 'shared';
const SHARED_LIBRARY_INDEX_PAGE_ID = 'shared-library-index';

// State
let currentUser = null;
let currentPlantId = null;
let currentPressId = null;
let currentScope = WIKI_SCOPE_PRESS;
let currentPageId = null;
let pages = [];
let currentPageDoc = null;
let attachmentsMap = new Map();
let unsubscribePages = null;
let expandedPageIds = new Set();
let knownPageTreeNodeIds = new Set();

function toPressId(machineCode) {
  return 'press_' + String(machineCode || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Initialization URL Params
const urlParams = new URLSearchParams(window.location.search);
const initPlantId = urlParams.get('plantId');
const initPressId = urlParams.get('pressId');
const initPageId = urlParams.get('pageId');
const initScope = urlParams.get('scope') === WIKI_SCOPE_SHARED ? WIKI_SCOPE_SHARED : WIKI_SCOPE_PRESS;

function showFeedback(msg, isError) {
  elSaveFeedback.textContent = msg;
  elSaveFeedback.style.color = isError ? 'var(--red)' : 'var(--green)';
}

function currentActor() {
  return { uid: currentUser.uid, name: currentUser.displayName || currentUser.email || 'Unknown' };
}

function scopeLabel(scope = currentScope) {
  return scope === WIKI_SCOPE_SHARED ? 'Shared Library' : 'This Press';
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function defaultSharedPageId(sourcePages = pages) {
  const targetSlug = slugify('Shared Library Index');
  const match = (Array.isArray(sourcePages) ? sourcePages : []).find(page => {
    const pageTitle = String(page?.title || '').trim();
    const pageSlug = slugify(page?.slug || page?.id || pageTitle);
    return page?.id === SHARED_LIBRARY_INDEX_PAGE_ID ||
      pageSlug === targetSlug ||
      slugify(pageTitle) === targetSlug;
  });
  return match?.id || SHARED_LIBRARY_INDEX_PAGE_ID;
}

function normalizeParentPageId(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : null;
}

function getWikiSortValue(page, fallbackIndex = 0) {
  const raw = Number(page?.sortOrder);
  return Number.isFinite(raw) ? raw : fallbackIndex;
}

function compareWikiPages(a, b) {
  const sortDelta = getWikiSortValue(a) - getWikiSortValue(b);
  if (sortDelta !== 0) return sortDelta;
  const titleDelta = String(a.title || '').localeCompare(String(b.title || ''));
  if (titleDelta !== 0) return titleDelta;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function buildWikiTree(sourcePages = pages) {
  const nodesById = new Map();
  const parentById = new Map();
  const childrenById = new Map();
  const roots = [];

  sourcePages.forEach((page, index) => {
    if (!page?.id) return;
    nodesById.set(page.id, {
      ...page,
      parentPageId: normalizeParentPageId(page.parentPageId),
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

  const sortList = list => list.sort(compareWikiPages);
  sortList(roots);
  childrenById.forEach(sortList);
  return { nodesById, parentById, childrenById, roots };
}

function collectWikiDescendants(pageId, childrenById, output = new Set()) {
  const children = childrenById.get(pageId) || [];
  children.forEach(child => {
    if (!child?.id || output.has(child.id)) return;
    output.add(child.id);
    collectWikiDescendants(child.id, childrenById, output);
  });
  return output;
}

function collectWikiAncestors(pageId, parentById) {
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

function getPageSiblings(targetPage, sourcePages = pages) {
  const parentId = normalizeParentPageId(targetPage?.parentPageId);
  return sourcePages
    .filter(page => page?.id && page.id !== targetPage?.id && normalizeParentPageId(page.parentPageId) === parentId)
    .sort(compareWikiPages);
}

function getNextWikiSortOrder(parentPageId, ignorePageId = null) {
  const parentId = normalizeParentPageId(parentPageId);
  const siblingOrders = pages
    .filter(page => page?.id && page.id !== ignorePageId && normalizeParentPageId(page.parentPageId) === parentId)
    .map(page => Number(page.sortOrder))
    .filter(Number.isFinite);
  return siblingOrders.length ? Math.max(...siblingOrders) + 1 : 0;
}

function syncExpandedDefaults(tree) {
  tree.nodesById.forEach((page, pageId) => {
    if (!knownPageTreeNodeIds.has(pageId) && (tree.childrenById.get(pageId) || []).length > 0) {
      expandedPageIds.add(pageId);
    }
    knownPageTreeNodeIds.add(pageId);
  });
}

function renderWikiTreeNode(parentEl, node, tree, depth = 0) {
  const children = tree.childrenById.get(node.id) || [];
  const wrapper = document.createElement('div');
  wrapper.className = 'page-tree-node';

  const row = document.createElement('div');
  row.className = `page-tree-row ${node.id === currentPageId ? 'active' : ''}`;
  row.style.paddingLeft = `${12 + depth * 18}px`;
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.gap = '8px';
  row.style.border = 'none';
  row.style.background = 'transparent';
  row.dataset.pageId = node.id;
  row.innerHTML = '';

  const spacer = document.createElement('span');
  spacer.style.width = '22px';
  spacer.style.flex = '0 0 auto';

  if (children.length) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'page-tree-toggle';
    toggle.textContent = expandedPageIds.has(node.id) ? '▾' : '▸';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (expandedPageIds.has(node.id)) expandedPageIds.delete(node.id);
      else expandedPageIds.add(node.id);
      renderPageList();
    });
    row.appendChild(toggle);
  } else {
    row.appendChild(spacer);
  }

  const main = document.createElement('div');
  main.className = 'page-tree-main';
  const title = document.createElement('div');
  title.className = 'page-title';
  title.textContent = node.title || 'Untitled';
  const meta = document.createElement('div');
  meta.className = 'page-meta';
  meta.textContent = `Photos: ${node.photoCount || 0}`;
  main.appendChild(title);
  main.appendChild(meta);
  row.appendChild(main);

  if (node.scope === WIKI_SCOPE_SHARED) {
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'scope-link-badge';
    badge.textContent = 'Shared';
    badge.addEventListener('click', async (e) => {
      e.stopPropagation();
      await handleScopeChange(WIKI_SCOPE_SHARED);
      await selectPage(node.id);
    });
    row.appendChild(badge);
  }

  row.addEventListener('click', () => selectPage(node.id));
  wrapper.appendChild(row);

  if (children.length) {
    const childWrap = document.createElement('div');
    childWrap.className = 'page-tree-children';
    childWrap.style.display = expandedPageIds.has(node.id) ? 'block' : 'none';
    children.forEach(child => renderWikiTreeNode(childWrap, child, tree, depth + 1));
    wrapper.appendChild(childWrap);
  }

  parentEl.appendChild(wrapper);
}

function renderParentPageOptions(selectedParentId = null, currentId = currentPageId) {
  if (!elParentPage) return;
  const tree = buildWikiTree(pages);
  const parentId = normalizeParentPageId(selectedParentId);
  const exclude = currentId && currentId !== 'NEW'
    ? new Set([currentId, ...collectWikiDescendants(currentId, tree.childrenById)])
    : new Set();

  elParentPage.innerHTML = '';
  const rootOpt = document.createElement('option');
  rootOpt.value = '';
  rootOpt.textContent = 'Root page';
  elParentPage.appendChild(rootOpt);

  const appendOptions = (nodes, depth = 0) => {
    nodes.forEach(node => {
      if (exclude.has(node.id)) return;
      const opt = document.createElement('option');
      opt.value = node.id;
      opt.textContent = `${'\u00a0\u00a0'.repeat(depth)}${depth ? '↳ ' : ''}${node.title || node.id}`;
      elParentPage.appendChild(opt);
      const children = tree.childrenById.get(node.id) || [];
      if (children.length) appendOptions(children, depth + 1);
    });
  };

  appendOptions(tree.roots);
  elParentPage.value = parentId || '';
}

function resolveWikiLinkTarget(href) {
  const raw = String(href || '').trim();
  if (!raw) return null;
  const rawSlug = slugify(raw);
  const cleanRaw = raw.replace(/^#/, '').trim();

  return pages.find(page => {
    const title = String(page.title || '');
    const pageSlug = String(page.slug || page.id || '');
    return page.id === raw ||
      page.id === rawSlug ||
      pageSlug === cleanRaw ||
      pageSlug === rawSlug ||
      title.toLowerCase() === cleanRaw.toLowerCase() ||
      slugify(title) === rawSlug;
  }) || null;
}

function appendPreviewInline(parent, text) {
  const tokens = String(text || '').split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean);
  tokens.forEach(token => {
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const label = linkMatch[1];
      const href = linkMatch[2];
      const target = resolveWikiLinkTarget(href);
      const link = document.createElement('a');
      link.href = target ? `#${target.id}` : href;
      link.textContent = label;
      link.style.color = 'var(--accent)';
      link.style.textDecoration = 'underline';
      link.style.cursor = 'pointer';
      if (target) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          selectPage(target.id);
        });
      } else if (/^https?:\/\//i.test(href)) {
        link.target = '_blank';
        link.rel = 'noreferrer';
      }
      parent.appendChild(link);
      return;
    }

    if (token.startsWith('**') && token.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
      return;
    }

    if (token.startsWith('*') && token.endsWith('*')) {
      const em = document.createElement('em');
      em.textContent = token.slice(1, -1);
      parent.appendChild(em);
      return;
    }

    if (token.startsWith('`') && token.endsWith('`')) {
      const code = document.createElement('code');
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
      return;
    }

    parent.appendChild(document.createTextNode(token));
  });
}

function renderPreview() {
  if (!elPreview) return;
  const source = String(elBody?.value || '').trim();
  if (!source) {
    elPreview.innerHTML = '<div style="color:var(--text3);">Preview will appear here.</div>';
    return;
  }

  elPreview.innerHTML = '';
  const lines = source.split(/\r?\n/);
  let listEl = null;

  const flushList = () => {
    if (listEl) {
      elPreview.appendChild(listEl);
      listEl = null;
    }
  };

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushList();
      const h = document.createElement(`h${Math.min(3, headingMatch[1].length)}`);
      h.style.margin = '0 0 8px';
      h.style.fontFamily = "'Rajdhani', sans-serif";
      appendPreviewInline(h, headingMatch[2]);
      elPreview.appendChild(h);
      return;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      if (!listEl) listEl = document.createElement('ul');
      const li = document.createElement('li');
      appendPreviewInline(li, bulletMatch[1]);
      listEl.appendChild(li);
      return;
    }

    const numberedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (numberedMatch) {
      if (!listEl || listEl.tagName !== 'OL') {
        flushList();
        listEl = document.createElement('ol');
      }
      const li = document.createElement('li');
      appendPreviewInline(li, numberedMatch[1]);
      listEl.appendChild(li);
      return;
    }

    flushList();
    const p = document.createElement('p');
    p.style.margin = '0 0 10px';
    appendPreviewInline(p, trimmed);
    elPreview.appendChild(p);
  });

  flushList();
}

function wikiCollectionPath(scope = currentScope, pressId = currentPressId) {
  if (scope === WIKI_SCOPE_SHARED) return ['plants', currentPlantId, 'wikiPages'];
  return ['plants', currentPlantId, 'presses', String(pressId || '').trim(), 'wikiPages'];
}

function wikiPagesCol(scope = currentScope, pressId = currentPressId) {
  return collection(db, ...wikiCollectionPath(scope, pressId));
}

function wikiPageDoc(scope, pressId, pageId) {
  return doc(db, ...wikiCollectionPath(scope, pressId), pageId);
}

function wikiRevisionsCol(scope, pressId, pageId) {
  return collection(db, ...wikiCollectionPath(scope, pressId), pageId, 'revisions');
}

function wikiAttachmentsCol(scope, pressId, pageId) {
  return collection(db, ...wikiCollectionPath(scope, pressId), pageId, 'attachments');
}

function updateScopeButtons() {
  const pressBtn = document.getElementById('cms-scope-press');
  const sharedBtn = document.getElementById('cms-scope-shared');
  const isShared = currentScope === WIKI_SCOPE_SHARED;
  if (pressBtn) {
    pressBtn.classList.toggle('btn-primary', !isShared);
    pressBtn.style.background = !isShared ? 'var(--accent)' : 'var(--bg3)';
    pressBtn.style.borderColor = !isShared ? 'var(--accent)' : 'var(--border)';
    pressBtn.style.color = !isShared ? 'white' : 'var(--text2)';
  }
  if (sharedBtn) {
    sharedBtn.classList.toggle('btn-primary', isShared);
    sharedBtn.style.background = isShared ? 'var(--accent)' : 'var(--bg3)';
    sharedBtn.style.borderColor = isShared ? 'var(--accent)' : 'var(--border)';
    sharedBtn.style.color = isShared ? 'white' : 'var(--text2)';
  }
  if (elPressSelect) {
    elPressSelect.disabled = isShared;
  }
  if (elScopeSummary) {
    elScopeSummary.textContent = isShared
      ? 'Shared Library pages are plant-wide and visible to every press.'
      : 'This Press pages stay scoped to the selected press.';
  }
}

async function refreshPageData() {
  resetEditor();
  if (!currentPlantId) return;
  if (currentScope === WIKI_SCOPE_PRESS && !currentPressId) {
    elNewPageBtn.disabled = true;
    elPageList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px;">Select a press to view pages</div>';
    return;
  }

  elNewPageBtn.disabled = false;
  elPageList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px;">Loading pages...</div>';

  if (unsubscribePages) unsubscribePages();
  expandedPageIds = new Set();
  knownPageTreeNodeIds = new Set();
  unsubscribePages = onSnapshot(wikiPagesCol(currentScope, currentPressId), (snap) => {
    pages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPageList();
    if (currentScope === WIKI_SCOPE_SHARED && (!currentPageId || !pages.some(page => page.id === currentPageId))) {
      const preferredPageId = defaultSharedPageId(pages);
      if (preferredPageId && preferredPageId !== currentPageId) {
        selectPage(preferredPageId);
      }
    }
    if (currentPageId) {
      const activePage = pages.find(p => p.id === currentPageId);
      if (activePage) updateEditorMeta(activePage);
    }
    updateDeleteButtonState();
  });
}

document.getElementById('google-signin-btn').addEventListener('click', async () => {
  const btn = document.getElementById('google-signin-btn');
  try {
    if (btn) btn.textContent = 'Signing in…';
    document.getElementById('login-feedback').textContent = '';
    sessionStorage.setItem('ap:auth:redirectPending', '1');
    await signInWithRedirect(auth, provider);
  } catch (err) {
    document.getElementById('login-feedback').textContent = err.message;
    if (btn) btn.textContent = 'Sign in with Google';
  }
});

async function finalizeRedirectSignIn() {
  if (!sessionStorage.getItem('ap:auth:redirectPending')) return;
  try {
    await getRedirectResult(auth);
  } catch (err) {
    console.error('Redirect sign in error:', err.code, err.message);
    document.getElementById('login-feedback').textContent = err.message || 'Sign-in failed.';
    const btn = document.getElementById('google-signin-btn');
    if (btn) btn.textContent = 'Sign in with Google';
  } finally {
    sessionStorage.removeItem('ap:auth:redirectPending');
  }
}

document.getElementById('signout-btn').addEventListener('click', () => {
  fbSignOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    elLogin.classList.remove('visible');
    elApp.classList.add('visible');
    elWhoami.textContent = user.email;
    await loadPlants();
  } else {
    currentUser = null;
    elLogin.classList.add('visible');
    elApp.classList.remove('visible');
  }
});

void finalizeRedirectSignIn();

async function loadPlants() {
  const myPlants = [];
  try {
    const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
    if (userSnap.exists()) {
      const userData = userSnap.data();
      let pIds = userData.plantIds || [];
      if (pIds.length === 0 && Array.isArray(userData.plants)) {
        pIds = userData.plants.map(p => p.id);
      }
      for (const pId of pIds) {
        const pSnap = await getDoc(doc(db, `plants/${pId}`));
        if (pSnap.exists()) {
          myPlants.push({ id: pId, name: pSnap.data().name || pId });
        }
      }
    }
  } catch (err) {
    console.error("Error loading plants:", err);
  }
  
  elPlantSelect.innerHTML = '<option value="">Select a plant...</option>';
  myPlants.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    elPlantSelect.appendChild(opt);
  });
  
  if (initPlantId && myPlants.find(p => p.id === initPlantId)) {
    elPlantSelect.value = initPlantId;
    currentScope = initScope;
    updateScopeButtons();
    await handlePlantChange();
    if (initScope === WIKI_SCOPE_PRESS && initPressId) {
      elPressSelect.value = initPressId;
      await handlePressChange();
    } else {
      if (initScope === WIKI_SCOPE_SHARED) {
        currentPressId = initPressId || currentPressId || '';
      }
      await refreshPageData();
    }
    const initialPageId = initPageId || (initScope === WIKI_SCOPE_SHARED ? SHARED_LIBRARY_INDEX_PAGE_ID : '');
    if (initialPageId && (initScope === WIKI_SCOPE_SHARED || initPressId)) {
      selectPage(initialPageId);
    }
  }
}

elPlantSelect.addEventListener('change', handlePlantChange);
async function handlePlantChange() {
  currentPlantId = elPlantSelect.value;
  elPressSelect.innerHTML = '<option value="">Select a press...</option>';
  elPressSelect.disabled = true;
  elNewPageBtn.disabled = true;
  resetEditor();
  
  if (!currentPlantId) return;
  
  // Fetch presses
  const confSnap = await getDoc(doc(db, `plants/${currentPlantId}/config/presses`));
  let pressConfig = DEFAULT_PRESSES;
  if (confSnap.exists() && confSnap.data().rows) {
    pressConfig = confSnap.data().rows;
  }
  
  const presses = [];
  Object.values(pressConfig).forEach(row => {
    row.forEach(p => presses.push(p));
  });
  presses.sort();
  
  presses.forEach(p => {
    const opt = document.createElement('option');
    opt.value = toPressId(p);
    opt.textContent = p;
    elPressSelect.appendChild(opt);
  });
  updateScopeButtons();
  if (currentScope === WIKI_SCOPE_SHARED) {
    await refreshPageData();
  } else {
    elPressSelect.disabled = false;
  }
}

elPressSelect.addEventListener('change', handlePressChange);
async function handlePressChange() {
  currentPressId = elPressSelect.value;
  if (currentScope !== WIKI_SCOPE_PRESS) return;
  await refreshPageData();
}

async function handleScopeChange(nextScope) {
  currentScope = nextScope === WIKI_SCOPE_SHARED ? WIKI_SCOPE_SHARED : WIKI_SCOPE_PRESS;
  updateScopeButtons();
  if (!currentPlantId) return;
  if (currentScope === WIKI_SCOPE_PRESS) {
    if (!currentPressId) {
      elPageList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px;">Select a press to view pages</div>';
      return;
    }
  }
  await refreshPageData();
}

function renderPageList() {
  elPageList.innerHTML = '';
  if (pages.length === 0) {
    elPageList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px;">No pages found</div>';
    return;
  }

  const tree = buildWikiTree(pages);
  syncExpandedDefaults(tree);
  if (currentPageId && currentPageId !== 'NEW') {
    collectWikiAncestors(currentPageId, tree.parentById).forEach(id => expandedPageIds.add(id));
  }

  const treeWrap = document.createElement('div');
  treeWrap.className = 'page-tree';
  tree.roots.forEach(node => renderWikiTreeNode(treeWrap, node, tree, 0));
  elPageList.appendChild(treeWrap);
}

function resetEditor() {
  currentPageId = null;
  currentPageDoc = null;
  elEditorContainer.style.display = 'none';
  elEmptyState.style.display = 'flex';
  elTitle.value = '';
  elSlug.value = '';
  elSummary.value = '';
  elTags.value = '';
  if (elParentPage) elParentPage.innerHTML = '<option value="">Root page</option>';
  elBody.value = '';
  elChangeNote.value = '';
  elAttachments.innerHTML = '';
  elRevisionList.innerHTML = '';
  if (elPreview) elPreview.innerHTML = '';
  attachmentsMap.clear();
  renderPageList();
  updateDeleteButtonState();
}

elNewPageBtn.addEventListener('click', () => {
  const defaultParentId = currentPageDoc?.id || (currentPageId && currentPageId !== 'NEW' ? currentPageId : null);
  currentPageId = 'NEW';
  currentPageDoc = null;
  elEditorContainer.style.display = 'block';
  elEmptyState.style.display = 'none';
  elTitle.value = '';
  elSlug.value = '';
  elSummary.value = '';
  elTags.value = '';
  renderParentPageOptions(defaultParentId, 'NEW');
  if (elParentPage) elParentPage.value = defaultParentId || '';
  elBody.value = '';
  elChangeNote.value = 'Initial creation';
  elAttachments.innerHTML = '';
  elRevisionList.innerHTML = '<div class="rev-date">No revisions yet</div>';
  renderPreview();
  attachmentsMap.clear();
  renderPageList();
  updateDeleteButtonState();
  elTitle.focus();
});

async function selectPage(pageId) {
  if (pageId === currentPageId && currentPageDoc?.id === pageId) return;
  currentPageId = pageId;
  elEditorContainer.style.display = 'block';
  elEmptyState.style.display = 'none';
  renderPageList();
  
  let pageData = pages.find(p => p.id === pageId);
  if (!pageData) {
    const pageSnap = await getDoc(wikiPageDoc(currentScope, currentPressId, pageId));
    if (pageSnap.exists()) pageData = { id: pageSnap.id, ...pageSnap.data() };
  }
  if (!pageData) {
    updateEditorMeta({ id: pageId, title: pageId, slug: pageId, tags: [], photoCount: 0 });
    currentPageDoc = null;
    elBody.value = '';
    elRevisionList.innerHTML = '<div style="color:var(--text3);">No wiki page found in this scope.</div>';
    renderPreview();
    attachmentsMap.clear();
    renderAttachments();
    updateDeleteButtonState();
    return;
  }

  updateEditorMeta(pageData);
  currentPageDoc = pageData;
  const tree = buildWikiTree(pages);
  collectWikiAncestors(pageId, tree.parentById).forEach(id => expandedPageIds.add(id));
  updateDeleteButtonState();

  // Fetch latest revision body
  const revsSnap = await getDocs(query(
    wikiRevisionsCol(currentScope, currentPressId, pageId),
    orderBy('editedAt', 'desc')
  ));

  elRevisionList.innerHTML = '';
  revsSnap.docs.forEach((docSnap, i) => {
    const data = docSnap.data();
    if (i === 0) {
      elBody.value = data.body || '';
    }

    const dStr = data.editedAt?.toDate ? data.editedAt.toDate().toLocaleString() : 'Just now';
    elRevisionList.insertAdjacentHTML('beforeend', `
      <div class="revision-item">
        <div class="rev-date">${dStr}</div>
        <div class="rev-note">${data.changeNote || 'No note'}</div>
      </div>
    `);
  });

  // Fetch attachments
  const attSnap = await getDocs(wikiAttachmentsCol(currentScope, currentPressId, pageId));
  attachmentsMap.clear();
  attSnap.docs.forEach(docSnap => attachmentsMap.set(docSnap.id, docSnap.data()));
  renderAttachments();
  renderPreview();

  elChangeNote.value = '';
}

function updateDeleteButtonState() {
  if (!elDeletePageBtn) return;
  const hasChildren = Boolean(currentPageId && currentPageId !== 'NEW' && pages.some(page => normalizeParentPageId(page.parentPageId) === currentPageId));
  const hasPage = Boolean(currentPageId && currentPageId !== 'NEW');
  const canDelete = Boolean(hasPage && !hasChildren);
  elDeletePageBtn.style.display = hasPage ? '' : 'none';
  elDeletePageBtn.disabled = !canDelete;
  elDeletePageBtn.title = hasChildren ? 'Move child pages first.' : '';
}

function updateEditorMeta(page) {
  elTitle.value = page.title || '';
  elSlug.value = page.slug || page.id || '';
  elSummary.value = page.summary || '';
  elTags.value = (page.tags || []).join(', ');
  renderParentPageOptions(page.parentPageId || null, page.id || currentPageId);
  if (elParentPage) elParentPage.value = normalizeParentPageId(page.parentPageId) || '';
}

// Generate an ID for new pages based on title
elTitle.addEventListener('input', () => {
  if (currentPageId === 'NEW') {
    elSlug.value = elTitle.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
});

// Photo upload placeholder logic
document.getElementById('upload-photo-btn').addEventListener('click', () => {
  elFileInput.click();
});

elFileInput.addEventListener('change', async (e) => {
  await handleFilesUpload(e.target.files, false);
  elFileInput.value = '';
});

// Drag and drop support on the text area
elBody.addEventListener('dragover', (e) => {
  e.preventDefault();
  elBody.style.borderColor = 'var(--accent)';
  elBody.style.background = 'var(--bg2)';
});

elBody.addEventListener('dragleave', (e) => {
  e.preventDefault();
  elBody.style.borderColor = 'var(--border)';
  elBody.style.background = 'var(--bg3)';
});

elBody.addEventListener('drop', async (e) => {
  e.preventDefault();
  elBody.style.borderColor = 'var(--border)';
  elBody.style.background = 'var(--bg3)';
  
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    await handleFilesUpload(e.dataTransfer.files, true);
  }
});

elBody.addEventListener('input', renderPreview);

async function moveCurrentPage(direction) {
  if (!currentPageDoc || !currentPageId || currentPageId === 'NEW') return;
  const tree = buildWikiTree(pages);
  const parentId = normalizeParentPageId(currentPageDoc.parentPageId);
  const siblings = (tree.childrenById.get(parentId) || tree.roots).filter(page => page.id !== currentPageId);
  const ordered = [...siblings, currentPageDoc].sort(compareWikiPages);
  const index = ordered.findIndex(page => page.id === currentPageId);
  const target = ordered[index + direction];
  if (!target) return showFeedback(direction < 0 ? 'Already at the top of this group.' : 'Already at the bottom of this group.', true);

  const currentSort = Number.isFinite(Number(currentPageDoc.sortOrder)) ? Number(currentPageDoc.sortOrder) : index;
  const targetSort = Number.isFinite(Number(target.sortOrder)) ? Number(target.sortOrder) : index + direction;
  try {
    showFeedback('Reordering...', false);
    await runTransaction(db, async tx => {
      tx.update(wikiPageDoc(currentScope, currentPressId, currentPageId), {
        sortOrder: targetSort,
        updatedBy: currentActor(),
        updatedAt: serverTimestamp()
      });
      tx.update(wikiPageDoc(currentScope, currentPressId, target.id), {
        sortOrder: currentSort,
        updatedBy: currentActor(),
        updatedAt: serverTimestamp()
      });
    });
    showFeedback('Reordered.', false);
  } catch (err) {
    showFeedback('Could not reorder page: ' + err.message, true);
  }
}

async function handleFilesUpload(files, autoInsert) {
  if (!files.length) return;
  
  if (currentPageId === 'NEW') {
    alert("Please save the page first before attaching photos.");
    return;
  }

  showFeedback("Uploading photos...", false);
  
  try {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      
      const attId = 'att_' + Date.now() + '_' + Math.floor(Math.random()*1000);
      const ext = file.name.split('.').pop() || 'png';
      const path = currentScope === WIKI_SCOPE_SHARED
        ? `plants/${currentPlantId}/wikiPages/${currentPageId}/attachments/${attId}.${ext}`
        : `plants/${currentPlantId}/presses/${currentPressId}/wikiPages/${currentPageId}/attachments/${attId}.${ext}`;
      const sRef = storageRef(storageFallback, path);
      
      await uploadBytesResumable(sRef, file);
      const url = await getDownloadURL(sRef);
      
      const attDoc = {
        storagePath: path,
        url: url,
        contentType: file.type,
        caption: file.name,
        uploadedBy: currentActor(),
        uploadedAt: serverTimestamp()
      };
      
      await setDoc(doc(db, ...(currentScope === WIKI_SCOPE_SHARED
        ? ['plants', currentPlantId, 'wikiPages', currentPageId, 'attachments', attId]
        : ['plants', currentPlantId, 'presses', currentPressId, 'wikiPages', currentPageId, 'attachments', attId]
      )), attDoc);
      attachmentsMap.set(attId, attDoc);
      
      if (autoInsert) {
        const md = `\n![${attDoc.caption}](${attDoc.url})\n`;
        const pos = elBody.selectionStart;
        const text = elBody.value;
        elBody.value = text.slice(0, pos) + md + text.slice(pos);
        elBody.focus();
        const newPos = pos + md.length;
        elBody.setSelectionRange(newPos, newPos);
      }
    }
    
    await updateDoc(doc(db, ...(currentScope === WIKI_SCOPE_SHARED
      ? ['plants', currentPlantId, 'wikiPages', currentPageId]
      : ['plants', currentPlantId, 'presses', currentPressId, 'wikiPages', currentPageId]
    )), {
      photoCount: attachmentsMap.size
    });
    
    renderAttachments();
    showFeedback("Upload complete.", false);
  } catch (err) {
    showFeedback("Upload failed: " + err.message, true);
  }
}

function renderAttachments() {
  elAttachments.innerHTML = '';
  attachmentsMap.forEach((att, id) => {
    const tile = document.createElement('div');
    tile.className = 'attachment-tile';
    tile.style.backgroundImage = `url(${att.url})`;
    
    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = '✕';
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      if(confirm('Delete this photo?')) {
        await deleteAttachment(id, att);
      }
    };
    
    // Click tile to insert markdown into body
    tile.onclick = () => {
      const md = `\n![${att.caption}](${att.url})\n`;
      const pos = elBody.selectionStart;
      const text = elBody.value;
      elBody.value = text.slice(0, pos) + md + text.slice(pos);
      elBody.focus();
    };
    
    tile.appendChild(delBtn);
    elAttachments.appendChild(tile);
  });
}

async function deleteAttachment(attId, attData) {
  try {
    const sRef = storageRef(storageFallback, attData.storagePath);
    await deleteObject(sRef).catch(e => console.log('Storage del failed', e));
    const attPath = currentScope === WIKI_SCOPE_SHARED
      ? ['plants', currentPlantId, 'wikiPages', currentPageId, 'attachments', attId]
      : ['plants', currentPlantId, 'presses', currentPressId, 'wikiPages', currentPageId, 'attachments', attId];
    await setDoc(doc(db, ...attPath), { _deleted: true }, { merge: false }); // Optional: archive instead of actual delete. Using deleteDoc.
    await deleteDoc(doc(db, ...attPath));
    attachmentsMap.delete(attId);
    renderAttachments();
  } catch(e) {}
}

async function deleteWikiDocsInBatches(colRef) {
  while (true) {
    const snap = await getDocs(query(colRef, limit(400)));
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 400) return;
  }
}

async function deleteCurrentPage() {
  if (!currentPageId || currentPageId === 'NEW') return;
  const hasChildren = pages.some(page => normalizeParentPageId(page.parentPageId) === currentPageId);
  if (hasChildren) {
    showFeedback('Move child pages first before deleting this page.', true);
    return;
  }
  const title = elTitle.value.trim() || currentPageDoc?.title || currentPageId;
  const ok = confirm(`Delete "${title}"? This will remove the page, its revisions, and its attachments.`);
  if (!ok) return;

  showFeedback('Deleting page...', false);
  try {
    const attachmentsSnap = await getDocs(wikiAttachmentsCol(currentScope, currentPressId, currentPageId));
    const attachments = attachmentsSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    await Promise.allSettled(attachments.map(async att => {
      if (!att?.storagePath) return;
      await deleteObject(storageRef(storageFallback, att.storagePath));
    }));

    await deleteWikiDocsInBatches(wikiAttachmentsCol(currentScope, currentPressId, currentPageId));
    await deleteWikiDocsInBatches(wikiRevisionsCol(currentScope, currentPressId, currentPageId));
    await deleteDoc(wikiPageDoc(currentScope, currentPressId, currentPageId));

    showFeedback('Page deleted.', false);
    resetEditor();
    await refreshPageData();
  } catch (err) {
    showFeedback('Could not delete page: ' + err.message, true);
  }
}

document.getElementById('cancel-btn').addEventListener('click', () => {
  if (currentPageId === 'NEW') resetEditor();
  else selectPage(currentPageId); // reload
});

elDeletePageBtn?.addEventListener('click', deleteCurrentPage);
elMovePageUpBtn?.addEventListener('click', () => moveCurrentPage(-1));
elMovePageDownBtn?.addEventListener('click', () => moveCurrentPage(1));

document.getElementById('cms-scope-press')?.addEventListener('click', () => handleScopeChange(WIKI_SCOPE_PRESS));
document.getElementById('cms-scope-shared')?.addEventListener('click', () => handleScopeChange(WIKI_SCOPE_SHARED));

document.getElementById('save-btn').addEventListener('click', async () => {
  const title = elTitle.value.trim();
  const slug = elSlug.value.trim() || 'untitled';
  const summary = elSummary.value.trim();
  const tagsStr = elTags.value.trim();
  const body = elBody.value.trim();
  const rawChangeNote = elChangeNote.value.trim();
  const parentPageId = normalizeParentPageId(elParentPage?.value);
  const fallbackActorName = String(currentActor()?.name || currentUser?.displayName || currentUser?.email || 'Unknown').trim() || 'Unknown';
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const changeNote = rawChangeNote || `${fallbackActorName} : ${dd}/${mm}/${yy}`;
  
  if (!title) return showFeedback("Title is required", true);
  
  showFeedback("Saving...", false);
  document.getElementById('save-btn').disabled = true;
  
  try {
    const isNew = (currentPageId === 'NEW');
    const pageId = isNew ? slug : currentPageId;
    const revId = 'rev_' + Date.now();
    const tree = buildWikiTree(pages);
    const invalidParent = parentPageId && (parentPageId === pageId || collectWikiDescendants(pageId, tree.childrenById).has(parentPageId));
    if (invalidParent) throw new Error('Choose a different parent page.');
    const currentParentId = normalizeParentPageId(currentPageDoc?.parentPageId);
    const sortOrder = isNew || parentPageId !== currentParentId || !Number.isFinite(Number(currentPageDoc?.sortOrder))
      ? getNextWikiSortOrder(parentPageId, isNew ? null : pageId)
      : Number(currentPageDoc?.sortOrder);
    
    const pageRef = doc(db, ...(currentScope === WIKI_SCOPE_SHARED
      ? ['plants', currentPlantId, 'wikiPages', pageId]
      : ['plants', currentPlantId, 'presses', currentPressId, 'wikiPages', pageId]
    ));
    const revRef = doc(db, ...(currentScope === WIKI_SCOPE_SHARED
      ? ['plants', currentPlantId, 'wikiPages', pageId, 'revisions', revId]
      : ['plants', currentPlantId, 'presses', currentPressId, 'wikiPages', pageId, 'revisions', revId]
    ));
    
    await runTransaction(db, async (t) => {
      let pageData = {
        title: title,
        slug: slug,
        summary: summary,
        tags: tagsStr.split(',').map(s=>s.trim()).filter(Boolean),
        searchText: `${title} ${summary} ${tagsStr}`.toLowerCase(),
        scope: currentScope,
        pressId: currentScope === WIKI_SCOPE_SHARED ? null : currentPressId,
        updatedBy: currentActor(),
        updatedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        currentRevisionId: revId,
        parentPageId,
        sortOrder,
        schemaVersion: 2
      };
      
      if (isNew) {
        const snap = await t.get(pageRef);
        if (snap.exists()) throw new Error("A page with this slug already exists.");
        pageData.createdBy = currentActor();
        pageData.createdAt = serverTimestamp();
        pageData.photoCount = 0;
        t.set(pageRef, pageData);
      } else {
        if (parentPageId && collectWikiDescendants(pageId, tree.childrenById).has(parentPageId)) {
          throw new Error('Choose a different parent page.');
        }
        t.update(pageRef, pageData);
      }

      t.set(revRef, {
        body: body,
        changeNote: changeNote,
        prevRevisionId: currentPageDoc ? currentPageDoc.currentRevisionId : null,
        editedBy: currentActor(),
        editedAt: serverTimestamp()
      });
    });
    
    showFeedback("Saved successfully!", false);
    elChangeNote.value = '';
    
    if (isNew) {
      currentPageId = pageId;
      // selection will update automatically via onSnapshot
    } else {
      // Manual refresh of revisions list
      selectPage(pageId);
    }
    
  } catch (err) {
    showFeedback("Error saving: " + err.message, true);
  } finally {
    document.getElementById('save-btn').disabled = false;
  }
});

window.insertMarkdown = function(textareaId, prefix, suffix) {
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
