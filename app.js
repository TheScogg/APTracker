import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, collectionGroup, updateDoc as rawUpdateDoc, deleteDoc as rawDeleteDoc, doc, getDoc as rawGetDoc, getDocs as rawGetDocs, setDoc as rawSetDoc, addDoc as rawAddDoc, onSnapshot as rawOnSnapshot, serverTimestamp, query, orderBy, where, writeBatch as rawWriteBatch, arrayUnion, arrayRemove, increment, limit, runTransaction as rawRunTransaction, startAfter } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, setPersistence, browserLocalPersistence, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut as fbSignOut, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage, ref as storageRef, uploadString, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getMessaging, getToken, isSupported as isMessagingSupported, onMessage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { alphaColor, esc, extFromContentType, localDateStr, parseDataUrlMeta } from "./app-utils.js";
import { createDropdownController } from "./dropdown-ui.js";
import { createDataApi, DATA_BACKEND_SQL, selectedDataBackend } from "./data-api.js";
import { createApiSessionClient } from "./auth-session-client.js";
import { createFirebasePathHelpers } from "./firebase-paths.js";
import { initExportTool } from "./export-tool.js";
import { initIssueReminders } from "./issue-reminders.js";
import { initTodosTool } from "./todos-tool.js";
import {
  normalizeChecklistItems,
  noteTextFromHtml as _noteTextFromHtml,
  sanitizeNoteHtml
} from "./notes-utils.js";
import {
  BUILT_IN_THEME_DEFS,
  THEME_EDITOR_CORE_VARS,
  applyThemeVars as applyThemeVarsFromEngine,
  clearThemeVars as clearThemeVarsFromEngine,
  getThemePreviewColors,
  inferThemeModeFromVars,
  normalizeThemeColors,
  normalizeThemeVars,
  readSavedTheme,
  removeThemeClasses,
  saveThemeSelection,
  themeLabelSansIcon,
  getContrastRatio,
  THEME_TOKEN_MAP,
  THEME_SOFT_TOKEN_MAP
} from "./theme-engine.js";
import {
  normalizeSubcategoryRoutes as normalizeSharedSubcategoryRoutes,
  syncStatusesFromSubcategoryRoutes as syncSharedStatusesFromSubcategoryRoutes
} from "./shared-config.js";

const firebaseConfig = {
  apiKey: "AIzaSyABjasNBbJnsqq4M_UxKruKrN6-O2FXCwc",
  authDomain: "press-tracker-9d9c9.firebaseapp.com",
  projectId: "press-tracker-9d9c9",
  storageBucket: "press-tracker-9d9c9.firebasestorage.app",
  messagingSenderId: "943200266003",
  appId: "1:943200266003:web:4d24eab551a3fb145c1ce6"
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const storage = getStorage(app);
const storageFallback = firebaseConfig.storageBucket && firebaseConfig.storageBucket.includes('.appspot.com')
  ? null
  : getStorage(app, `gs://${firebaseConfig.projectId}.appspot.com`);
const auth = getAuth(app);
void setPersistence(auth, browserLocalPersistence).catch(() => {});
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
const FCM_VAPID_KEY = String(window.AP_TRACKER_FCM_CONFIG?.vapidKey || '').trim();
let fcmMessaging = null;
let fcmRegistration = null;
let fcmTokenRegistrationPromise = null;
const NO_AUTH_MODE = location.pathname.endsWith('/noauth.html');
const SELECTED_DATA_BACKEND = selectedDataBackend();
const NO_AUTH_USER = {
  uid: 'noauth-local',
  displayName: 'No Auth Guest',
  email: '',
  photoURL: ''
};

const DEMO_MODE = location.search.includes('demo=1');
const DEMO_USER = {
  uid: 'demo-anon',
  displayName: 'Demo Session',
  email: '',
  photoURL: ''
};
const DEMO_PLANT_ID = 'plant_demo';
const DEMO_PLANT_NAME = 'Demo Plant';
const DEMO_GUIDE_KEY = 'aptracker_demo_guide_v1';
const SQL_STAGING_READ_MODE = SELECTED_DATA_BACKEND === DATA_BACKEND_SQL && !NO_AUTH_MODE && !DEMO_MODE;
const SQL_STAGING_PLANT_IDS = new Set(['ap4_mnc7kecn']);

const firestoreIoStats = { reads: 0, writes: 0 };
const APP_BUILD_INFO = window.__APP_BUILD_INFO__ || {};
const APP_VERSION = APP_BUILD_INFO.shortCommit || APP_BUILD_INFO.version || window.__APP_VERSION__ || 'dev';
function refreshAppVersionIndicator() {
  const el = document.getElementById('app-version-indicator');
  if (!el) return;
  const dirtySuffix = APP_BUILD_INFO.dirty ? ' (dirty build)' : '';
  el.textContent = `rev: ${APP_VERSION}${APP_BUILD_INFO.dirty ? '*' : ''}`;
  const titleParts = [
    `Current commit: ${APP_BUILD_INFO.commit || APP_VERSION}`,
    APP_BUILD_INFO.branch ? `Branch: ${APP_BUILD_INFO.branch}` : '',
    APP_BUILD_INFO.commitDate ? `Commit date: ${APP_BUILD_INFO.commitDate}` : '',
    APP_BUILD_INFO.builtAt ? `Built: ${APP_BUILD_INFO.builtAt}` : ''
  ].filter(Boolean);
  el.title = `${titleParts.join('\n')}${dirtySuffix}`;
}
function refreshFirestoreIoIndicator() {
  const el = document.getElementById('firestore-io-indicator');
  if (!el) return;
  el.textContent = `R:${firestoreIoStats.reads} W:${firestoreIoStats.writes}`;
}
function trackFirestoreRead(amount = 1) {
  firestoreIoStats.reads += Math.max(0, Number(amount) || 0);
  refreshFirestoreIoIndicator();
}
function trackFirestoreWrite(amount = 1) {
  firestoreIoStats.writes += Math.max(0, Number(amount) || 0);
  refreshFirestoreIoIndicator();
}
const getDoc = async (...args) => {
  const snap = await rawGetDoc(...args);
  trackFirestoreRead(1);
  return snap;
};
const getDocs = async (...args) => {
  const snap = await rawGetDocs(...args);
  trackFirestoreRead(snap?.size ?? 0);
  return snap;
};
const setDoc = async (...args) => { const out = await rawSetDoc(...args); trackFirestoreWrite(1); markLocalWriteQueued(); return out; };
const addDoc = async (...args) => { const out = await rawAddDoc(...args); trackFirestoreWrite(1); markLocalWriteQueued(); return out; };
const updateDoc = async (...args) => { const out = await rawUpdateDoc(...args); trackFirestoreWrite(1); markLocalWriteQueued(); return out; };
const deleteDoc = async (...args) => { const out = await rawDeleteDoc(...args); trackFirestoreWrite(1); markLocalWriteQueued(); return out; };
const deepCopy = (obj) => {
  if (obj === undefined) return undefined;
  return JSON.parse(JSON.stringify(obj));
};
const writeBatch = (...args) => {
  const batch = rawWriteBatch(...args);
  const originalCommit = batch.commit.bind(batch);
  batch.commit = async (...commitArgs) => {
    const out = await originalCommit(...commitArgs);
    trackFirestoreWrite(1);
    markLocalWriteQueued();
    return out;
  };
  return batch;
};
const runTransaction = async (...args) => {
  const out = await rawRunTransaction(...args);
  trackFirestoreWrite(1);
  markLocalWriteQueued();
  return out;
};
const apiSessionClient = createApiSessionClient({
  async getFirebaseIdToken() {
    if (!currentUser?.getIdToken) throw new Error('Sign in is required.');
    return currentUser.getIdToken();
  }
});
const dataApi = createDataApi({
  sql: {
    async getIdToken() {
      return apiSessionClient.getAccessToken();
    }
  }
});
const sqlPlantBootstrapCache = new Map();

function shouldUseSqlBootstrap() {
  return SQL_STAGING_READ_MODE;
}

function shouldUseSqlStagingReads(plantId = currentPlantId) {
  return SQL_STAGING_READ_MODE && SQL_STAGING_PLANT_IDS.has(String(plantId || ''));
}

async function safeSqlRead(label, loader) {
  if (!shouldUseSqlStagingReads()) return null;
  try {
    return await loader();
  } catch (error) {
    console.warn(`SQL staging read failed for ${label}; falling back to Firebase.`, error);
    return null;
  }
}

async function requireSqlRead(label, loader, missingMessage = '') {
  const payload = await safeSqlRead(label, loader);
  if (payload) return payload;
  throw new Error(missingMessage || `D1 read failed for ${label}.`);
}

async function safeSqlBootstrapRead(label, loader) {
  if (!shouldUseSqlBootstrap()) return null;
  try {
    return await loader();
  } catch (error) {
    console.error(`SQL bootstrap read failed for ${label}. D1 is required for bootstrap in SQL mode.`, error);
    throw error;
  }
}

async function requireSqlBootstrapRead(label, loader, missingMessage = '', validator = null) {
  const payload = await safeSqlBootstrapRead(label, loader);
  if (validator ? validator(payload) : payload) return payload;
  throw new Error(missingMessage || `D1 bootstrap data is missing for ${label}.`);
}

async function ensureSqlPlantBootstrap(plantId) {
  if (!shouldUseSqlStagingReads() || !plantId) return null;
  if (sqlPlantBootstrapCache.has(plantId)) return sqlPlantBootstrapCache.get(plantId);
  const payload = await requireSqlRead(
    `plant bootstrap ${plantId}`,
    () => dataApi.loadPlantBootstrap(plantId),
    `Plant bootstrap is missing in D1 for plant ${plantId}.`
  );
  sqlPlantBootstrapCache.set(plantId, payload);
  return payload;
}

function invalidateSqlPlantBootstrap(plantId = currentPlantId) {
  if (!plantId) return;
  sqlPlantBootstrapCache.delete(plantId);
}

function toCompatTimestamp(value) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return {
    toMillis: () => ms,
    toDate: () => new Date(ms)
  };
}

function compatTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function formatSqlDateTime(value, fallback = '') {
  const timestamp = toCompatTimestamp(value);
  if (!timestamp) return fallback;
  try {
    return fmtDate(timestamp.toDate());
  } catch (_) {
    return fallback;
  }
}

function normalizeSqlIssueForApp(issue = {}) {
  const currentStatus = {
    statusKey: issue.currentStatusKey || 'open',
    subStatusKey: issue.currentSubStatusKey || '',
    label: issue.currentStatusLabel || issue.currentStatusKey || 'open',
    subLabel: issue.currentSubStatusLabel || issue.currentSubStatusKey || '',
    color: issue.currentStatusColor || getStatusColor(issue.currentStatusKey || 'open'),
    enteredAt: toCompatTimestamp(issue.currentStatusEnteredAt),
    enteredDateTime: formatSqlDateTime(issue.currentStatusEnteredAt, issue.createdAt || ''),
    enteredBy: {
      uid: issue.currentStatusEnteredByUid || '',
      name: issue.currentStatusEnteredByName || ''
    },
    notePreview: issue.latestNotePreview || issue.note || ''
  };
  const createdAtTs = toCompatTimestamp(issue.createdAt);
  const updatedAtTs = toCompatTimestamp(issue.updatedAt);
  const openedAtTs = toCompatTimestamp(issue.openedAt || issue.createdAt);
  const resolvedAtTs = toCompatTimestamp(issue.resolvedAt);
  return {
    ...issue,
    id: issue.issueId,
    plantId: issue.plantId || currentPlantId,
    machine: issue.machineCode || '',
    machineCode: issue.machineCode || '',
    dateKey: issue.reportingDateKey || (createdAtTs?.toDate ? localDateStr(createdAtTs.toDate()) : ''),
    reportingDateKey: issue.reportingDateKey || '',
    reportingWeekKey: issue.reportingWeekKey || '',
    reportingMonthKey: issue.reportingMonthKey || '',
    shift: issue.reportingShiftKey || '',
    userId: issue.createdByUid || '',
    userName: issue.createdByName || '',
    createdAt: createdAtTs,
    updatedAt: updatedAtTs,
    dateTime: formatSqlDateTime(issue.currentStatusEnteredAt || issue.openedAt || issue.createdAt, ''),
    timestamp: createdAtTs?.toMillis ? createdAtTs.toMillis() : Date.now(),
    currentStatus,
    statusHistory: Array.isArray(issue.legacyStatusHistory) ? issue.legacyStatusHistory.map(entry => ({ ...entry })) : [],
    lifecycle: {
      isOpen: issue.isOpen !== false,
      isResolved: !!issue.isResolved,
      openedAt: openedAtTs,
      resolvedAt: resolvedAtTs,
      closedAt: toCompatTimestamp(issue.closedAt),
      reopenedCount: Number(issue.reopenedCount || 0)
    },
    resolved: !!issue.isResolved,
    photos: attachmentPhotoCache.get(issue.issueId) || [],
    eventHistory: issueEventHistoryCache.get(issue.issueId) || []
  };
}

function normalizeSqlIssueList(issuesList = []) {
  return (issuesList || []).map(normalizeSqlIssueForApp);
}

function setNestedValue(target, path, value) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function applyIssuePatchLocally(baseIssue, patch = {}) {
  const next = deepCopy(baseIssue || {}) || {};
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (key.includes('.')) setNestedValue(next, key, deepCopy(value));
    else next[key] = deepCopy(value);
  });
  return next;
}

function buildCurrentStatusLocal(statusKey, subStatus = '', enteredDateTime = '', note = '') {
  const def = getStatusDef(statusKey);
  const enteredAt = new Date().toISOString();
  return {
    statusKey: statusKey || 'open',
    subStatusKey: subStatus || '',
    label: def?.label || statusKey || 'Open',
    subLabel: subStatus || '',
    color: getStatusColor(statusKey),
    enteredAt,
    enteredDateTime: enteredDateTime || fmtDate(new Date()),
    enteredBy: currentActor(),
    notePreview: note || ''
  };
}

function deriveLifecycleLocal(statusKey, baseIssue = null, opts = {}) {
  const isResolved = statusKey === 'resolved';
  const now = new Date().toISOString();
  const wasResolved = !!(baseIssue?.lifecycle?.isResolved || baseIssue?.resolved);
  const priorReopenCount = Number(baseIssue?.lifecycle?.reopenedCount || 0);
  const openedAt = baseIssue?.lifecycle?.openedAt?.toDate
    ? baseIssue.lifecycle.openedAt.toDate().toISOString()
    : (baseIssue?.lifecycle?.openedAt || baseIssue?.createdAt || now);
  return {
    isOpen: !isResolved,
    isResolved,
    openedAt,
    resolvedAt: isResolved ? now : null,
    closedAt: isResolved ? now : null,
    reopenedCount: opts.forceReopenIncrement ? priorReopenCount + 1 : (wasResolved && !isResolved ? priorReopenCount + 1 : priorReopenCount)
  };
}

function buildIssueV2CompatLocal({ machineCode, statusKey, subStatus = '', statusDateTime = '', note = '', baseIssue = null, forceReopenIncrement = false }) {
  const rowName = findRowNameForMachine(machineCode);
  return {
    schemaVersion: 2,
    plantId: currentPlantId,
    pressId: toPressId(machineCode),
    machineCode: machineCode || '',
    rowId: toRowId(rowName),
    currentStatus: buildCurrentStatusLocal(statusKey, subStatus, statusDateTime, note),
    lifecycle: deriveLifecycleLocal(statusKey, baseIssue, { forceReopenIncrement }),
    updatedAt: new Date().toISOString(),
    updatedBy: currentActor()
  };
}

function sqlAttachmentPayloads(photos = []) {
  return (photos || []).filter(photo => photo?.storagePath).map((photo, index) => ({
    attachmentId: `photo_${String(index).padStart(3, '0')}_${String(photo.storagePath).split('/').pop().replace(/[^a-zA-Z0-9]+/g, '_')}`,
    type: 'photo',
    fileName: photo.name || '',
    contentType: photo.contentType || 'image/jpeg',
    storagePath: photo.storagePath,
    storageBucket: photo.storageBucket || '',
    downloadUrl: photo.downloadURL || photo.dataUrl || '',
    uploadedBy: currentActor(),
    uploadedAt: photo.uploadedAt || new Date().toISOString(),
    sizeBytes: Number(photo.sizeBytes || 0),
    schemaVersion: 2
  }));
}

function sqlEventPayload(type, payload = {}) {
  const now = new Date().toISOString();
  return {
    type,
    eventAt: now,
    createdAt: now,
    actor: currentActor(),
    payload,
    schemaVersion: 2
  };
}

async function commitSqlIssueWrite(issueId, issue, { attachments = [], replaceAttachments = false, events = [], permissionName } = {}) {
  const payload = await dataApi.updateIssue(currentPlantId, issueId, {
    issueId,
    issue,
    attachments,
    replaceAttachments,
    events,
    permissionName
  });
  if (payload?.issue) {
    issuesById.set(issueId, normalizeSqlIssueForApp(payload.issue));
    rebuildIssuesArrayFromMap();
    refreshVisibleData();
  }
  if (attachments.length) {
    attachmentPhotoCache.set(issueId, issue.photos || []);
  }
  if (events.length) {
    issueEventHistoryCache.delete(issueId);
  }
  refreshSyncState({
    status: 'live',
    fromCache: false,
    hasPendingWrites: false,
    lastServerAt: Date.now(),
    lastError: null,
    manualText: 'Live - synced from D1'
  });
  return payload;
}

const syncState = {
  status: 'connecting',
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  fromCache: true,
  hasPendingWrites: false,
  lastServerAt: null,
  lastError: null,
  manualText: 'Connecting...'
};
const migrationReadinessState = {
  loading: false,
  data: null,
  error: '',
  checkedAt: 0
};

function statusClassForSyncState(status) {
  if (status === 'live') return 'ok';
  if (status === 'offline' || status === 'error') return 'err';
  if (status === 'syncing') return 'syncing';
  if (status === 'cached') return 'cached';
  return '';
}

function defaultSyncText() {
  if (syncState.status === 'switching') return syncState.manualText || 'Switching plant...';
  if (syncState.status === 'error') return syncState.manualText || 'Error - retrying connection';
  if (syncState.hasPendingWrites) return 'Syncing - local changes pending';
  if (!syncState.online) return 'Offline - showing cached data';
  if (syncState.fromCache) return 'Cached - showing saved data';
  if (syncState.lastServerAt) return syncState.manualText || 'Live - synced across all devices';
  return syncState.manualText || 'Connecting...';
}

function applySyncBanner() {
  const banner = document.getElementById('sync-banner');
  const dot = document.getElementById('sync-dot');
  const text = document.getElementById('sync-text');
  if (!banner || !dot || !text) return;
  banner.classList.add('visible');
  banner.dataset.syncStatus = syncState.status || 'connecting';
  dot.className = `sync-dot ${statusClassForSyncState(syncState.status)}`.trim();
  text.textContent = defaultSyncText();
  renderMigrationStatusPill();
}

function migrationStatusPillTone() {
  if (!shouldUseSqlBootstrap()) return '';
  if (migrationReadinessState.error) return 'warn';
  const data = migrationReadinessState.data;
  if (!data) return migrationReadinessState.loading ? 'info' : 'warn';
  const needsAttachmentCutover = !data?.bindings?.attachmentsR2;
  const hasLegacyRuntime = Object.values(data?.runtimeDependencies || {}).some(Boolean);
  if (needsAttachmentCutover) return 'warn';
  if (hasLegacyRuntime) return 'info';
  return 'ok';
}

function migrationStatusPillLabel() {
  if (!shouldUseSqlBootstrap()) return '';
  if (migrationReadinessState.loading && !migrationReadinessState.data) return 'SQL check...';
  if (migrationReadinessState.error) return 'SQL readiness unknown';
  const data = migrationReadinessState.data;
  if (!data) return 'SQL readiness pending';
  const remainingSteps = Array.isArray(data.remainingSteps) ? data.remainingSteps.filter(Boolean) : [];
  if (remainingSteps.length > 0) return `SQL migration: ${remainingSteps.length} left`;
  if (data.ready) return 'SQL ready';
  return 'SQL migration active';
}

function migrationStatusPillTitle() {
  if (!shouldUseSqlBootstrap()) return '';
  if (migrationReadinessState.error) {
    return `Could not load SQL migration readiness: ${migrationReadinessState.error}`;
  }
  const data = migrationReadinessState.data;
  if (!data) return migrationReadinessState.loading ? 'Checking SQL migration readiness.' : 'SQL migration readiness has not been loaded yet.';
  const lines = [];
  const bindings = data.bindings || {};
  const runtimeDependencies = data.runtimeDependencies || {};
  const migrationState = data.migrationState || {};
  lines.push(`D1 binding: ${bindings.d1 ? 'ready' : 'missing'}`);
  lines.push(`R2 attachments: ${bindings.attachmentsR2 ? 'ready' : 'missing'}`);
  lines.push(`App session secret: ${bindings.appSessionSecret ? 'ready' : 'missing'}`);
  lines.push(`Firebase auth exchange: ${runtimeDependencies.firebaseAuthSessionExchange ? 'still enabled' : 'off'}`);
  lines.push(`FCM push delivery: ${runtimeDependencies.fcmPushDelivery ? 'still enabled' : 'off'}`);
  lines.push(`Attachment storage cutover: ${migrationState.attachmentStorageCloudflareReady ? 'ready' : 'not finished'}`);
  const remainingSteps = Array.isArray(data.remainingSteps) ? data.remainingSteps.filter(Boolean) : [];
  if (remainingSteps.length) {
    lines.push('');
    remainingSteps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step}`);
    });
  }
  return lines.join('\n');
}

function renderMigrationStatusPill() {
  const syncBanner = document.getElementById('sync-banner');
  if (!syncBanner) return;
  let pill = document.getElementById('migration-status-pill');
  if (!shouldUseSqlBootstrap()) {
    if (pill) pill.remove();
    return;
  }
  if (!pill) {
    pill = document.createElement('span');
    pill.id = 'migration-status-pill';
    pill.className = 'migration-status-pill';
    syncBanner.insertBefore(pill, document.getElementById('app-version-indicator') || null);
  }
  const tone = migrationStatusPillTone();
  pill.className = `migration-status-pill ${tone}`.trim();
  pill.textContent = migrationStatusPillLabel();
  pill.title = migrationStatusPillTitle();
}

function deriveSyncStatus() {
  if (syncState.status === 'switching' || syncState.status === 'error') return syncState.status;
  if (syncState.hasPendingWrites) return 'syncing';
  if (!syncState.online) return 'offline';
  if (syncState.fromCache) return 'cached';
  if (syncState.lastServerAt) return 'live';
  return 'connecting';
}

function refreshSyncState(patch = {}) {
  Object.assign(syncState, patch);
  if (!patch.status) syncState.status = deriveSyncStatus();
  applySyncBanner();
}

function observeSyncSnapshot(snapshot) {
  const fromCache = Boolean(snapshot?.metadata?.fromCache);
  const hasPendingWrites = Boolean(snapshot?.metadata?.hasPendingWrites);
  refreshSyncState({
    status: null,
    fromCache,
    hasPendingWrites,
    lastServerAt: fromCache ? syncState.lastServerAt : Date.now(),
    lastError: null,
    manualText: ''
  });
}

function isOfflineLikeError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return !syncState.online
    || code === 'unavailable'
    || code === 'deadline-exceeded'
    || message.includes('offline')
    || message.includes('network')
    || message.includes('failed to get document');
}

function hasLocalPhotos(photos = []) {
  return (photos || []).some(p => p?.dataUrl && !p?.storagePath && !p?.downloadURL && !p?.url);
}

function guardOfflinePhotos(photos = [], context = 'Photos') {
  if (syncState.online || !hasLocalPhotos(photos)) return false;
  const message = `${context} require connection. Save again after WiFi is back.`;
  setSyncStatus('err', message);
  if (typeof showGameToast === 'function') showGameToast(message);
  return true;
}

function markLocalWriteQueued() {
  if (!syncState.online || syncState.fromCache) {
    refreshSyncState({ status: 'syncing', hasPendingWrites: true, manualText: 'Syncing - local changes pending' });
  }
}

const ISSUE_OUTBOX_DB = 'aptracker_issue_outbox_v1';
const ISSUE_OUTBOX_STORE = 'issues';
let issueOutboxDbPromise = null;
let issueOutboxFlushPromise = null;

function openIssueOutboxDb() {
  if (issueOutboxDbPromise) return issueOutboxDbPromise;
  issueOutboxDbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Local offline storage is not supported in this browser.'));
      return;
    }
    const req = indexedDB.open(ISSUE_OUTBOX_DB, 1);
    req.onupgradeneeded = () => {
      const dbi = req.result;
      const store = dbi.objectStoreNames.contains(ISSUE_OUTBOX_STORE)
        ? req.transaction.objectStore(ISSUE_OUTBOX_STORE)
        : dbi.createObjectStore(ISSUE_OUTBOX_STORE, { keyPath: 'id' });
      if (!store.indexNames.contains('plantId')) store.createIndex('plantId', 'plantId', { unique: false });
      if (!store.indexNames.contains('status')) store.createIndex('status', 'status', { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open local issue outbox.'));
  });
  return issueOutboxDbPromise;
}

async function issueOutboxTx(mode, fn) {
  const dbi = await openIssueOutboxDb();
  return new Promise((resolve, reject) => {
    const tx = dbi.transaction(ISSUE_OUTBOX_STORE, mode);
    const store = tx.objectStore(ISSUE_OUTBOX_STORE);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Local issue outbox transaction failed.'));
    tx.onabort = () => reject(tx.error || new Error('Local issue outbox transaction aborted.'));
    result = fn(store);
  });
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Local outbox request failed.'));
  });
}

async function saveLocalIssueOutboxItem(item) {
  await issueOutboxTx('readwrite', store => store.put(item));
}

async function deleteLocalIssueOutboxItem(id) {
  await issueOutboxTx('readwrite', store => store.delete(id));
}

async function loadLocalIssueOutboxItems() {
  return issueOutboxTx('readonly', store => requestToPromise(store.getAll()));
}

function localIssueForOutboxItem(item) {
  const draft = item.draft || {};
  const localPhotos = item.localPhotos || [];
  const payload = buildLocalIssuePayloadFromDraft(item.id, draft, localPhotos);
  return {
    ...payload,
    id: item.id,
    photos: localPhotos,
    __localPending: item.status !== 'failed',
    __localSyncStatus: item.status || 'pending',
    __localSyncError: item.error || '',
    photoCount: localPhotos.length || Number(payload.photoCount || 0)
  };
}

function buildLocalIssuePayloadFromDraft(issueId, draft, photos = []) {
  const statusDateTime = draft.statusDateTime || draft.dateTime || fmtDate(new Date());
  const actor = draft.actor || currentActor();
  const workflowId = draft.initialWorkflowId || createWorkflowId(draft.initialStatus || 'open');
  const statusKey = draft.initialStatus || 'open';
  const subStatus = draft.initialSubStatus || '';
  return {
    machine: draft.machine || '',
    machineCode: draft.machine || '',
    note: draft.note || 'No Description Provided',
    dateTime: draft.dateTime || statusDateTime,
    dateKey: draft.dateKey || localDateStr(new Date()),
    timestamp: Number(draft.timestamp || Date.now()),
    shift: draft.shift || '',
    timer: draft.timer || null,
    userId: draft.userId || currentUser?.uid || '',
    userName: draft.userName || currentUser?.displayName || currentUser?.email || '',
    photoCount: photos.length,
    photos,
    createdAt: draft.createdAtIso || new Date().toISOString(),
    createdBy: actor,
    statusHistory: [{
      status: statusKey,
      subStatus,
      note: '',
      dateTime: statusDateTime,
      by: actor.name || draft.userName || '',
      workflowId
    }],
    ...(statusKey === 'resolved'
      ? {
          workflowState: 'finished',
          workflowStateByEntry: { [workflowId]: 'finished' },
          workflowStateByEntryHistory: { [workflowId]: { finished: { by: actor, at: draft.createdAtIso || new Date().toISOString() } } },
          workflowStateHistory: { finished: { by: actor, at: draft.createdAtIso || new Date().toISOString() } }
        }
      : { workflowStateByEntry: { [workflowId]: null } }),
    ...(draft.isUrgent ? { highPriority: true, priority: 'critical' } : {}),
    schemaVersion: 2,
    plantId: draft.plantId || currentPlantId,
    pressId: draft.pressId || toPressId(draft.machine || ''),
    rowId: draft.rowId || toRowId(findRowNameForMachine(draft.machine || '')),
    currentStatus: {
      statusKey,
      subStatusKey: subStatus,
      label: getStatusDef(statusKey)?.label || statusKey || 'Open',
      subLabel: subStatus,
      color: getStatusColor(statusKey),
      enteredAt: draft.createdAtIso || new Date().toISOString(),
      enteredDateTime: statusDateTime,
      enteredBy: actor,
      notePreview: draft.note || ''
    },
    lifecycle: { isOpen: statusKey !== 'resolved', isResolved: statusKey === 'resolved', openedAt: draft.createdAtIso || new Date().toISOString() },
    updatedAt: draft.createdAtIso || new Date().toISOString(),
    updatedBy: actor
  };
}

function buildServerIssuePayloadFromDraft(issueId, draft, uploadedPhotos = []) {
  const statusKey = draft.initialStatus || 'open';
  const subStatus = draft.initialSubStatus || '';
  const workflowId = draft.initialWorkflowId || createWorkflowId(statusKey);
  const actor = draft.actor || currentActor();
  return {
    machine: draft.machine || '',
    note: draft.note || 'No Description Provided',
    dateTime: draft.dateTime,
    dateKey: draft.dateKey,
    timestamp: Number(draft.timestamp || Date.now()),
    shift: draft.shift || '',
    timer: draft.timer || null,
    userId: draft.userId || currentUser?.uid || '',
    userName: draft.userName || currentUser?.displayName || currentUser?.email || '',
    photoCount: uploadedPhotos.length,
    createdAt: serverTimestamp(),
    createdBy: actor,
    statusHistory: [{
      status: statusKey,
      subStatus,
      note: '',
      dateTime: draft.statusDateTime || draft.dateTime,
      by: actor.name || draft.userName || '',
      workflowId
    }],
    ...(statusKey === 'resolved'
      ? {
          workflowState: 'finished',
          workflowStateByEntry: { [workflowId]: 'finished' },
          workflowStateByEntryHistory: { [workflowId]: { finished: { by: actor, at: serverTimestamp() } } },
          workflowStateHistory: { finished: { by: actor, at: serverTimestamp() } }
        }
      : { workflowStateByEntry: { [workflowId]: null } }),
    ...(draft.isUrgent ? { highPriority: true, priority: 'critical' } : {}),
    ...buildIssueV2Compat({
      machineCode: draft.machine || '',
      statusKey,
      subStatus,
      statusDateTime: draft.statusDateTime || draft.dateTime,
      note: draft.note || 'No Description Provided'
    }),
    plantId: draft.plantId || currentPlantId,
    pressId: draft.pressId || toPressId(draft.machine || ''),
    rowId: draft.rowId || toRowId(findRowNameForMachine(draft.machine || ''))
  };
}

function queuePlantIssueEvent(batch, plantId, issueId, type, payload = {}) {
  const evtRef = doc(collection(db, 'plants', plantId, 'issues', issueId, 'events'));
  batch.set(evtRef, {
    type,
    eventAt: serverTimestamp(),
    actor: currentActor(),
    payload,
    schemaVersion: 2
  });
}

function queuePlantAttachmentDocs(batch, plantId, issueId, photos = []) {
  photos.forEach((p, idx) => {
    if (!p?.storagePath) return;
    const attachmentId = `photo_${String(idx).padStart(3, '0')}_${String(p.storagePath).split('/').pop().replace(/[^a-zA-Z0-9]+/g, '_')}`;
    batch.set(doc(db, 'plants', plantId, 'issues', issueId, 'attachments', attachmentId), {
      type: 'photo',
      name: p.name || attachmentId,
      storagePath: p.storagePath,
      storageBucket: p.storageBucket || '',
      downloadURL: p.downloadURL || p.dataUrl || '',
      contentType: p.contentType || '',
      sizeBytes: Number(p.sizeBytes || 0),
      uploadedAt: serverTimestamp(),
      uploadedBy: currentActor(),
      schemaVersion: 2
    }, { merge: true });
  });
}

async function hydrateLocalIssueOutboxForCurrentPlant() {
  if (!currentPlantId) return;
  try {
    const items = await loadLocalIssueOutboxItems();
    let changed = false;
    items.filter(item => item.plantId === currentPlantId).forEach(item => {
      if (!issuesById.has(item.id)) {
        issuesById.set(item.id, localIssueForOutboxItem(item));
        changed = true;
      }
    });
    if (changed) {
      rebuildIssuesArrayFromMap();
      refreshVisibleData();
    }
    const pendingCount = items.filter(item => item.plantId === currentPlantId && item.status !== 'failed').length;
    if (pendingCount > 0) setSyncStatus('syncing', `Syncing - ${pendingCount} local issue${pendingCount === 1 ? '' : 's'} pending`);
  } catch (e) {
    console.warn('Could not hydrate local issue outbox', e);
  }
}

function removeSyncedOutboxItemsFromSnapshot(snap) {
  if (!snap?.docs?.length) return;
  snap.docs.forEach(d => {
    const issue = issuesById.get(d.id);
    if (issue?.__localPending || issue?.__localSyncStatus) {
      deleteLocalIssueOutboxItem(d.id).catch(e => console.warn('Could not clear synced local issue', e));
    }
  });
}

async function flushOneIssueOutboxItem(item) {
  const syncingItem = { ...item, status: 'syncing', error: '', updatedAt: new Date().toISOString() };
  await saveLocalIssueOutboxItem(syncingItem);
  if (currentPlantId === item.plantId) {
    issuesById.set(item.id, localIssueForOutboxItem(syncingItem));
    rebuildIssuesArrayFromMap();
    refreshVisibleData();
  }

  const uploadedPhotos = await withTimeout(
    uploadIssuePhotosToStorage(item.id, item.localPhotos || [], item.plantId),
    20000,
    'Offline issue photo upload'
  );
  const issuePayload = buildServerIssuePayloadFromDraft(item.id, item.draft || {}, uploadedPhotos);
  const batch = writeBatch(db);
  batch.set(doc(db, 'plants', item.plantId, 'issues', item.id), issuePayload);
  queuePlantAttachmentDocs(batch, item.plantId, item.id, uploadedPhotos);
  (item.events || []).forEach(evt => queuePlantIssueEvent(batch, item.plantId, item.id, evt.type, evt.payload || {}));
  await withTimeout(batch.commit(), 15000, 'Offline issue Firestore sync');

  await deleteLocalIssueOutboxItem(item.id);
  attachmentPhotoCache.set(item.id, uploadedPhotos);
  if (currentPlantId === item.plantId) {
    issuesById.set(item.id, {
      ...issuePayload,
      id: item.id,
      photos: uploadedPhotos,
      __localPending: false,
      __localSyncStatus: ''
    });
    rebuildIssuesArrayFromMap();
    refreshVisibleData();
  }

  if (currentPlantId === item.plantId) {
    queueRoleFeedAlert({ id: item.id, machine: item.machine }, item.roleAlert || {}).catch(e => console.warn('role alert queue failed', e));
    awardGamification('issue_created_complete', { issueId: item.id, dedupeSuffix: 'issue-created', tags: ['issue:create', `status:${item.initialStatus || 'open'}`] }).catch(e => console.warn('gamification issue-created award failed', e));
    if (uploadedPhotos.length > 0) awardGamification('photo_attached', { issueId: item.id, dedupeSuffix: 'photo', tags: ['photo:attached'] }).catch(e => console.warn('gamification photo award failed', e));
  }
}

async function flushIssueOutbox() {
  if (DEMO_MODE || NO_AUTH_MODE || !currentUser?.uid || !syncState.online) return;
  if (issueOutboxFlushPromise) return issueOutboxFlushPromise;
  issueOutboxFlushPromise = (async () => {
    const items = (await loadLocalIssueOutboxItems())
      .filter(item => item.userId === currentUser.uid && item.status !== 'failed')
      .sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0));
    if (!items.length) return;
    setSyncStatus('syncing', `Syncing - ${items.length} local issue${items.length === 1 ? '' : 's'} pending`);
    for (const item of items) {
      try {
        await flushOneIssueOutboxItem(item);
      } catch (e) {
        const permissionDenied = e?.code === 'permission-denied';
        const failedItem = {
          ...item,
          status: permissionDenied ? 'failed' : 'pending',
          error: e?.message || 'Sync failed. Will retry.',
          updatedAt: new Date().toISOString()
        };
        await saveLocalIssueOutboxItem(failedItem).catch(err => console.warn('Could not update local issue failure', err));
        if (currentPlantId === item.plantId) {
          issuesById.set(item.id, localIssueForOutboxItem(failedItem));
          rebuildIssuesArrayFromMap();
          refreshVisibleData();
        }
        if (permissionDenied) setSyncStatus('err', 'Local issue sync failed: access denied.');
        else setSyncStatus('syncing', 'Syncing - local issue will retry');
        if (isOfflineLikeError(e)) break;
      }
    }
  })().finally(() => { issueOutboxFlushPromise = null; });
  return issueOutboxFlushPromise;
}

function scheduleIssueOutboxFlush() {
  setTimeout(() => {
    flushIssueOutbox().catch(e => console.warn('issue outbox flush failed', e));
  }, 0);
}

async function postJsonWithAuth(url, payload = {}, options = {}) {
  const idToken = await apiSessionClient.getAccessToken();
  if (!idToken) throw new Error('Sign in is required.');
  const extraHeaders = options && typeof options.headers === 'object' ? options.headers : {};
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
      ...extraHeaders
    },
    body: JSON.stringify(payload)
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

async function initFcmMessaging() {
  if (NO_AUTH_MODE || DEMO_MODE) return null;
  if (!FCM_VAPID_KEY) return null;
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return null;
  const supported = await isMessagingSupported().catch(() => false);
  if (!supported) return null;
  if (!fcmRegistration) {
    fcmRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  }
  if (!fcmMessaging) {
    fcmMessaging = getMessaging(app);
    onMessage(fcmMessaging, payload => {
      const title = payload?.notification?.title || payload?.data?.title || 'AP Tracker';
      const body = payload?.notification?.body || payload?.data?.body || '';
      showGameToast(`🔔 ${title}${body ? `: ${body}` : ''}`);
    });
  }
  return fcmMessaging;
}

function fcmTokenDocId(token) {
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
  return `web_${Math.abs(hash).toString(36)}_${token.slice(-12).replace(/[^A-Za-z0-9_-]/g, '')}`;
}

async function registerFcmToken({ requestPermission = false } = {}) {
  if (NO_AUTH_MODE || DEMO_MODE || !currentUser?.uid) return null;
  if (!FCM_VAPID_KEY) {
    if (requestPermission) throw new Error('FCM is not configured. Add your Web Push VAPID key to fcm-config.js.');
    return null;
  }
  if (!('Notification' in window)) {
    if (requestPermission) throw new Error('Notifications are not supported in this browser.');
    return null;
  }
  if (requestPermission && Notification.permission !== 'granted') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') throw new Error('Notification permission was not granted.');
  }
  if (Notification.permission !== 'granted') return null;

  const messaging = await initFcmMessaging();
  if (!messaging) {
    if (requestPermission) throw new Error('Firebase Cloud Messaging is not supported in this browser.');
    return null;
  }
  const token = await getToken(messaging, {
    vapidKey: FCM_VAPID_KEY,
    serviceWorkerRegistration: fcmRegistration
  });
  if (!token) throw new Error('No FCM registration token was returned.');

  const tokenId = fcmTokenDocId(token);
  if (shouldUseSqlBootstrap()) {
    await dataApi.registerPushToken({
      token,
      tokenId,
      provider: 'fcm',
      platform: 'web',
      userAgent: navigator.userAgent || '',
      notificationPermission: Notification.permission,
      plantIds: userPlants.map(p => p.id).filter(Boolean),
      currentPlantId: currentPlantId || null
    });
  } else {
    await setDoc(doc(db, 'users', currentUser.uid, 'fcmTokens', tokenId), {
      token,
      tokenId,
      provider: 'fcm',
      platform: 'web',
      userAgent: navigator.userAgent || '',
      notificationPermission: Notification.permission,
      plantIds: userPlants.map(p => p.id).filter(Boolean),
      currentPlantId: currentPlantId || null,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    }, { merge: true });
  }
  return token;
}

function scheduleFcmTokenRegistration() {
  if (fcmTokenRegistrationPromise || !currentUser?.uid) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  fcmTokenRegistrationPromise = registerFcmToken()
    .catch(err => console.warn('FCM token registration failed', err))
    .finally(() => { fcmTokenRegistrationPromise = null; });
}

async function sendRoleAlertPush(alertId) {
  if (!alertId || DEMO_MODE || NO_AUTH_MODE) return;
  try {
    await postJsonWithAuth('/api/fcm/role-alert', { plantId: currentPlantId, alertId }, {
      headers: shouldUseSqlStagingReads(currentPlantId)
        ? { 'x-ap-data-backend': 'sql' }
        : {}
    });
  } catch (e) {
    console.warn('Role alert push failed', e);
  }
}

async function sendConversationPush(conversationId, messageId) {
  if (!conversationId || !messageId || DEMO_MODE || NO_AUTH_MODE) return;
  try {
    await postJsonWithAuth('/api/fcm/conversation-message', { plantId: currentPlantId, conversationId, messageId }, {
      headers: shouldUseSqlStagingReads(currentPlantId)
        ? { 'x-ap-data-backend': 'sql' }
        : {}
    });
  } catch (e) {
    console.warn('Conversation push failed', e);
  }
}

const WORKFLOW_STATES = ['called', 'accepted', 'in-progress', 'finished'];

function createWorkflowId(statusKey = 'status') {
  const cleanStatus = String(statusKey || 'status').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'status';
  const rand = Math.random().toString(36).slice(2, 8);
  return `wf_${cleanStatus}_${Date.now().toString(36)}_${rand}`;
}

function normalizeWorkflowId(workflowId) {
  const id = String(workflowId || '').trim();
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : '';
}

function getEntryWorkflowId(entry) {
  return normalizeWorkflowId(entry?.workflowId || entry?.workflowKey || '');
}

function getWorkflowStateForEntry(issue, entry, isCurrent = false) {
  const workflowId = getEntryWorkflowId(entry);
  if (workflowId && issue?.workflowStateByEntry && Object.prototype.hasOwnProperty.call(issue.workflowStateByEntry, workflowId)) {
    return issue.workflowStateByEntry[workflowId] || null;
  }
  const statusKey = String(entry?.status || '').trim().toLowerCase();
  if (isCurrent && issue?.workflowState) return issue.workflowState || null;
  if (statusKey && issue?.workflowStateByStatus && Object.prototype.hasOwnProperty.call(issue.workflowStateByStatus, statusKey)) {
    return issue.workflowStateByStatus[statusKey] || null;
  }
  return null;
}

function getWorkflowActorForEntry(issue, entry, state, isCurrent = false) {
  if (!state) return null;
  const workflowId = getEntryWorkflowId(entry);
  const entryActor = workflowId && issue?.workflowStateByEntryHistory?.[workflowId]?.[state]?.by;
  if (entryActor) return entryActor;
  if (isCurrent && issue?.workflowStateHistory?.[state]?.by) return issue.workflowStateHistory[state].by;
  const statusKey = String(entry?.status || '').trim().toLowerCase();
  return statusKey ? issue?.workflowStateByStatusHistory?.[statusKey]?.[state]?.by || null : null;
}

function isCurrentWorkflowEntry(entryIndex, historyLength, entry, issue) {
  return entryIndex === historyLength - 1 && String(entry?.status || '') === String(currentStatusKey(issue || {}) || '');
}
const onSnapshot = (...args) => {
  let seenFirstServerSnapshot = false;
  const wrapSnapshotHandler = (original) => (snapshot) => {
    const isFromCache = Boolean(snapshot?.metadata?.fromCache);
    if (!isFromCache) {
      if (typeof snapshot?.docChanges === 'function') {
        if (!seenFirstServerSnapshot) {
          trackFirestoreRead(snapshot?.size ?? 0);
          seenFirstServerSnapshot = true;
        } else {
          const incrementalReads = snapshot.docChanges().reduce((sum, change) => {
            if (change?.type === 'added' || change?.type === 'modified') return sum + 1;
            return sum;
          }, 0);
          trackFirestoreRead(incrementalReads);
        }
      } else {
        trackFirestoreRead(1);
      }
    }
    return original(snapshot);
  };

  if (typeof args[1] === 'function') {
    args[1] = wrapSnapshotHandler(args[1]);
  } else if (typeof args[2] === 'function') {
    args[2] = wrapSnapshotHandler(args[2]);
  }
  return rawOnSnapshot(...args);
};
refreshAppVersionIndicator();

// ── MULTI-PLANT ──
let currentPlantId = null;
let currentPlantName = '';
let userPlants = []; // [{ id, name, location }]
let availablePlantsForOnboarding = [];
let currentUserProfileData = {};
const scheduleLookupCache = new Map();
const USER_LOOKUP_HEARTBEAT_MS = 12 * 60 * 60 * 1000;
const PROFILE_ONBOARDING_VERSION = 1;
// Firestore read optimization:
// Keep the real-time listener window tight, and load older issues on demand.
const MAX_LIVE_ISSUES = 100;
const HISTORY_ISSUES_PAGE_SIZE = 100;
let dailyScheduleIndexState = null; // { plantId, date, scheduled: Set<string>|null, lookupByPress: Map<string, { main: any[], changes: any[] }> }
// Caches the set of scheduled machine codes for the current plant/date.
// { plantId: string, date: string, scheduled: Set<string> | null }
// scheduled === null means no dailySchedules doc exists for that date → don't highlight.
let scheduledPressesState = null;

// ── ROLE / PERMISSIONS ──
const DEFAULT_PERMISSIONS = {
  canViewPlant: true, canCreateIssue: true, canEditIssue: true,
  canResolveIssue: true, canManageStatuses: true, canManagePresses: true, canExport: true
};
const DEMO_PERMISSIONS = {
  ...DEFAULT_PERMISSIONS,
  canManageStatuses: false,
  canManagePresses: false
};
let currentUserRole = 'admin'; // default until member doc loads
let currentUserPermissions = { ...DEFAULT_PERMISSIONS };

function normalizeMemberRole(roleValue) {
  const normalized = String(roleValue || '').trim().toLowerCase();
  if (normalized === 'admin' || normalized === 'editor' || normalized === 'viewer') return normalized;
  return '';
}

// ── ROLE-BASED ALERT FEEDS ──
// Configurable routing rules can be stored at:
// plants/{plantId}/config/roleAlertRouting
// {
//   rules: [{ statusKey, statusLabelIncludes, subStatusIncludes, feedKey, feedLabel, jobRoleKeys: [] }],
//   updatedAt
// }
const ROLE_ALERT_ROUTING_RULES_DEFAULT = [
  { statusLabelIncludes: 'need', subStatusIncludes: 'material', feedKey: 'material_alerts', feedLabel: 'Material Alerts', jobRoleKeys: ['forklift_driver'] },
  { statusKey: 'maintenance', feedKey: 'maintenance_alerts', feedLabel: 'Maintenance Alerts', jobRoleKeys: ['maintenance_employee', 'main_maintenance_role', 'maintenance'] }
];

const _roleAlertRulesCache = { plantId: null, fetchedAt: 0, rules: null };
const ROLE_ALERT_RULES_CACHE_MS = 60 * 1000;
let SUBCATEGORY_ROUTES = {};
let _rolePrefsDraft = [];
let _roleFeedAlertsUnsubscribe = null;
const _seenRoleFeedAlerts = new Set();
let _unreadRoleAlertCount = 0;
let _activeRoleAlertCount = 0;
let _roleAlertsShowAccepted = false;
let _roleAlertsCache = [];
let _roleAlertBadgeRefreshTimer = null;
let _roleAlertsPollTimer = null;
let _roleAlertsLoadToken = 0;
let _roleAlertFocusIssueId = '';
const ROLE_KEY_ALIASES = {
  maintenance_employee: ['maintenance_employee', 'main_maintenance_role', 'maintenance'],
  main_maintenance_role: ['maintenance_employee', 'main_maintenance_role', 'maintenance'],
  maintenance: ['maintenance_employee', 'main_maintenance_role', 'maintenance'],
  forklift_driver: ['forklift_driver', 'forklift', 'materials_handler']
};

function _expandRoleAliases(roleKeys) {
  const out = new Set();
  (Array.isArray(roleKeys) ? roleKeys : []).forEach(raw => {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) return;
    (ROLE_KEY_ALIASES[key] || [key]).forEach(v => out.add(v));
  });
  return Array.from(out);
}

async function loadPlantMembersForAlerts() {
  if (!currentPlantId) return [];
  if (shouldUseSqlStagingReads(currentPlantId)) {
    const payload = await requireSqlRead(
      `plant members ${currentPlantId}`,
      () => dataApi.listPlantMembers(currentPlantId, { active: true }),
      `Plant members are missing in D1 for plant ${currentPlantId}.`
    );
    if (!Array.isArray(payload?.members)) {
      throw new Error(`Plant members are missing in D1 for plant ${currentPlantId}.`);
    }
    return payload.members;
  }
  const membersSnap = await getDocs(collection(db, 'plants', currentPlantId, 'members'));
  return membersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function _normalizeRoleAlertRules(inputRules) {
  if (!Array.isArray(inputRules)) return [];
  return inputRules
    .map(rule => ({
      statusKey: String(rule?.statusKey || '').trim().toLowerCase(),
      statusLabelIncludes: String(rule?.statusLabelIncludes || '').trim().toLowerCase(),
      subStatusIncludes: String(rule?.subStatusIncludes || '').trim().toLowerCase(),
      feedKey: String(rule?.feedKey || '').trim().toLowerCase(),
      feedLabel: String(rule?.feedLabel || '').trim(),
      jobRoleKeys: Array.isArray(rule?.jobRoleKeys)
        ? Array.from(new Set(rule.jobRoleKeys.map(v => String(v || '').trim().toLowerCase()).filter(Boolean)))
        : []
    }))
    .filter(rule => rule.feedKey && rule.feedLabel && rule.jobRoleKeys.length > 0);
}

function normalizeSubcategoryRoutes(rawRoutes, statuses = STATUSES) {
  return normalizeSharedSubcategoryRoutes(rawRoutes, statuses, {
    lowercaseRouteKeys: true,
    lowercaseBoundStatusKeys: true,
    sortRoutes: false
  });
}

function syncStatusesFromSubcategoryRoutes(statuses, routes) {
  return syncSharedStatusesFromSubcategoryRoutes(statuses, routes);
}

function resolveConfiguredSubcategoryRoute(subStatus) {
  const sub = String(subStatus || '').trim().toLowerCase();
  if (!sub) return null;
  const found = Object.entries(SUBCATEGORY_ROUTES || {}).find(([, route]) =>
    route?.isActive !== false
    && Array.isArray(route.boundStatusKeys)
    && route.boundStatusKeys.length > 0
    && String(route.label || '').trim().toLowerCase() === sub
  );
  if (!found) return null;
  const [routeKey, route] = found;
  return {
    feedKey: `subcategory_${routeKey}_alerts`,
    feedLabel: `${route.label} Alerts`,
    categoryKeys: route.boundStatusKeys,
    jobRoleKeys: route.boundStatusKeys
  };
}

async function getRoleAlertRoutingRules() {
  if (!currentPlantId) return ROLE_ALERT_ROUTING_RULES_DEFAULT;
  const now = Date.now();
  if (_roleAlertRulesCache.plantId === currentPlantId
    && _roleAlertRulesCache.rules
    && (now - _roleAlertRulesCache.fetchedAt) < ROLE_ALERT_RULES_CACHE_MS) {
    return _roleAlertRulesCache.rules;
  }
  if (shouldUseSqlStagingReads(currentPlantId)) {
    const sqlBootstrap = await ensureSqlPlantBootstrap(currentPlantId);
    const bootstrapRules = _normalizeRoleAlertRules(sqlBootstrap?.roleAlertRouting?.rules || null);
    if (bootstrapRules.length === 0) {
      const payload = await requireSqlRead(
        `role alert routing ${currentPlantId}`,
        () => dataApi.getRoleAlertRouting(currentPlantId),
        `Role alert routing is missing in D1 for plant ${currentPlantId}.`
      );
      const sqlRules = _normalizeRoleAlertRules(payload?.roleAlertRouting?.rules || null);
      if (sqlRules.length === 0) {
        throw new Error(`Role alert routing is missing in D1 for plant ${currentPlantId}.`);
      }
      _roleAlertRulesCache.plantId = currentPlantId;
      _roleAlertRulesCache.fetchedAt = now;
      _roleAlertRulesCache.rules = sqlRules;
      return sqlRules;
    }
    _roleAlertRulesCache.plantId = currentPlantId;
    _roleAlertRulesCache.fetchedAt = now;
    _roleAlertRulesCache.rules = bootstrapRules;
    return bootstrapRules;
  }
  try {
    const snap = await getDoc(doc(db, 'plants', currentPlantId, 'config', 'roleAlertRouting'));
    const dbRules = _normalizeRoleAlertRules(snap.exists() ? snap.data()?.rules : null);
    const rules = dbRules.length > 0 ? dbRules : _normalizeRoleAlertRules(ROLE_ALERT_ROUTING_RULES_DEFAULT);
    _roleAlertRulesCache.plantId = currentPlantId;
    _roleAlertRulesCache.fetchedAt = now;
    _roleAlertRulesCache.rules = rules;
    return rules;
  } catch (_) {
    return _normalizeRoleAlertRules(ROLE_ALERT_ROUTING_RULES_DEFAULT);
  }
}

async function resolveRoleAlertRoute(statusKey, subStatus) {
  const subcategoryRoute = resolveConfiguredSubcategoryRoute(subStatus);
  if (subcategoryRoute) return subcategoryRoute;

  const statusDef = getStatusDef(statusKey);
  const key = String(statusKey || '').trim().toLowerCase();
  const label = String(statusDef?.label || '').trim().toLowerCase();
  const sub = String(subStatus || '').trim().toLowerCase();
  const rules = await getRoleAlertRoutingRules();
  return rules.find(rule => {
    const keyMatch = !rule.statusKey || rule.statusKey === key;
    const labelMatch = !rule.statusLabelIncludes || label.includes(rule.statusLabelIncludes);
    const subMatch = !rule.subStatusIncludes || sub.includes(rule.subStatusIncludes);
    return keyMatch && labelMatch && subMatch;
  }) || null;
}

async function queueRoleFeedAlert(issue, { statusKey, subStatus, note = '', workflowId = '' } = {}) {
  if (DEMO_MODE) return;
  if (!currentPlantId || !issue?.id || !statusKey) return;
  const normalizedStatus = String(statusKey || '').trim().toLowerCase();
  if (!normalizedStatus || normalizedStatus === 'open' || normalizedStatus === 'resolved') return;
  const route = await resolveRoleAlertRoute(statusKey, subStatus);
  const statusDef = getStatusDef(statusKey);
  const effectiveRoute = route || {
    feedKey: `${String(statusKey || '').trim().toLowerCase()}_alerts`,
    feedLabel: `${String(statusDef?.label || statusKey || 'General').trim()} Alerts`,
    categoryKeys: [String(statusKey || '').trim().toLowerCase()],
    jobRoleKeys: []
  };
  try {
    const members = await loadPlantMembersForAlerts();
    const roleKeys = _expandRoleAliases(Array.isArray(effectiveRoute.jobRoleKeys) ? effectiveRoute.jobRoleKeys : []);
    const categoryKey = String(statusKey || '').trim().toLowerCase();
    const categoryKeys = Array.isArray(effectiveRoute.categoryKeys) && effectiveRoute.categoryKeys.length
      ? Array.from(new Set(effectiveRoute.categoryKeys.map(v => String(v || '').trim().toLowerCase()).filter(Boolean)))
      : [categoryKey];
    const recipientUserIds = members
      .filter(m => m?.isActive !== false)
      .filter(m => {
        const hasExplicitSubscriptions = Object.prototype.hasOwnProperty.call(m || {}, 'alertCategorySubscriptions');
        const categorySubs = Array.isArray(m.alertCategorySubscriptions)
          ? m.alertCategorySubscriptions.map(v => String(v || '').trim().toLowerCase()).filter(Boolean)
          : [];
        if (hasExplicitSubscriptions) {
          return categoryKeys.some(key => categorySubs.includes(key));
        }
        const normalizedRoleKeys = [
          ...(Array.isArray(m.jobRoleKeys) ? m.jobRoleKeys : []),
          ...(Array.isArray(m.jobFeeds) ? m.jobFeeds : [])
        ].map(key => String(key || '').trim().toLowerCase()).filter(Boolean);
        const memberKeys = _expandRoleAliases(normalizedRoleKeys);
        return memberKeys.some(key => roleKeys.includes(key));
      })
      .map(m => m.id || m.uid);
    let createdAlertId = '';
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const payload = await dataApi.createRoleAlert(currentPlantId, {
        issueId: issue.id,
        machine: issue.machine || issue.machineCode || '',
        statusKey,
        subStatus: subStatus || '',
        workflowId: normalizeWorkflowId(workflowId),
        note: note || '',
        feedKey: effectiveRoute.feedKey,
        feedLabel: effectiveRoute.feedLabel,
        categoryKey,
        categoryKeys,
        requiredJobRoleKeys: roleKeys,
        recipientUserIds,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: currentActor(),
        raw: {
          issueId: issue.id,
          machine: issue.machine || issue.machineCode || '',
          statusKey,
          subStatus: subStatus || '',
          workflowId: normalizeWorkflowId(workflowId),
          note: note || '',
          feedKey: effectiveRoute.feedKey,
          feedLabel: effectiveRoute.feedLabel,
          categoryKey,
          categoryKeys,
          requiredJobRoleKeys: roleKeys,
          recipientUserIds,
          createdBy: currentActor()
        }
      });
      createdAlertId = payload?.alert?.alertId || '';
    } else {
      const alertRef = await addDoc(collection(db, 'plants', currentPlantId, 'roleFeedAlerts'), {
        issueId: issue.id,
        machine: issue.machine || issue.machineCode || '',
        statusKey,
        subStatus: subStatus || '',
        workflowId: normalizeWorkflowId(workflowId),
        note: note || '',
        feedKey: effectiveRoute.feedKey,
        feedLabel: effectiveRoute.feedLabel,
        categoryKey,
        categoryKeys,
        requiredJobRoleKeys: roleKeys,
        recipientUserIds,
        createdAt: serverTimestamp(),
        createdBy: currentActor()
      });
      createdAlertId = alertRef.id;
    }
    if (currentUser?.uid && recipientUserIds.includes(currentUser.uid)) {
      showGameToast(`🔔 ${effectiveRoute.feedLabel}: Press ${issue.machine || 'Unknown'}`);
    }
    if (createdAlertId) void sendRoleAlertPush(createdAlertId);
  } catch (e) {
    console.warn('Role feed alert enqueue failed', e);
  }
}

function stopRoleFeedAlertsWatcher() {
  if (_roleFeedAlertsUnsubscribe) {
    _roleFeedAlertsUnsubscribe();
    _roleFeedAlertsUnsubscribe = null;
  }
  if (_roleAlertsPollTimer) {
    clearTimeout(_roleAlertsPollTimer);
    _roleAlertsPollTimer = null;
  }
  _setActiveRoleAlertCount(0);
}

function _updateRoleAlertBadge() {
  document.querySelectorAll('[data-role-alert-badge]').forEach(badge => {
    badge.textContent = String(_activeRoleAlertCount);
    badge.style.display = _activeRoleAlertCount > 0 ? 'inline-flex' : 'none';
  });
}

function _updateRoleAlertIndicator() {
  const button = document.getElementById('alerts-btn-header');
  const hasActiveAlerts = _activeRoleAlertCount > 0;
  button?.classList.toggle('alerts-has-active', hasActiveAlerts);
}

function _setActiveRoleAlertCount(count) {
  _activeRoleAlertCount = Math.max(0, Number(count) || 0);
  _updateRoleAlertIndicator();
  _updateRoleAlertBadge();
}

function _getRoleAlertWorkflowState(issue, statusKey, workflowId = '') {
  if (!issue) return null;
  const normalizedWorkflowId = normalizeWorkflowId(workflowId);
  if (normalizedWorkflowId && issue.workflowStateByEntry && Object.prototype.hasOwnProperty.call(issue.workflowStateByEntry, normalizedWorkflowId)) {
    return issue.workflowStateByEntry[normalizedWorkflowId] || null;
  }
  const normalizedStatusKey = String(statusKey || '').trim().toLowerCase();
  const primaryKey = currentStatusKey(issue);
  if (normalizedStatusKey && normalizedStatusKey === primaryKey) {
    return issue.workflowState || null;
  }
  if (normalizedStatusKey && issue.workflowStateByStatus && Object.prototype.hasOwnProperty.call(issue.workflowStateByStatus, normalizedStatusKey)) {
    return issue.workflowStateByStatus[normalizedStatusKey] || null;
  }
  if (!normalizedStatusKey && primaryKey) {
    return issue.workflowState || null;
  }
  return issue.workflowStateByStatus?.[normalizedStatusKey] || null;
}

function _updateRoleAlertModalToggleUI() {
  const hideBtn = document.getElementById('role-alerts-hide-accepted-btn');
  const showBtn = document.getElementById('role-alerts-show-accepted-btn');
  if (hideBtn) hideBtn.classList.toggle('active', !_roleAlertsShowAccepted);
  if (showBtn) showBtn.classList.toggle('active', !!_roleAlertsShowAccepted);
}

function _updateRoleAlertModalFooter(activeCount, acceptedCount) {
  const footer = document.getElementById('role-alerts-footer');
  if (!footer) return;
  const acceptedLabel = _roleAlertsShowAccepted ? 'shown' : 'hidden';
  footer.textContent = `${activeCount} active · ${acceptedCount} accepted ${acceptedLabel}`;
}

function _setRoleAlertsModalVisible(isVisible) {
  const modal = document.getElementById('role-alerts-modal');
  if (!modal) return;
  modal.classList.toggle('visible', !!isVisible);
  modal.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
  document.body.classList.toggle('role-alerts-open', !!isVisible);
}

function _renderRoleAlertCard(alert) {
  const isResolved = !!alert.isResolved;
  const isAccepted = !!alert.isAccepted;
  const statusKey = alert.statusKey || alert.categoryKey || 'open';
  const statusColor = isResolved ? '#64748b' : (isAccepted ? '#22c55e' : getStatusColor(statusKey));
  const statusDef = isResolved ? { icon: '✅' } : getStatusDef(statusKey);
  const statusLabel = isResolved ? 'Resolved' : getStatusLabel(statusKey, 'short');
  const acceptedByName = (isResolved || isAccepted) ? formatWorkflowActorName(alert.acceptedBy?.name || alert.acceptedBy || '') : '';
  const noteText = alert.note || 'No note';
  return `
    <div class="role-alert-card${(isAccepted || isResolved) ? ' accepted' : ''}" style="--role-alert-cat-color:${statusColor};--role-alert-card-border:${alphaColor(statusColor, 0.35)};">
      <button class="role-alert-card-body" type="button" data-role-alert-action="focus" data-role-alert-issue-id="${esc(alert.issueId)}" aria-label="Open issue ${esc(alert.machine || 'alert')}">
        <div class="role-alert-card-shell">
          <div class="role-alert-card-header">
            <div class="role-alert-card-top">
              <div class="issue-machine-tag role-alert-machine-tag">${alert.machine ? esc(alert.machine) : 'Press not set'}</div>
              <div class="issue-meta role-alert-meta">
                <div class="issue-note-preview role-alert-card-sub">${alert.subStatus ? esc(alert.subStatus) : 'New alert'}</div>
              </div>
              <span class="role-alert-card-chip role-alert-card-chip-state" style="--role-alert-cat-color:${statusColor};">${esc(statusDef.icon || '🔔')} ${esc(statusLabel)}</span>
              <div class="issue-expand-icon role-alert-card-arrow" aria-hidden="true">›</div>
            </div>
            <div class="issue-time role-alert-card-time">
              <span>${esc(alert.plantName || currentPlantName || 'Plant')}</span>
              <span>${esc(alert.createdAtLabel || 'Time unknown')}</span>
              ${isResolved
                ? `<span>${acceptedByName ? `Resolved by ${esc(acceptedByName)}` : 'Resolved'}</span>`
                : (isAccepted
                  ? `<span>${acceptedByName ? `Accepted by ${esc(acceptedByName)}` : 'Accepted'}</span>`
                  : '<span>Needs response</span>')}
            </div>
          </div>
          <div class="role-alert-card-note">${esc(noteText)}</div>
        </div>
      </button>
      <div class="role-alert-card-actions">
        <button class="role-alert-action-btn role-alert-action-accept" type="button" data-role-alert-action="accept" data-role-alert-issue-id="${esc(alert.issueId)}" data-role-alert-status-key="${esc(alert.statusKey)}" data-role-alert-workflow-id="${esc(alert.workflowId || '')}" ${isResolved ? 'disabled' : ''}>${isResolved ? 'Resolved' : (isAccepted ? 'Accepted' : 'Accept')}</button>
        <button class="role-alert-action-btn role-alert-action-delete" type="button" data-role-alert-action="delete" data-role-alert-id="${esc(alert.id)}" data-role-alert-category-key="${esc(alert.categoryKey)}" data-role-alert-status-key="${esc(alert.statusKey)}">Delete</button>
      </div>
    </div>
  `;
}

function _renderRoleAlertsModal(alerts) {
  const list = document.getElementById('role-alerts-list');
  if (!list) return;
  const activeAlerts = alerts.filter(a => !a.isAccepted && !a.isResolved);
  const acceptedAlerts = alerts.filter(a => a.isAccepted || a.isResolved);
  _setActiveRoleAlertCount(activeAlerts.length);
  _updateRoleAlertModalToggleUI();
  _updateRoleAlertModalFooter(activeAlerts.length, acceptedAlerts.length);

  const renderSection = (title, rows, sectionClass) => `
    <div class="role-alert-section ${sectionClass || ''}">
      <div class="role-alert-section-header">
        <span>${title}</span>
        <span class="role-alert-section-count">${rows.length}</span>
      </div>
      <div class="role-alert-section-body">
        ${rows.map(_renderRoleAlertCard).join('')}
      </div>
    </div>
  `;

  if (!activeAlerts.length && (!_roleAlertsShowAccepted || !acceptedAlerts.length)) {
    const acceptedNote = acceptedAlerts.length ? `<div class="role-alert-empty-sub">Toggle on accepted alerts to review acknowledged items.</div>` : '';
    list.innerHTML = `
      <div class="role-alert-empty">
        <div class="role-alert-empty-icon" aria-hidden="true">🔔</div>
        <div class="role-alert-empty-copy">
          <div class="role-alert-empty-title">No active alerts right now.</div>
          ${acceptedNote}
        </div>
        <div class="role-alert-empty-hint">Alerts from your subscribed categories will appear here automatically.</div>
      </div>
    `;
    return;
  }

  const sections = [];
  if (activeAlerts.length) {
    sections.push(renderSection('Active', activeAlerts, 'active'));
  }
  if (_roleAlertsShowAccepted && acceptedAlerts.length) {
    sections.push(renderSection('Accepted', acceptedAlerts, 'accepted'));
  }
  list.innerHTML = sections.join('');
}

async function _refreshRoleAlertBadgeCount() {
  if (!currentPlantId || !currentUser?.uid) {
    _setActiveRoleAlertCount(0);
    return;
  }
  try {
    const alerts = await _loadActiveRoleAlertsForCurrentUser();
    _setActiveRoleAlertCount(alerts.filter(a => !a.isAccepted).length);
  } catch (e) {
    console.warn('roleFeedAlerts badge refresh failed', e);
  }
}

function _scheduleRoleAlertBadgeRefresh() {
  if (_roleAlertBadgeRefreshTimer) clearTimeout(_roleAlertBadgeRefreshTimer);
  _roleAlertBadgeRefreshTimer = setTimeout(() => {
    _roleAlertBadgeRefreshTimer = null;
    void _refreshRoleAlertBadgeCount();
  }, 250);
}

window.clearRoleAlertBadge = function() {
  _unreadRoleAlertCount = 0;
  _updateRoleAlertBadge();
};

async function _loadActiveRoleAlertsForCurrentUser() {
  if (!currentPlantId || !currentUser?.uid) return [];
  if (shouldUseSqlStagingReads(currentPlantId)) {
    const payload = await requireSqlRead(
      `role alerts ${currentPlantId}`,
      () => dataApi.listRoleAlerts(currentPlantId, { limit: 80 }),
      `Role alerts are missing in D1 for plant ${currentPlantId}.`
    );
    const sourceAlerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
    const alerts = [];
    for (const alert of sourceAlerts) {
      const issueId = String(alert.issueId || '').trim();
      if (!issueId) continue;
      const issue = issues.find(i => i.id === issueId) || null;
      const issueLifecycle = issue?.lifecycle || null;
      const isResolved = !!(alert.isResolved || (issue && (issue.resolved || issueLifecycle?.isResolved)));
      const alertStatusKey = alert.statusKey || currentStatusKey(issue || {}) || '';
      const alertWorkflowId = normalizeWorkflowId(alert.workflowId || '');
      const workflowState = isResolved
        ? 'resolved'
        : (_getRoleAlertWorkflowState(issue || null, alertStatusKey, alertWorkflowId) || null);
      const createdAt = toCompatTimestamp(alert.createdAt);
      const createdAtLabel = createdAt?.toDate
        ? createdAt.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '';
      const issueMachine = issue && (issue.machine || issue.machineCode) ? (issue.machine || issue.machineCode) : 'Unknown';
      const issueCurrentStatus = issue?.currentStatus || null;
      const issueSubStatus = issueCurrentStatus?.subStatusKey || '';
      const issueNote = issue?.note || '';
      const workflowAcceptedBy = workflowState === 'accepted'
        ? (
            (alertWorkflowId && issue?.workflowStateByEntryHistory?.[alertWorkflowId]?.accepted?.by) ||
            issue?.workflowStateHistory?.accepted?.by ||
            issue?.workflowStateByStatusHistory?.[alertStatusKey]?.accepted?.by ||
            null
          )
        : null;
      alerts.push({
        id: alert.alertId,
        issueId,
        machine: alert.raw?.machine || issueMachine,
        feedLabel: alert.feedLabel || alert.categoryKey || alert.statusKey || 'Alert',
        statusKey: alertStatusKey,
        workflowId: alertWorkflowId,
        subStatus: alert.raw?.subStatus || issueSubStatus,
        categoryKey: alert.categoryKey || alert.statusKey || '',
        note: alert.body || alert.raw?.note || issueNote,
        createdAt,
        createdAtLabel,
        plantName: currentPlantName || currentPlantId || '',
        workflowState,
        isResolved,
        isAccepted: isResolved || workflowState === 'accepted',
        acceptedBy: workflowAcceptedBy || (isResolved ? (issue && (issue.resolvedBy || issue.reopenedBy || issue.workflowStateHistory?.finished?.by || null)) : null),
        raw: alert.raw || { recipientUserIds: alert.recipientUserIds || [] }
      });
    }
    alerts.sort((a, b) => {
      const aMs = compatTimestampMillis(a.createdAt);
      const bMs = compatTimestampMillis(b.createdAt);
      return bMs - aMs;
    });
    return alerts;
  }
  const q = query(
    collection(db, 'plants', currentPlantId, 'roleFeedAlerts'),
    where('recipientUserIds', 'array-contains', currentUser.uid),
    limit(80)
  );
  const snap = await Promise.race([
    getDocs(q),
    new Promise(resolve => setTimeout(() => resolve(null), 2500))
  ]);
  if (!snap || !Array.isArray(snap.docs)) return [];
  const alerts = [];
  for (const d of snap.docs) {
    const data = d.data() || {};
    const issueId = String(data.issueId || '').trim();
    if (!issueId) continue;
    const issue = issues.find(i => i.id === issueId) || null;
    const issueLifecycle = issue && issue.lifecycle ? issue.lifecycle : null;
    const isResolved = !!(issue && (issue.resolved || (issueLifecycle && issueLifecycle.isResolved)));
    const alertStatusKey = data.statusKey || currentStatusKey(issue || {}) || '';
    const alertWorkflowId = normalizeWorkflowId(data.workflowId || '');
    const workflowState = isResolved
      ? 'resolved'
      : (_getRoleAlertWorkflowState(issue || null, alertStatusKey, alertWorkflowId) || data.workflowState || null);
    const issueMachine = issue && (issue.machine || issue.machineCode) ? (issue.machine || issue.machineCode) : 'Unknown';
    const issueCurrentStatus = issue && issue.currentStatus ? issue.currentStatus : null;
    const issueSubStatus = issueCurrentStatus && issueCurrentStatus.subStatusKey ? issueCurrentStatus.subStatusKey : '';
    const issueNote = issue && issue.note ? issue.note : '';
    const createdAt = data.createdAt || null;
    const createdAtLabel = createdAt && typeof createdAt.toDate === 'function'
      ? createdAt.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '';
    const workflowAcceptedBy = workflowState === 'accepted'
      ? (
          (alertWorkflowId && issue && issue.workflowStateByEntryHistory && issue.workflowStateByEntryHistory[alertWorkflowId] && issue.workflowStateByEntryHistory[alertWorkflowId].accepted && issue.workflowStateByEntryHistory[alertWorkflowId].accepted.by) ||
          (issue && issue.workflowStateHistory && issue.workflowStateHistory.accepted && issue.workflowStateHistory.accepted.by) ||
          (issue && issue.workflowStateByStatusHistory && issue.workflowStateByStatusHistory[alertStatusKey] && issue.workflowStateByStatusHistory[alertStatusKey].accepted && issue.workflowStateByStatusHistory[alertStatusKey].accepted.by) ||
          null
        )
      : null;
    alerts.push({
      id: d.id,
      issueId,
      machine: data.machine || issueMachine,
      feedLabel: data.feedLabel || data.categoryKey || data.statusKey || 'Alert',
      statusKey: alertStatusKey,
      workflowId: alertWorkflowId,
      subStatus: data.subStatus || issueSubStatus,
      categoryKey: data.categoryKey || data.statusKey || '',
      note: data.note || issueNote,
      createdAt,
      createdAtLabel,
      plantName: currentPlantName || currentPlantId || '',
      workflowState,
      isResolved,
      isAccepted: isResolved || workflowState === 'accepted',
      acceptedBy: workflowAcceptedBy || (isResolved ? (issue && (issue.resolvedBy || issue.reopenedBy || issue.workflowStateHistory?.finished?.by || null)) : null)
    });
  }
  alerts.sort((a, b) => {
    const aMs = compatTimestampMillis(a.createdAt);
    const bMs = compatTimestampMillis(b.createdAt);
    return bMs - aMs;
  });
  return alerts;
}

function _renderRoleAlertLoadFallback({ title, subtitle }) {
  return `
    <div class="role-alert-empty">
      <div class="role-alert-empty-icon" aria-hidden="true">⏳</div>
      <div class="role-alert-empty-copy">
        <div class="role-alert-empty-title">${esc(title)}</div>
        <div class="role-alert-empty-sub">${esc(subtitle)}</div>
        <div class="role-alert-empty-actions">
          <button class="btn btn-ghost" type="button" data-role-alert-action="close">Close</button>
        </div>
      </div>
    </div>
  `;
}

function _handleRoleAlertModalAction(action, issueId, statusKey, alertId, categoryKey, workflowId = '') {
  if (action === 'retry') {
    const retryBtn = document.querySelector('#role-alerts-modal .role-alerts-retry-fab');
    if (retryBtn) {
      retryBtn.classList.remove('spinning');
      void retryBtn.offsetWidth;
      retryBtn.classList.add('spinning');
      window.setTimeout(() => retryBtn.classList.remove('spinning'), 700);
    }
    void retryRoleAlertInboxModal();
    return;
  }
  if (action === 'hide-accepted') {
    void setRoleAlertsShowAccepted(false);
    return;
  }
  if (action === 'show-accepted') {
    void setRoleAlertsShowAccepted(true);
    return;
  }
  if (action === 'close') {
    closeRoleAlertInboxModal();
    return;
  }
  if (action === 'focus' && issueId) {
    focusIssueFromAlert(issueId);
    return;
  }
  if (action === 'accept' && issueId && statusKey) {
    void acceptRoleAlert(issueId, statusKey, workflowId);
    return;
  }
  if (action === 'delete' && alertId) {
    void deleteRoleAlert(alertId, categoryKey, statusKey);
  }
}

function _bindRoleAlertModalActions() {
  const modal = document.getElementById('role-alerts-modal');
  if (!modal || modal.dataset.roleAlertBound === '1') return;
  modal.dataset.roleAlertBound = '1';
  modal.addEventListener('click', event => {
    const target = event.target?.closest?.('[data-role-alert-action],[data-role-alert-issue-id]') || null;
    if (!target) return;
    const action = target.dataset.roleAlertAction || (target.dataset.roleAlertIssueId ? 'focus' : '');
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    _handleRoleAlertModalAction(
      action,
      target.dataset.roleAlertIssueId || '',
      target.dataset.roleAlertStatusKey || '',
      target.dataset.roleAlertId || '',
      target.dataset.roleAlertCategoryKey || '',
      target.dataset.roleAlertWorkflowId || ''
    );
  });
}

async function _openRoleAlertInboxModalInternal({ resetToggle = true } = {}) {
  const modal = document.getElementById('role-alerts-modal');
  const list = document.getElementById('role-alerts-list');
  if (!modal || !list) return;
  _bindToolModalShellNavigation();
  const loadToken = ++_roleAlertsLoadToken;
  _bindRoleAlertModalActions();
  _setRoleAlertsModalVisible(true);
  if (resetToggle) _roleAlertsShowAccepted = true;
  _updateRoleAlertModalToggleUI();
  const cachedAlerts = Array.isArray(_roleAlertsCache) ? _roleAlertsCache : [];
  if (cachedAlerts.length) {
    _renderRoleAlertsModal(cachedAlerts);
  } else {
    list.innerHTML = _renderRoleAlertLoadFallback({
      title: 'Checking for alerts…',
      subtitle: 'If this stalls, use the orange button in the top-right corner.'
    });
  }
  void (async () => {
    try {
      const alerts = await Promise.race([
        _loadActiveRoleAlertsForCurrentUser(),
        new Promise(resolve => setTimeout(() => resolve('__timeout__'), 2500))
      ]);
      if (loadToken !== _roleAlertsLoadToken) return;
      if (alerts === '__timeout__') {
        list.innerHTML = _renderRoleAlertLoadFallback({
          title: 'Alerts are taking too long to load.',
          subtitle: 'Use the orange button in the top-right corner to try again.'
        });
        return;
      }
      _roleAlertsCache = alerts;
      _renderRoleAlertsModal(alerts);
    } catch (e) {
      if (loadToken !== _roleAlertsLoadToken) return;
      list.innerHTML = _renderRoleAlertLoadFallback({
        title: 'Unable to load alerts.',
        subtitle: e?.message || 'Use the orange button in the top-right corner to try again.'
      });
      _setActiveRoleAlertCount(0);
      _updateRoleAlertModalFooter(0, 0);
    }
  })();
}

window.openRoleAlertInboxModal = async function(options = {}) {
  await _openRoleAlertInboxModalInternal({ resetToggle: !options.preserveState });
  completeDemoGuideStep('tools');
};

window.retryRoleAlertInboxModal = async function() {
  if (!document.getElementById('role-alerts-modal')?.classList.contains('visible')) {
    await _openRoleAlertInboxModalInternal({ resetToggle: false });
    return;
  }
  await _openRoleAlertInboxModalInternal({ resetToggle: false });
};

window.toggleRoleAlertPrototype = function() {
  // Deprecated shim for old cached builds.
};

window.setRoleAlertsShowAccepted = async function(showAccepted) {
  _roleAlertsShowAccepted = !!showAccepted;
  _updateRoleAlertModalToggleUI();
  if (_roleAlertsCache.length) {
    _renderRoleAlertsModal(_roleAlertsCache);
  } else {
    _updateRoleAlertModalFooter(0, 0);
  }
};

window.closeRoleAlertInboxModal = function() {
  _roleAlertsLoadToken += 1;
  _setRoleAlertsModalVisible(false);
};

window.focusIssueFromAlert = function(issueId) {
  const focusId = String(issueId || '').trim();
  if (!focusId) return;
  _roleAlertFocusIssueId = focusId;
  closeRoleAlertInboxModal();
  renderIssues();
  requestAnimationFrame(() => {
    const issueRow = document.querySelector(`.issue-row[data-id="${CSS.escape(focusId)}"]`);
    if (!issueRow) return;
    const body = document.getElementById('body-' + focusId);
    if (body && !body.classList.contains('visible') && typeof toggleCard === 'function') toggleCard(focusId);
    issueRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    issueRow.classList.add('highlight', 'alert-focus-issue');
    setTimeout(() => issueRow.classList.remove('highlight', 'alert-focus-issue'), 1200);
  });
};

window.deleteRoleAlert = async function(alertId, categoryKey, statusKey) {
  if (!currentPlantId || !alertId || !currentUser?.uid) return;
  try {
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const existing = _roleAlertsCache.find(alert => alert.id === alertId);
      const nextRecipients = (existing?.raw?.recipientUserIds || []).filter(uid => uid !== currentUser.uid);
      await dataApi.updateRoleAlert(currentPlantId, alertId, { recipientUserIds: nextRecipients });
      _roleAlertsCache = _roleAlertsCache.filter(alert => alert.id !== alertId);
      if (document.getElementById('role-alerts-modal')?.classList.contains('visible')) {
        await _openRoleAlertInboxModalInternal({ resetToggle: false });
      }
      await _refreshRoleAlertBadgeCount();
      return;
    }
    const alertRef = doc(db, 'plants', currentPlantId, 'roleFeedAlerts', alertId);
    const snap = await getDoc(alertRef);
    if (!snap.exists()) {
      await openRoleAlertInboxModal();
      return;
    }
    await updateDoc(alertRef, {
      recipientUserIds: arrayRemove(currentUser.uid)
    });
    if (document.getElementById('role-alerts-modal')?.classList.contains('visible')) {
      await _openRoleAlertInboxModalInternal({ resetToggle: false });
    }
    await _refreshRoleAlertBadgeCount();
  } catch (e) {
    showGameToast(`⚠️ Could not delete alert: ${e?.message || e}`);
  }
};

window.acceptRoleAlert = async function(issueId, statusKey, workflowId = '') {
  if (!issueId || !statusKey) return;
  try {
    const updatedWorkflowId = normalizeWorkflowId(workflowId)
      ? await setWorkflowStateForWorkflowId(issueId, workflowId, 'accepted')
      : '';
    if (!updatedWorkflowId) await setWorkflowStateForStatus(issueId, statusKey, 'accepted');
    showGameToast('✅ Workflow accepted');
    _roleAlertsShowAccepted = true;
    if (document.getElementById('role-alerts-modal')?.classList.contains('visible')) {
      await _openRoleAlertInboxModalInternal({ resetToggle: false });
    }
    await _refreshRoleAlertBadgeCount();
  } catch (e) {
    showGameToast(`⚠️ Could not accept: ${e?.message || e}`);
  }
};

window.unacceptRoleAlert = async function(issueId, statusKey, workflowId = '') {
  if (!issueId || !statusKey) return;
  try {
    const updatedWorkflowId = normalizeWorkflowId(workflowId)
      ? await setWorkflowStateForWorkflowId(issueId, workflowId, 'called')
      : '';
    if (!updatedWorkflowId) await setWorkflowStateForStatus(issueId, statusKey, 'called');
    showGameToast('↩️ Workflow unaccepted');
    if (document.getElementById('role-alerts-modal')?.classList.contains('visible')) {
      await _openRoleAlertInboxModalInternal({ resetToggle: false });
    }
    await _refreshRoleAlertBadgeCount();
  } catch (e) {
    showGameToast(`⚠️ Could not unaccept: ${e?.message || e}`);
  }
};

function startRoleFeedAlertsWatcher() {
  stopRoleFeedAlertsWatcher();
  if (!currentPlantId || !currentUser?.uid) return;
  if (shouldUseSqlStagingReads(currentPlantId)) {
    let active = true;
    const poll = async () => {
      if (!active || pageHidden || !currentPlantId) return;
      try {
        const alerts = await _loadActiveRoleAlertsForCurrentUser();
        _roleAlertsCache = alerts;
        _setActiveRoleAlertCount(alerts.filter(a => !a.isAccepted).length);
        alerts.forEach(alert => {
          if (_seenRoleFeedAlerts.has(alert.id)) return;
          _seenRoleFeedAlerts.add(alert.id);
          const createdMs = compatTimestampMillis(alert.createdAt);
          if (createdMs && (Date.now() - createdMs) > (10 * 60 * 1000)) return;
          _unreadRoleAlertCount += 1;
          showGameToast(`🔔 ${alert.feedLabel || 'Alert'} · Press ${alert.machine || 'Unknown'}`);
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(alert.feedLabel || 'New Alert', {
                body: `${alert.machine || 'Press'} · ${alert.note || alert.statusKey || ''}`.trim()
              });
            } catch (_) {}
          }
        });
      } catch (err) {
        console.warn('roleFeedAlerts SQL poll error', err);
      }
      if (active) _roleAlertsPollTimer = setTimeout(poll, 10000);
    };
    _roleFeedAlertsUnsubscribe = () => {
      active = false;
      if (_roleAlertsPollTimer) {
        clearTimeout(_roleAlertsPollTimer);
        _roleAlertsPollTimer = null;
      }
      _roleFeedAlertsUnsubscribe = null;
    };
    void poll();
    return;
  }
  const q = query(
    collection(db, 'plants', currentPlantId, 'roleFeedAlerts'),
    where('recipientUserIds', 'array-contains', currentUser.uid),
    limit(40)
  );
  _roleFeedAlertsUnsubscribe = onSnapshot(q, snap => {
    void _refreshRoleAlertBadgeCount();
    snap.docChanges().forEach(change => {
      if (change.type !== 'added') return;
      const id = change.doc.id;
      if (_seenRoleFeedAlerts.has(id)) return;
      _seenRoleFeedAlerts.add(id);
      const data = change.doc.data() || {};
      const createdMs = data.createdAt?.toMillis ? data.createdAt.toMillis() : 0;
      if (createdMs && (Date.now() - createdMs) > (10 * 60 * 1000)) return; // skip stale alerts
      _unreadRoleAlertCount += 1;
      showGameToast(`🔔 ${data.feedLabel || 'Alert'} · Press ${data.machine || 'Unknown'}`);
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(data.feedLabel || 'New Alert', { body: `${data.machine || 'Press'} · ${data.note || data.statusKey || ''}`.trim() });
        } catch (_) {}
      }
    });
  }, err => {
    console.warn('roleFeedAlerts watcher error', err);
  });
}

function _humanizeRoleKey(roleKey) {
  if (String(roleKey || '').trim().toLowerCase() === 'main_maintenance_role') return 'Main Maintenance Role';
  return String(roleKey || '').trim().split('_').filter(Boolean).map(s => s[0]?.toUpperCase() + s.slice(1)).join(' ');
}

function getAvailableCategoryOptionsForPreferences() {
  return Object.entries(STATUSES || {})
    .map(([key, def]) => ({ key: String(key || '').trim().toLowerCase(), label: String(def?.label || key).trim() }))
    .filter(v => v.key && v.key !== 'open' && v.key !== 'resolved')
    .sort((a, b) => a.label.localeCompare(b.label));
}

window.openRolePreferencesModal = async function() {
  const modal = document.getElementById('role-prefs-modal');
  const list = document.getElementById('role-prefs-list');
  const msg = document.getElementById('role-prefs-msg');
  if (!modal || !list || !msg || !currentPlantId || !currentUser?.uid) return;
  msg.textContent = 'Loading categories…';
  list.innerHTML = '';
  try {
    const [categoryOptions, memberPayload] = await Promise.all([
      Promise.resolve(getAvailableCategoryOptionsForPreferences()),
      shouldUseSqlStagingReads(currentPlantId)
        ? requireSqlRead(
            `member ${currentPlantId}:${currentUser.uid}`,
            () => dataApi.listPlantMembers(currentPlantId, { active: false }),
            `Current user member record is missing in D1 for plant ${currentPlantId}.`
          )
        : getDoc(plantMemberDocRef(currentPlantId, currentUser.uid))
    ]);
    const member = shouldUseSqlStagingReads(currentPlantId)
      ? ((memberPayload?.members || []).find(entry => (entry.uid || entry.id) === currentUser.uid) || {})
      : (memberPayload.exists() ? (memberPayload.data() || {}) : {});
    _rolePrefsDraft = Array.isArray(member.alertCategorySubscriptions)
      ? member.alertCategorySubscriptions.map(v => String(v || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const finalOptions = categoryOptions.length ? categoryOptions : [{ key:'maintenance', label:'Maintenance' }];
    list.innerHTML = finalOptions.map(opt => `
      <label style="display:flex;align-items:center;gap:8px;background:var(--color-surface-raised, var(--bg3));border:1px solid var(--color-border, var(--border));border-radius:10px;padding:8px 10px;">
        <input type="checkbox" data-role-key="${esc(opt.key)}" ${_rolePrefsDraft.includes(opt.key) ? 'checked' : ''}>
        <span>${esc(opt.label)}</span>
      </label>
    `).join('');
    msg.textContent = '';
    modal.classList.add('visible');
  } catch (e) {
    msg.textContent = e?.message || 'Unable to load category options.';
    modal.classList.add('visible');
  }
};

window.closeRolePreferencesModal = function() {
  document.getElementById('role-prefs-modal')?.classList.remove('visible');
};

window.saveRolePreferences = async function() {
  const msg = document.getElementById('role-prefs-msg');
  if (!currentPlantId || !currentUser?.uid || !msg) return;
  const selected = Array.from(document.querySelectorAll('#role-prefs-list input[type=\"checkbox\"]:checked'))
    .map(el => String(el.getAttribute('data-role-key') || '').trim().toLowerCase())
    .filter(Boolean);
  try {
    msg.textContent = 'Saving…';
    if (shouldUseSqlStagingReads(currentPlantId)) {
      await dataApi.updatePlantMember(currentPlantId, currentUser.uid, {
        alertCategorySubscriptions: selected
      });
    } else {
      await updateDoc(plantMemberDocRef(currentPlantId, currentUser.uid), {
        alertCategorySubscriptions: selected,
        updatedAt: serverTimestamp(),
        updatedBy: currentActor()
      });
    }
    msg.textContent = 'Saved.';
    setTimeout(() => {
      closeRolePreferencesModal();
      showGameToast('✅ Alert categories updated');
    }, 250);
  } catch (e) {
    msg.textContent = e?.message || 'Could not save categories.';
  }
};

// Default press layout — used when creating a new plant or if Firestore has none
const DEFAULT_PRESSES = {
  "Row 1": ["1.01","1.02","1.03","1.04","1.05","1.06","1.07","1.08","1.09","1.10","1.11","1.12","1.13","1.14","1.15","1.16","1.17"],
  "Row 2": ["2.01","2.02","2.03","2.04","2.05","2.06","2.07","2.08","2.09","2.10","2.11","2.12","2.13","2.14","2.15","2.16","2.17","2.18","2.19","2.20","2.21","2.22"],
  "Row 3": ["3.01","3.02","3.03","3.04","3.05","3.06","3.07","3.08","3.09","3.10","3.12","3.13","3.14","3.15","3.16","3.17","3.18","3.19"],
  "Row 4": ["4.01","4.02","4.03","4.04","4.05","4.06","4.07","4.08","4.09","4.10","4.11","4.12","4.13","4.14","4.15","4.16","4.17"],
  "Row 5": ["5.01","5.02","5.03","5.04","5.05","5.06","5.07","5.08","5.09","5.10","5.11","5.12"],
  "Row 6": ["6.01","6.02","6.03","6.05","6.06","6.07"],
  "Other": ["Auto Cell","BR-1","CR-1","CR-2"]
};

let PRESSES = { ...DEFAULT_PRESSES };
let ALL_MACHINES = Object.values(PRESSES).flat();
const WIKI_SCOPE_PRESS = 'press';
const WIKI_SCOPE_SHARED = 'shared';
let _pressWikiScope = WIKI_SCOPE_PRESS;

// Firestore path helpers — all data scoped under plants/{plantId}/
const firebasePaths = createFirebasePathHelpers({
  db,
  getPlantId: () => currentPlantId,
  getUserId: () => currentUser.uid,
  getLeaderboardPeriod: () => gameConfig?.leaderboardPeriod,
  wikiScopeShared: WIKI_SCOPE_SHARED
});
function plantCol(colName) { return firebasePaths.plantCol(colName); }
function plantDoc(colName, docId) { return firebasePaths.plantDoc(colName, docId); }
function issueEventsCol(issueId) { return firebasePaths.issueEventsCol(issueId); }
function issueAttachmentsCol(issueId) { return firebasePaths.issueAttachmentsCol(issueId); }
function pressWikiPagesCol(pressId) { return firebasePaths.pressWikiPagesCol(pressId); }
function pressWikiPageDoc(pressId, pageId) { return firebasePaths.pressWikiPageDoc(pressId, pageId); }
function pressWikiRevisionsCol(pressId, pageId) { return firebasePaths.pressWikiRevisionsCol(pressId, pageId); }
function pressWikiAttachmentsCol(pressId, pageId) { return firebasePaths.pressWikiAttachmentsCol(pressId, pageId); }
function wikiCollectionPath(scope, pressId) { return firebasePaths.wikiCollectionPath(scope, pressId); }
function wikiPagesColForScope(scope, pressId) { return firebasePaths.wikiPagesColForScope(scope, pressId); }
function wikiPageDocForScope(scope, pressId, pageId) { return firebasePaths.wikiPageDocForScope(scope, pressId, pageId); }
function wikiRevisionsColForScope(scope, pressId, pageId) { return firebasePaths.wikiRevisionsColForScope(scope, pressId, pageId); }
function wikiAttachmentsColForScope(scope, pressId, pageId) { return firebasePaths.wikiAttachmentsColForScope(scope, pressId, pageId); }
function wikiStoragePrefixForScope(scope, pressId, pageId) { return firebasePaths.wikiStoragePrefixForScope(scope, pressId, pageId); }
function notesCol() { return firebasePaths.notesCol(); }
function noteDoc(noteId) { return firebasePaths.noteDoc(noteId); }
function noteAttachmentsCol(noteId) { return firebasePaths.noteAttachmentsCol(noteId); }
function noteStoragePrefix(noteId) { return firebasePaths.noteStoragePrefix(noteId); }
function plantTodosCol() { return firebasePaths.plantTodosCol(); }
function plantTodoDoc(todoId) { return firebasePaths.plantTodoDoc(todoId); }
function userTodosCol() { return firebasePaths.userTodosCol(); }
function userTodoDoc(todoId) { return firebasePaths.userTodoDoc(todoId); }
function plantMemberDocRef(plantId, userId) { return firebasePaths.plantMemberDocRef(plantId, userId); }
function gameConfigDoc() { return firebasePaths.gameConfigDoc(); }
function gameUserStatsDoc(userId) { return firebasePaths.gameUserStatsDoc(userId); }
function gameMissionsCol() { return firebasePaths.gameMissionsCol(); }
function gameLeaderboardDoc(boardId) { return firebasePaths.gameLeaderboardDoc(boardId); }
function userBadgesDoc(userId) { return firebasePaths.userBadgesDoc(userId); }
function gameEventsCol() { return firebasePaths.gameEventsCol(); }
function missionProgressDoc(missionId, subjectId) { return firebasePaths.missionProgressDoc(missionId, subjectId); }
function globalStoreConfigDoc() { return firebasePaths.globalStoreConfigDoc(); }
function legacyPlantStoreConfigDoc() { return firebasePaths.legacyPlantStoreConfigDoc(); }
function conversationsCol() { return firebasePaths.conversationsCol(); }
function conversationDoc(conversationId) { return firebasePaths.conversationDoc(conversationId); }
function conversationMessagesCol(conversationId) { return firebasePaths.conversationMessagesCol(conversationId); }
function conversationMemberDoc(conversationId, userId) { return firebasePaths.conversationMemberDoc(conversationId, userId); }

function currentActor() {
  return { uid: currentUser?.uid || '', name: currentUser?.displayName || currentUser?.email || 'Unknown' };
}

function formatWorkflowActorName(actorName) {
  const raw = String(actorName || '').trim();
  if (!raw) return '';
  const normalized = raw.includes('@') ? raw.split('@')[0].replace(/[._-]+/g, ' ').trim() : raw;
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = parts[0];
  const lastInitial = parts.length > 1 ? `${parts[parts.length - 1].charAt(0).toUpperCase()}.` : '';
  return [first, lastInitial].filter(Boolean).join(' ');
}

function shouldSyncUserLookup(email) {
  try {
    const key = `userLookupLastSeen:${String(email || '').toLowerCase()}`;
    const now = Date.now();
    const last = Number(localStorage.getItem(key) || 0);
    if (Number.isFinite(last) && now - last < USER_LOOKUP_HEARTBEAT_MS) return false;
    localStorage.setItem(key, String(now));
    return true;
  } catch(e) {
    return true;
  }
}

function toPressId(machineCode) {
  return 'press_' + String(machineCode || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function toSchedulePressId(machineCode) {
  return String(machineCode || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function scheduleDateForLookup() {
  const dateFilter = document.getElementById('date-filter')?.value || '';
  if (issuePeriod === 'date' && dateFilter) return dateFilter;
  return localDateStr(new Date());
}

// Bulk-loads all scheduled machine codes for a given date from all 4 schedule sections.
// Result is cached in scheduledPressesState. Calls updatePressStates() when done so
// press buttons immediately reflect their scheduled/unscheduled state.
async function loadDailyScheduledPresses(date) {
  if (!currentPlantId || !date) { scheduledPressesState = null; return; }
  if (scheduledPressesState && scheduledPressesState.plantId === currentPlantId && scheduledPressesState.date === date) return; // already cached
  try {
    const index = await loadDailyScheduleIndex(date);
    scheduledPressesState = { plantId: currentPlantId, date, scheduled: index?.scheduled ?? null };
  } catch(e) {
    console.warn('loadDailyScheduledPresses failed:', e);
    scheduledPressesState = { plantId: currentPlantId, date, scheduled: null };
  }
  updatePressStates();
}

function normalizeSchedulePress(machineCode) {
  return String(machineCode || '').trim();
}

function buildScheduleIndexFromSectionRows(rowsBySection) {
  const scheduled = new Set();
  const lookupByPress = new Map();
  const sortByOrder = (a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0);
  const pushRow = (machine, row) => {
    if (!machine) return;
    scheduled.add(machine);
    const existing = lookupByPress.get(machine) || { main: [], changes: [] };
    if (row.section === 'page1' || row.section === 'page2') existing.main.push(row);
    else existing.changes.push({
      ...row,
      section: row.section === 'northBayChanges' ? 'North Bay Change' : 'South Bay Change'
    });
    lookupByPress.set(machine, existing);
  };

  Object.entries(rowsBySection).forEach(([section, rows]) => {
    (Array.isArray(rows) ? rows : []).forEach((data, idx) => {
      const machine = normalizeSchedulePress(data?.press);
      pushRow(machine, { id: data?.rowId || data?.id || `${section}_${idx + 1}`, ...data, section });
    });
  });

  lookupByPress.forEach(v => {
    v.main.sort(sortByOrder);
    v.changes.sort(sortByOrder);
  });

  return { scheduled, lookupByPress };
}

async function loadDailyScheduleIndex(date) {
  if (!currentPlantId || !date) return null;
  if (dailyScheduleIndexState && dailyScheduleIndexState.plantId === currentPlantId && dailyScheduleIndexState.date === date) {
    return dailyScheduleIndexState;
  }
  const sqlPayload = shouldUseSqlStagingReads(currentPlantId)
    ? await requireSqlRead(
        `daily schedule ${currentPlantId}:${date}`,
        () => dataApi.getDailySchedule(currentPlantId, date),
        `Daily schedule lookup failed in D1 for plant ${currentPlantId} on ${date}.`
      )
    : null;
  if (sqlPayload?.schedule) {
    const { scheduled, lookupByPress } = buildScheduleIndexFromSectionRows(sqlPayload.sections || {});
    dailyScheduleIndexState = { plantId: currentPlantId, date, scheduled, lookupByPress };
    return dailyScheduleIndexState;
  }
  if (shouldUseSqlStagingReads(currentPlantId)) {
    dailyScheduleIndexState = { plantId: currentPlantId, date, scheduled: null, lookupByPress: new Map() };
    return dailyScheduleIndexState;
  }
  const dailyRef = doc(db, 'plants', currentPlantId, 'dailySchedules', date);
  const dailySnap = await getDoc(dailyRef);
  if (!dailySnap.exists()) {
    dailyScheduleIndexState = { plantId: currentPlantId, date, scheduled: null, lookupByPress: new Map() };
    return dailyScheduleIndexState;
  }
  const sections = ['page1', 'page2', 'northBayChanges', 'southBayChanges'];
  const sectionSnaps = await Promise.all(
    sections.map(s => getDocs(collection(db, 'plants', currentPlantId, 'dailySchedules', date, s)))
  );
  const rowsBySection = Object.fromEntries(
    sections.map((section, idx) => [section, sectionSnaps[idx].docs.map(d => ({ id: d.id, ...(d.data() || {}) }))])
  );
  const { scheduled, lookupByPress } = buildScheduleIndexFromSectionRows(rowsBySection);
  dailyScheduleIndexState = { plantId: currentPlantId, date, scheduled, lookupByPress };
  return dailyScheduleIndexState;
}

async function getPressScheduleLookup(machineCode, scheduleDate) {
  const pressId = toSchedulePressId(machineCode);
  const cacheKey = `${currentPlantId || 'no-plant'}::${scheduleDate}::${pressId}`;
  if (scheduleLookupCache.has(cacheKey)) return scheduleLookupCache.get(cacheKey);
  if (!currentPlantId || !scheduleDate) {
    scheduleLookupCache.set(cacheKey, null);
    return null;
  }

  const machine = normalizeSchedulePress(machineCode);
  const index = await loadDailyScheduleIndex(scheduleDate);
  if (!index?.scheduled) {
    scheduleLookupCache.set(cacheKey, null);
    return null;
  }
  const rows = index.lookupByPress.get(machine) || { main: [], changes: [] };

  const data = {
    mainRow: rows.main[0] || null,
    hasChanges: rows.changes.length > 0,
    changes: rows.changes
  };
  scheduleLookupCache.set(cacheKey, data);
  return data;
}

function renderScheduleSection(container, lookupDoc, scheduleDate) {
  const block = document.createElement('div');
  block.className = 'mc-schedule';
  const title = document.createElement('div');
  title.className = 'mc-schedule-title';
  title.textContent = `Schedule ${scheduleDate}`;
  block.appendChild(title);

  if (!lookupDoc) {
    const empty = document.createElement('div');
    empty.className = 'mc-schedule-empty';
    empty.textContent = 'No daily schedule found for this press/date.';
    block.appendChild(empty);
    container.appendChild(block);
    return;
  }

  const main = document.createElement('div');
  main.className = 'mc-schedule-main';
  if (lookupDoc.mainRow) {
    main.textContent = `${lookupDoc.mainRow.partNumber || '—'} · ${lookupDoc.mainRow.description || 'No description'}`;
  } else {
    main.textContent = 'No main schedule row (change-only entry).';
  }
  block.appendChild(main);

  const meta = document.createElement('div');
  meta.className = 'mc-schedule-meta';
  const section = document.createElement('span');
  section.className = 'mc-schedule-pill';
  const partStorageLocation = Array.isArray(lookupDoc.mainRow?.partStorageLocation)
    ? lookupDoc.mainRow.partStorageLocation.filter(Boolean).join(', ')
    : String(lookupDoc.mainRow?.partStorageLocation || '').trim();
  section.textContent = `Part Storage Location: ${partStorageLocation || '—'}`;
  meta.appendChild(section);
  const cavity = document.createElement('span');
  cavity.className = 'mc-schedule-pill';
  cavity.textContent = `Cavity: ${lookupDoc.mainRow?.cavity || '—'}`;
  meta.appendChild(cavity);
  const labels = document.createElement('span');
  labels.className = 'mc-schedule-pill';
  labels.textContent = `Labels/Shift: ${lookupDoc.mainRow?.labelsPerShift ?? '—'}`;
  meta.appendChild(labels);
  const doh = document.createElement('span');
  doh.className = 'mc-schedule-pill';
  const dohVal = lookupDoc.mainRow?.doh;
  if (dohVal !== null && dohVal !== undefined && dohVal !== '') {
    const num = Number(dohVal);
    if (!isNaN(num)) {
      let bg, text;
      if (num < 1) { bg = 'rgba(239,68,68,0.25)'; text = '#ef4444'; }
      else if (num < 2) { bg = 'rgba(234,179,8,0.25)'; text = '#eab308'; }
      else { bg = 'rgba(34,197,94,0.25)'; text = '#22c55e'; }
      doh.style.background = bg;
      doh.style.color = text;
      doh.style.borderColor = text;
    }
  }
  doh.textContent = `DOH: ${dohVal ?? '—'}`;
  meta.appendChild(doh);
  if (lookupDoc.hasChanges) {
    const changes = document.createElement('span');
    changes.className = 'mc-schedule-pill';
    changes.style.color = 'var(--color-accent, var(--accent))';
    changes.textContent = `${lookupDoc.changes?.length || 0} change(s)`;
    meta.appendChild(changes);
  }
  block.appendChild(meta);

  if (lookupDoc.mainRow?.notes) {
    const notes = document.createElement('div');
    notes.className = 'mc-schedule-notes';
    notes.textContent = lookupDoc.mainRow.notes;
    block.appendChild(notes);
  }

  (lookupDoc.changes || []).forEach(ch => {
    const change = document.createElement('div');
    change.className = 'mc-schedule-change';
    change.textContent = `${ch.section}: ${ch.partNumber || '—'} · ${ch.description || 'No description'}${ch.notes ? ` (${ch.notes})` : ''}`;
    block.appendChild(change);
  });

  container.appendChild(block);
}

function toRowId(rowName) {
  const m = String(rowName || '').match(/(\d+)/);
  if (m) return 'row_' + String(m[1]).padStart(2, '0');
  const norm = String(rowName || 'other').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return norm ? ('row_' + norm) : 'row_other';
}

function findRowNameForMachine(machineCode) {
  for (const [rowName, machines] of Object.entries(PRESSES || {})) {
    if ((machines || []).includes(machineCode)) return rowName;
  }
  return 'Other';
}

function deriveLifecycle(statusKey, baseIssue = null, opts = {}) {
  const isResolved = statusKey === 'resolved';
  const wasResolved = !!(baseIssue?.lifecycle?.isResolved || baseIssue?.resolved);
  const priorReopenCount = Number(baseIssue?.lifecycle?.reopenedCount || 0);
  return {
    isOpen: !isResolved,
    isResolved,
    openedAt: baseIssue?.lifecycle?.openedAt || baseIssue?.createdAt || serverTimestamp(),
    resolvedAt: isResolved ? serverTimestamp() : null,
    closedAt: isResolved ? serverTimestamp() : null,
    reopenedCount: opts.forceReopenIncrement ? priorReopenCount + 1 : (wasResolved && !isResolved ? priorReopenCount + 1 : priorReopenCount)
  };
}

function buildCurrentStatus(statusKey, subStatus = '', enteredDateTime = '', note = '') {
  const def = getStatusDef(statusKey);
  return {
    statusKey: statusKey || 'open',
    subStatusKey: subStatus || '',
    label: def?.label || statusKey || 'Open',
    subLabel: subStatus || '',
    color: getStatusColor(statusKey),
    enteredAt: serverTimestamp(),
    enteredDateTime: enteredDateTime || fmtDate(new Date()),
    enteredBy: currentActor(),
    notePreview: note || ''
  };
}

// ── SECONDARY STATUS HELPERS ──
// An issue has one primary status (currentStatus) plus an optional array of
// lightweight secondary department flags (no sub-statuses, stored as string keys).

function getSecondaryStatuses(issue) {
  if (Array.isArray(issue?.secondaryStatuses)) return issue.secondaryStatuses;
  return [];
}

// Returns all active status keys: primary + secondary (resolved overrides everything)
function getActiveStatuses(issue) {
  if (issue?.lifecycle?.isResolved || issue?.currentStatus?.statusKey === 'resolved') {
    return [{ statusKey: 'resolved', subStatusKey: '' }];
  }
  const primary = { statusKey: currentStatusKey(issue), subStatusKey: issue.currentStatus?.subStatusKey || '' };
  const secondary = getSecondaryStatuses(issue)
    .filter(k => k !== 'resolved' && k !== currentStatusKey(issue))
    .map(k => ({ statusKey: k, subStatusKey: '' }));
  return [primary, ...secondary];
}

// True if the issue has this status as primary OR secondary
function issueHasActiveStatus(issue, statusKey) {
  return getActiveStatuses(issue).some(s => s.statusKey === statusKey);
}

// Toggle a secondary status tag on/off (does NOT touch the primary status)
window.toggleSecondaryStatus = async (id, statusKey) => {
  if (!currentUserPermissions.canEditIssue) return;
  const issue = issues.find(i => i.id === id);
  if (!issue) return;
  const current = getSecondaryStatuses(issue);
  const updated = current.includes(statusKey)
    ? current.filter(k => k !== statusKey)
    : [...current, statusKey];
  try {
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const nextIssue = applyIssuePatchLocally(issue, {
        secondaryStatuses: updated,
        updatedAt: new Date().toISOString(),
        updatedBy: currentActor()
      });
      nextIssue.id = id;
      await commitSqlIssueWrite(id, nextIssue);
      return;
    }
    await updateDoc(plantDoc('issues', id), {
      secondaryStatuses: updated,
      updatedAt: serverTimestamp(),
      updatedBy: currentActor()
    });
  } catch(e) { setSyncStatus('err', 'Error: ' + e.message); }
};
// ── END SECONDARY STATUS HELPERS ──

function buildIssueV2Compat({ machineCode, statusKey, subStatus = '', statusDateTime = '', note = '', baseIssue = null, forceReopenIncrement = false }) {
  const rowName = findRowNameForMachine(machineCode);
  return {
    schemaVersion: 2,
    plantId: currentPlantId,
    pressId: toPressId(machineCode),
    machineCode: machineCode || '',
    rowId: toRowId(rowName),
    currentStatus: buildCurrentStatus(statusKey, subStatus, statusDateTime, note),
    lifecycle: deriveLifecycle(statusKey, baseIssue, { forceReopenIncrement }),
    updatedAt: serverTimestamp(),
    updatedBy: currentActor()
  };
}

function queueIssueEvent(batch, issueId, type, payload = {}) {
  const evtRef = doc(issueEventsCol(issueId));
  batch.set(evtRef, {
    type,
    eventAt: serverTimestamp(),
    actor: currentActor(),
    payload,
    schemaVersion: 2
  });
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isCloudflareStoredAttachment(att) {
  const bucket = String(att?.storageBucket || '').trim().toLowerCase();
  const url = String(att?.downloadUrl || att?.downloadURL || att?.url || att?.dataUrl || '').trim();
  return bucket === 'r2' || url.includes('/api/storage/object?');
}

async function resolveAttachmentUrl(att) {
  if (!att) return '';
  const directUrl = String(att.downloadUrl || att.downloadURL || att.url || att.dataUrl || '').trim();
  if (directUrl) return directUrl;
  if (isCloudflareStoredAttachment(att)) return '';
  if (!att.storagePath) return '';
  try {
    const attStorage = att.storageBucket ? getStorage(app, `gs://${att.storageBucket}`) : storage;
    return await getDownloadURL(storageRef(attStorage, att.storagePath));
  } catch (_) {
    return '';
  }
}

async function uploadAttachmentToPreferredStorage(plantId, payload) {
  const useSqlStorage = shouldUseSqlStagingReads(plantId);
  if (useSqlStorage) {
    try {
      const response = await dataApi.uploadPlantAttachment(plantId, payload);
      if (response?.attachment?.storagePath) {
        return response.attachment;
      }
    } catch (err) {
      const isConfigGap = Number(err?.status || 0) === 501;
      if (!isConfigGap) {
        console.warn('Cloudflare attachment upload failed, falling back to Firebase Storage.', err);
      }
    }
  }
  return null;
}

async function deleteStoredAttachmentBlob(plantId, att) {
  if (!att?.storagePath) return;
  if (isCloudflareStoredAttachment(att) && shouldUseSqlStagingReads(plantId)) {
    await dataApi.deleteStoredAttachmentObject(plantId, { storagePath: att.storagePath });
    return;
  }
  const attStorage = att.storageBucket ? getStorage(app, `gs://${att.storageBucket}`) : storage;
  await deleteObject(storageRef(attStorage, att.storagePath));
}

async function uploadIssuePhotosToStorage(issueId, photos, plantId = currentPlantId) {
  const out = [];
  for (let idx = 0; idx < (photos || []).length; idx++) {
    const p = photos[idx] || {};
    const src = String(p.dataUrl || '');
    if (!src.startsWith('data:')) { out.push(p); continue; }
    const meta = parseDataUrlMeta(src);
    if (!meta) { out.push(p); continue; }
    const ext = extFromContentType(meta.contentType);
    const fileName = `${Date.now()}_${idx}.${ext}`;
    const uploaded = await uploadAttachmentToPreferredStorage(plantId, {
      scope: 'issue',
      issueId,
      fileName,
      contentType: meta.contentType,
      dataUrl: src
    });
    if (uploaded?.storagePath) {
      out.push({
        name: p.name || uploaded.fileName || fileName,
        dataUrl: uploaded.downloadUrl || uploaded.url || '',
        downloadUrl: uploaded.downloadUrl || uploaded.url || '',
        storagePath: uploaded.storagePath,
        storageBucket: uploaded.storageBucket || 'r2',
        contentType: uploaded.contentType || meta.contentType,
        sizeBytes: Number(uploaded.sizeBytes || meta.sizeBytes || 0),
        source: 'r2',
        takenAt: p.takenAt || p.timestamp || '',
        uploadedAt: uploaded.uploadedAt || new Date().toISOString()
      });
      continue;
    }
    const path = `plants/${plantId}/issues/${issueId}/photos/${fileName}`;
    let sRef = storageRef(storage, path);
    let url = '';
    try {
      await uploadString(sRef, src, 'data_url');
      url = await getDownloadURL(sRef);
    } catch (err) {
      const msg = String(err?.message || '');
      const shouldTryFallback = storageFallback && (msg.includes('Permission denied') || msg.includes('storage/unauthorized') || msg.includes('storage/bucket-not-found'));
      if (!shouldTryFallback) throw err;
      sRef = storageRef(storageFallback, path);
      await uploadString(sRef, src, 'data_url');
      url = await getDownloadURL(sRef);
    }
    out.push({
      name: p.name || fileName,
      dataUrl: url, // keep existing UI field name for backward-compatible rendering
      downloadUrl: url,
      storagePath: path,
      storageBucket: sRef.bucket,
      contentType: meta.contentType,
      sizeBytes: meta.sizeBytes,
      source: 'storage',
      takenAt: p.takenAt || p.timestamp || '',
      uploadedAt: new Date().toISOString()
    });
  }
  return out;
}

function queueAttachmentDocs(batch, issueId, photos = []) {
  photos.forEach((p, idx) => {
    if (!p?.storagePath) return;
    const attachmentId = `photo_${String(idx).padStart(3, '0')}_${String(p.storagePath).split('/').pop().replace(/[^a-zA-Z0-9]+/g, '_')}`;
    batch.set(doc(issueAttachmentsCol(issueId), attachmentId), {
      type: 'photo',
      fileName: p.name || '',
      contentType: p.contentType || 'image/jpeg',
      storagePath: p.storagePath,
      storageBucket: p.storageBucket || '',
      thumbnailPath: null,
      uploadedBy: currentActor(),
      sizeBytes: Number(p.sizeBytes || 0),
      source: p.source || 'storage',
      takenAt: p.takenAt || p.timestamp || null,
      uploadedAt: p.uploadedAt || serverTimestamp(),
      schemaVersion: 2
    }, { merge: true });
  });
}

const attachmentPhotoCache = new Map(); // issueId -> [{name,dataUrl,...}]
let attachmentsHydrationToken = 0;
const issueEventHistoryCache = new Map(); // issueId -> [{status,subStatus,note,dateTime,by}]
let eventsHydrationToken = 0;
const issueDetailsHydrationInFlight = new Map(); // issueId -> Promise<void>

async function fetchAttachmentPhotos(issueId) {
  if (attachmentPhotoCache.has(issueId)) return attachmentPhotoCache.get(issueId);
  if (shouldUseSqlStagingReads()) {
    const payload = await requireSqlRead(
      `attachments ${issueId}`,
      () => dataApi.listIssueAttachments(currentPlantId, issueId),
      `Issue attachments are missing in D1 for issue ${issueId}.`
    );
    const photos = [];
    for (const att of (payload?.attachments || [])) {
      if (!att?.storagePath && !att?.downloadUrl) continue;
      const downloadUrl = await resolveAttachmentUrl(att);
      photos.push({
        name: att.fileName || att.attachmentId || issueId,
        dataUrl: downloadUrl,
        downloadUrl,
        storagePath: att.storagePath || '',
        storageBucket: att.storageBucket || '',
        contentType: att.contentType || '',
        sizeBytes: Number(att.sizeBytes || 0),
        takenAt: '',
        uploadedAt: att.uploadedAt || ''
      });
    }
    attachmentPhotoCache.set(issueId, photos);
    return photos;
  }
  const snap = await getDocs(issueAttachmentsCol(issueId));
  if (snap.empty) {
    attachmentPhotoCache.set(issueId, []);
    return [];
  }
  const photos = [];
  for (const d of snap.docs) {
    const a = d.data() || {};
    if (!a.storagePath) continue;
    try {
      const url = await resolveAttachmentUrl(a);
      photos.push({
        name: a.fileName || d.id,
        dataUrl: url,
        downloadUrl: url,
        storagePath: a.storagePath,
        storageBucket: a.storageBucket || '',
        contentType: a.contentType || '',
        sizeBytes: Number(a.sizeBytes || 0),
        takenAt: a.takenAt || '',
        uploadedAt: a.uploadedAt || ''
      });
    } catch (_) {
      // Ignore broken attachment references and keep going.
    }
  }
  attachmentPhotoCache.set(issueId, photos);
  return photos;
}

async function hydrateIssuePhotosFromAttachments(issueList) {
  const myToken = ++attachmentsHydrationToken;
  const targets = (issueList || []).filter(i => Number(i.photoCount || 0) > 0);
  if (targets.length === 0) return;
  await Promise.all(targets.map(async issue => {
    const attPhotos = await fetchAttachmentPhotos(issue.id);
    issue.photos = attPhotos;
  }));
  if (myToken !== attachmentsHydrationToken) return;
  renderIssues();
}

function normalizeEventHistory(issue, events) {
  const out = [];
  (events || []).forEach(ev => {
    const eventType = ev.type || ev.eventType || '';
    if (eventType !== 'status_changed') return;
    const payload = ev.payload || {};
    const toStatus = payload.toStatusKey || payload.statusKey || 'open';
    const toSub = payload.toSubStatusKey || payload.subStatusKey || '';
    const note = payload.note || '';
    let dateTime = '';
    try {
      if (ev.eventAt?.toDate) dateTime = fmtDate(ev.eventAt.toDate());
      else if (ev.eventAt) dateTime = fmtDate(new Date(ev.eventAt));
    } catch (_) {}
    out.push({
      status: toStatus,
      subStatus: toSub,
      note,
      dateTime: dateTime || issue.dateTime || '',
      by: ev.actor?.name || ev.actorName || issue.userName || ''
    });
  });
  return out;
}

async function fetchIssueEventHistory(issue) {
  if (issueEventHistoryCache.has(issue.id)) return issueEventHistoryCache.get(issue.id);
  if (shouldUseSqlStagingReads()) {
    const payload = await requireSqlRead(
      `events ${issue.id}`,
      () => dataApi.listIssueEvents(currentPlantId, issue.id),
      `Issue events are missing in D1 for issue ${issue.id}.`
    );
    const history = normalizeEventHistory(issue, payload?.events || []);
    issueEventHistoryCache.set(issue.id, history);
    return history;
  }
  const q = query(issueEventsCol(issue.id), orderBy('eventAt', 'asc'));
  const snap = await getDocs(q);
  if (snap.empty) {
    issueEventHistoryCache.set(issue.id, []);
    return [];
  }
  const events = snap.docs.map(d => d.data());
  const history = normalizeEventHistory(issue, events);
  issueEventHistoryCache.set(issue.id, history);
  return history;
}

async function hydrateIssueHistoryFromEvents(issueList) {
  const myToken = ++eventsHydrationToken;
  const targets = (issueList || []).filter(i => i.schemaVersion === 2);
  if (targets.length === 0) return;
  await Promise.all(targets.map(async issue => {
    const h = await fetchIssueEventHistory(issue);
    if (h.length > 0) issue.eventHistory = h;
  }));
  if (myToken !== eventsHydrationToken) return;
  renderIssues();
}

async function ensureIssueDetailsHydrated(issueId) {
  if (!issueId) return;
  if (issueDetailsHydrationInFlight.has(issueId)) return issueDetailsHydrationInFlight.get(issueId);
  const issue = issues.find(i => i.id === issueId);
  if (!issue) return;

  const p = (async () => {
    let changed = false;
    if (Number(issue.photoCount || 0) > 0 && (!Array.isArray(issue.photos) || issue.photos.length === 0)) {
      issue.photos = await fetchAttachmentPhotos(issue.id);
      changed = true;
    }
    const hasStatusHistory = Array.isArray(issue.statusHistory) && issue.statusHistory.length > 0;
    if (issue.schemaVersion === 2 && !hasStatusHistory) {
      const h = await fetchIssueEventHistory(issue);
      if (h.length > 0) {
        issue.eventHistory = h;
        changed = true;
      }
    }
    if (changed) renderIssues();
  })().finally(() => {
    issueDetailsHydrationInFlight.delete(issueId);
  });

  issueDetailsHydrationInFlight.set(issueId, p);
  return p;
}

// ── APP LIFECYCLE HELPERS (Phase 1: structure-only refactor) ──
function refreshVisibleData() {
  renderIssues();
  updatePressStates();
  updateStats();
}

async function hydrateCurrentPlantView() {
  if (shouldUseSqlStagingReads() && currentPlantId) {
    await ensureSqlPlantBootstrap(currentPlantId);
  }
  await Promise.all([loadPlantPresses(), loadCurrentMember(currentPlantId), loadStoreConfig()]);
  buildFloorMap();
  await loadConfig();
  loadDailyScheduledPresses(scheduleDateForLookup()); // fire-and-forget; calls updatePressStates when done
}

// Load user's plant list.
// Supports new structure (plantIds array + plants/{id} docs + members subcollection)
// and old structure (plants array on user doc). On first load with old structure,
// self-migrates by writing plant docs + member docs and switching to plantIds.
async function loadUserPlants() {
  try {
    const sqlContext = shouldUseSqlBootstrap()
      ? await requireSqlBootstrapRead(
          'current user context',
          () => dataApi.getCurrentUserContext(),
          'Current user bootstrap is missing in D1.',
          payload => Boolean(payload?.user)
        )
      : null;
    let userData = {};
    const usingSqlBootstrap = shouldUseSqlBootstrap();
    if (sqlContext?.user) {
      userData = {
        displayName: sqlContext.user.displayName || currentUser?.displayName || currentUser?.email || '',
        email: sqlContext.user.email || currentUser?.email || '',
        photoURL: sqlContext.user.photoUrl || currentUser?.photoURL || '',
        fullName: sqlContext.user.fullName || '',
        ssoNumber: sqlContext.user.ssoNumber || '',
        lastPlant: sqlContext.user.lastPlantId || '',
        themePrefs: sqlContext.user.themePrefs || null,
        requestedPlantIds: Array.isArray(sqlContext.user.requestedPlantIds) ? sqlContext.user.requestedPlantIds : [],
        profileOnboarding: sqlContext.user.profileOnboarding || null,
        globalLifetimeXp: Number(sqlContext.user.globalLifetimeXp || 0),
        globalXpSpent: Number(sqlContext.user.globalXpSpent || 0),
        inventory: sqlContext.user.inventory || null
      };
    } else if (!usingSqlBootstrap) {
      const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
      userData = userSnap.exists() ? userSnap.data() : {};
    }
    currentUserProfileData = userData || {};
    availablePlantsForOnboarding = await loadAvailablePlantsForOnboarding();
    _applyFirestoreThemePrefs(userData.themePrefs);
    userLifetimeXp = Number(userData.globalLifetimeXp || 0);
    userXpSpent = Number(userData.globalXpSpent || 0);
    const rawInv = userData.inventory || {};
    userInventory = {
      unlockedItems: Array.isArray(rawInv.unlockedItems) ? rawInv.unlockedItems : [],
      activeMascot: rawInv.activeMascot || null,
    };

    if (sqlContext?.plants?.length) {
      userPlants = sqlContext.plants.map(plant => ({
        id: plant.plantId,
        name: plant.plantName || plant.plantId,
        location: ''
      }));
      const lastPlantCandidates = [
        userData.lastPlant,
        sqlContext.user?.lastPlantId,
        localStorage.getItem('apTrackerLastPlant')
      ].filter(Boolean);
      const firstValidLastPlant = lastPlantCandidates.find(plantId => userPlants.some(p => p.id === plantId));
      currentPlantId = firstValidLastPlant || (userPlants[0]?.id || null);
      currentUserProfileData = {
        ...currentUserProfileData,
        lastPlant: currentPlantId,
        plantIds: userPlants.map(p => p.id)
      };
    } else if (usingSqlBootstrap) {
      userPlants = [];
      currentPlantId = null;
      currentUserProfileData = {
        ...currentUserProfileData,
        lastPlant: '',
        plantIds: []
      };
    } else if (!usingSqlBootstrap && Array.isArray(userData.plantIds) && userData.plantIds.length > 0) {
      // ── New structure: fetch each plant doc for name/location ──
      const plantDocs = await Promise.all(
        userData.plantIds.map(id => getDoc(doc(db, 'plants', id)))
      );
      userPlants = plantDocs
        .filter(s => s.exists())
        .map(s => ({ id: s.id, name: s.data().name || s.id, location: s.data().location || '' }));
      const lastPlantValid = userData.lastPlant && userPlants.some(p => p.id === userData.lastPlant);
      currentPlantId = lastPlantValid ? userData.lastPlant : (userPlants[0]?.id || null);

    } else if (!usingSqlBootstrap && Array.isArray(userData.plants) && userData.plants.length > 0) {
      // ── Old structure: migrate plant metadata into plant docs + member docs ──
      userPlants = userData.plants;
      const lastPlantValid = userData.lastPlant && userPlants.some(p => p.id === userData.lastPlant);
      currentPlantId = lastPlantValid ? userData.lastPlant : userPlants[0].id;
      await _migratePlantsToNewStructure(userPlants);

    } else {
      currentPlantId = null;
      userPlants = [];
    }

    currentPlantName = (userPlants.find(p => p.id === currentPlantId) || {}).name || currentPlantId;
    document.getElementById('plant-name-display').textContent = currentPlantName;
    buildPlantDropdown();
    _syncCurrentUserMembershipProfile(userPlants.map(p => p.id)).catch(e => {
      console.warn('Could not sync membership profile fields', e);
    });
  } catch(e) {
    console.warn('Error loading plants', e);
    currentPlantId = null;
    currentPlantName = '';
    userPlants = [];
    document.getElementById('plant-name-display').textContent = 'Unable to load plants';
    throw e;
  }
}

async function loadAvailablePlantsForOnboarding() {
  if (DEMO_MODE || NO_AUTH_MODE) return [];
  const sqlPlants = shouldUseSqlBootstrap()
    ? await requireSqlBootstrapRead(
        'plant directory',
        () => dataApi.listPlants({ active: true }),
        'Plant directory is missing in D1.',
        payload => Array.isArray(payload?.plants)
      )
    : null;
  if (Array.isArray(sqlPlants?.plants)) {
    return sqlPlants.plants
      .map(plant => ({
        id: plant.plantId,
        name: plant.name || plant.plantId,
        location: plant.location || '',
        isActive: plant.isActive !== false
      }))
      .filter(p => p.isActive)
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  }
  try {
    const snap = await getDocs(collection(db, 'plants'));
    return snap.docs
      .map(d => ({ id: d.id, name: d.data().name || d.id, location: d.data().location || '', isActive: d.data().isActive !== false }))
      .filter(p => p.isActive)
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  } catch (e) {
    console.warn('Could not load plant directory for onboarding', e);
    return [...userPlants];
  }
}

async function _syncCurrentUserMembershipProfile(plantIds = []) {
  if (!currentUser?.uid || !Array.isArray(plantIds) || !plantIds.length) return;
  if (shouldUseSqlBootstrap()) {
    try {
      await dataApi.updateCurrentUserContext({
        displayName: currentUser.displayName || currentUser.email || '',
        fullName: currentUserProfileData?.fullName || null,
        ssoNumber: currentUserProfileData?.ssoNumber || null
      });
    } catch (e) {
      console.warn('Could not sync membership profile fields to D1', e);
    }
    return;
  }
  const batch = writeBatch(db);
  plantIds.filter(Boolean).forEach(plantId => {
    batch.set(plantMemberDocRef(plantId, currentUser.uid), {
      userId: currentUser.uid,
      displayName: currentUser.displayName || currentUser.email || '',
      email: currentUser.email || '',
      photoURL: currentUser.photoURL || ''
    }, { merge: true });
  });
  await batch.commit();
}

// Write a plant doc + member doc for a brand new plant (no presses config yet)
async function _initNewPlant(plantId, name, location) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'plants', plantId), { name, location: location || '', createdAt: serverTimestamp(), isActive: true });
  batch.set(plantMemberDocRef(plantId, currentUser.uid), {
    userId: currentUser.uid,
    displayName: currentUser.displayName || currentUser.email || '',
    email: currentUser.email || '',
    photoURL: currentUser.photoURL || '',
    role: 'admin',
    isActive: true,
    addedAt: serverTimestamp(),
    permissions: { ...DEFAULT_PERMISSIONS }
  });
  batch.set(doc(db, 'plants', plantId, 'config', 'presses'), { presses: DEFAULT_PRESSES });
  await batch.commit();
}

// One-time self-migration: move old users/{uid}.plants array → plant docs + member docs + plantIds
async function _migratePlantsToNewStructure(plants) {
  try {
    const batch = writeBatch(db);
    for (const p of plants) {
      // Write plant doc only if it doesn't already have one
      batch.set(doc(db, 'plants', p.id), { name: p.name, location: p.location || '', isActive: true }, { merge: true });
      // Write member doc — caller gets admin
      batch.set(plantMemberDocRef(p.id, currentUser.uid), {
        userId: currentUser.uid,
        displayName: currentUser.displayName || currentUser.email || '',
        email: currentUser.email || '',
        photoURL: currentUser.photoURL || '',
        role: 'admin',
        isActive: true,
        addedAt: serverTimestamp(),
        permissions: { ...DEFAULT_PERMISSIONS }
      }, { merge: true });
    }
    // Switch user doc from plants array to plantIds array
    batch.set(doc(db, 'users', currentUser.uid), { plantIds: plants.map(p => p.id) }, { merge: true });
    await batch.commit();
  } catch(e) {
    console.warn('Plant structure migration failed (non-fatal):', e);
  }
}

// Load current user's member doc for the given plant; set role + permissions + update UI
async function loadCurrentMember(plantId) {
  const sqlBootstrap = await ensureSqlPlantBootstrap(plantId);
  if (sqlBootstrap?.member) {
    currentUserPermissions = { ...DEFAULT_PERMISSIONS, ...(sqlBootstrap.member.permissions || {}) };
    currentUserRole = normalizeMemberRole(sqlBootstrap.member.role) || 'editor';
    applyRoleUI();
    return;
  }
  if (shouldUseSqlStagingReads(plantId)) {
    const payload = await requireSqlRead(
      `member ${plantId}:${currentUser.uid}`,
      () => dataApi.listPlantMembers(plantId, { active: false }),
      `Current user member record is missing in D1 for plant ${plantId}.`
    );
    const member = (payload?.members || []).find(entry => (entry.uid || entry.id) === currentUser.uid) || null;
    if (!member || member.isActive === false) {
      throw new Error(`Current user is not an active D1 member for plant ${plantId}.`);
    }
    currentUserPermissions = { ...DEFAULT_PERMISSIONS, ...(member.permissions || {}) };
    currentUserRole = normalizeMemberRole(member.role) || 'editor';
    applyRoleUI();
    return;
  }
  try {
    const snap = await getDoc(plantMemberDocRef(plantId, currentUser.uid));
    if (snap.exists()) {
      const d = snap.data();
      currentUserPermissions = { ...DEFAULT_PERMISSIONS, ...(d.permissions || {}) };
      const normalizedRole = normalizeMemberRole(d.role);
      const inferAdminFromLegacyPerms = !normalizedRole
        && currentUserPermissions.canManageStatuses
        && currentUserPermissions.canManagePresses
        && currentUserPermissions.canExport;
      currentUserRole = normalizedRole || (inferAdminFromLegacyPerms ? 'admin' : 'editor');
    } else {
      // No member doc yet — treat as admin (during migration window)
      currentUserRole = 'admin';
      currentUserPermissions = { ...DEFAULT_PERMISSIONS };
    }
  } catch(e) {
    console.warn('Could not load member doc, defaulting to admin', e);
    currentUserRole = 'admin';
    currentUserPermissions = { ...DEFAULT_PERMISSIONS };
  }
  applyRoleUI();
}

// Show/hide UI elements based on current user's permissions
function applyRoleUI() {
  const isAdmin = !DEMO_MODE && currentUserRole === 'admin';

  const adminPageBtn = document.getElementById('admin-page-btn');
  if (adminPageBtn) adminPageBtn.style.display = isAdmin ? '' : 'none';

  const exportBtn = document.getElementById('export-pdf-btn');
  if (exportBtn) exportBtn.style.display = currentUserPermissions.canExport ? '' : 'none';
  const excelBtn = document.getElementById('export-excel-btn');
  if (excelBtn) excelBtn.style.display = currentUserPermissions.canExport ? '' : 'none';
  const adminPanelBtn = document.getElementById('admin-panel-btn');
  if (adminPanelBtn) adminPanelBtn.style.display = isAdmin ? '' : 'none';
  const membersBtn = document.getElementById('members-btn');
  if (membersBtn) membersBtn.style.display = isAdmin ? '' : 'none';
}

// Load press layout for current plant
async function loadPlantPresses() {
  const sqlBootstrap = await ensureSqlPlantBootstrap(currentPlantId);
  if (sqlBootstrap?.pressConfig?.presses) {
    PRESSES = sqlBootstrap.pressConfig.presses;
    ALL_MACHINES = Object.values(PRESSES).flat();
    return;
  }
  if (shouldUseSqlStagingReads(currentPlantId)) {
    const payload = await requireSqlRead(
      `press config ${currentPlantId}`,
      () => dataApi.getPressConfig(currentPlantId),
      `Press config is missing in D1 for plant ${currentPlantId}.`
    );
    const sqlPresses = payload?.pressConfig?.presses || null;
    if (!sqlPresses || typeof sqlPresses !== 'object') {
      throw new Error(`Press config is missing in D1 for plant ${currentPlantId}.`);
    }
    PRESSES = sqlPresses;
    ALL_MACHINES = Object.values(PRESSES).flat();
    return;
  }
  try {
    const snap = await getDoc(plantDoc('config', 'presses'));
    if (snap.exists() && snap.data().presses) {
      PRESSES = snap.data().presses;
    } else {
      PRESSES = { ...DEFAULT_PRESSES };
    }
    ALL_MACHINES = Object.values(PRESSES).flat();
  } catch(e) {
    console.warn('Press layout load failed, using defaults', e);
    PRESSES = { ...DEFAULT_PRESSES };
    ALL_MACHINES = Object.values(PRESSES).flat();
  }
}

// Switch plant
async function switchPlant(plantId) {
  if (plantId === currentPlantId) return;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  stopStatusConfigListener();
  stopRoleFeedAlertsWatcher();
  clearRoleAlertBadge();
  if (typeof closeNotesModal === 'function') closeNotesModal();
  currentPlantId = plantId;
  currentPlantName = (userPlants.find(p => p.id === plantId) || {}).name || plantId;
  document.getElementById('plant-name-display').textContent = currentPlantName;
  // Save last plant to user doc
  if (shouldUseSqlBootstrap()) {
    try {
      await dataApi.updateCurrentUserContext({ lastPlantId: currentPlantId });
      currentUserProfileData = { ...currentUserProfileData, lastPlant: currentPlantId };
    } catch (e) {
      console.warn('Could not persist last plant in D1', e);
    }
  } else {
    try { await setDoc(doc(db, 'users', currentUser.uid), { lastPlant: currentPlantId }, { merge: true }); } catch(e) {}
  }
  try { localStorage.setItem('apTrackerLastPlant', currentPlantId); } catch(e) {}
  buildPlantDropdown();
  closePlantDropdown();
  issues = [];
  issuesById.clear();
  issueHistoryCursor = null;
  issueHistoryFetchInFlight = null;
  attachmentPhotoCache.clear();
  issueEventHistoryCache.clear();
  attachmentsHydrationToken++;
  eventsHydrationToken++;
  scheduledPressesState = null; // clear so new plant reloads schedule
  issueShiftFilter = 'all';
  syncShiftFilterUi();
  setSyncStatus('', 'Switching plant…');
  await hydrateCurrentPlantView();
  await hydrateLocalIssueOutboxForCurrentPlant();
  gameConfig = null;
  await ensureGamificationConfig();
  await backfillGlobalXpIfNeeded();
  startGamificationListeners();
  startListener();
  scheduleIssueOutboxFlush();
  _startMessagingInboxWatcher();
  startRoleFeedAlertsWatcher();
  refreshVisibleData();
}

const plantDropdown = createDropdownController({
  dropdownId: 'plant-dropdown',
  buttonId: 'plant-switcher-btn',
  wrapId: 'plant-switcher-wrap'
});

// Plant dropdown UI
function buildPlantDropdown() {
  const dd = document.getElementById('plant-dropdown');
  if (!dd) return;
  dd.innerHTML = '';
  // Sort plants alphabetically by name for a consistent, predictable order
  const sorted = [...userPlants].sort((a, b) => a.name.localeCompare(b.name));
  sorted.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'plant-opt' + (p.id === currentPlantId ? ' active' : '');
    btn.innerHTML = `<span class="plant-opt-check">${p.id === currentPlantId ? '✓' : ''}</span><span class="plant-opt-name">${esc(p.name)}</span>${p.location ? '<span class="plant-opt-loc">'+esc(p.location)+'</span>' : ''}`;
    btn.onclick = () => switchPlant(p.id);
    dd.appendChild(btn);
  });
}

window.togglePlantDropdown = plantDropdown.toggle;

function closePlantDropdown() {
  plantDropdown.close();
}

plantDropdown.bindOutsideClick();

document.addEventListener('click', e => {
  const drawer = document.getElementById('game-drawer');
  const gamePills = Array.from(document.querySelectorAll('.game-pill'));
  const gamePillEl = document.getElementById('game-pill');
  const clickedPill = gamePills.some(pill => pill.contains(e.target)) || (gamePillEl && gamePillEl.contains(e.target));
  if (drawer && gameDrawerOpen && !drawer.contains(e.target) && !clickedPill) {
    toggleGameDrawer(false);
  }
});
// ── SINGLE SOURCE OF TRUTH FOR STATUSES ──
// Loaded from Firestore config doc on startup. Edit via the admin panel (user menu → Manage Statuses).
let STATUSES = {
  open:            { label:'Open',             shortLabel:'Open',         icon:'●',  cssColor:'var(--color-danger, var(--red))',      swipeColor:'#ef4444', floorCls:'has-open',            cls:'status-open',            subs:['New Fault / Issue','Pending Triage','Scheduled Mold Change','Re-opened'],                                               statLabel:'Open',          order:0 },
  alert:           { label:'Alert',            shortLabel:'Alert',        icon:'🚨', cssColor:'#dc2626',         swipeColor:'#dc2626', floorCls:'has-alert',           cls:'status-alert',           subs:['Mold Protection Fault','E-Stop / Safety Hazard','Press Down - Critical','Major Oil / Fluid Leak'],                   statLabel:'Alert',         order:1 },
  attention:       { label:'Attention',        shortLabel:'Attention',    icon:'◇',  cssColor:'#0ea5e9',         swipeColor:'#0ea5e9', floorCls:'has-attention',       cls:'status-attention',       subs:['Watch Item','Needs Follow-up','Housekeeping','PM Opportunity','Operator Note','Check Next Run'],                  statLabel:'Attention',     order:1.5 },
  controlman:      { label:'Controlman',       shortLabel:'Controlman',   icon:'🎛️', cssColor:'var(--color-babyblue, var(--babyblue))', swipeColor:'#38bdf8', floorCls:'has-controlman',      cls:'status-controlman',      subs:['Color Change','Mold Change','Robot / EOAT (End of Arm Tooling) Fault','Vision System / Camera Error','Conveyor / Auxiliary Comm Loss','PLC / HMI Error'], statLabel:'Controlman',    order:2 },
  maintenance:     { label:'Maintenance',      shortLabel:'Maintenance',  icon:'🔧', cssColor:'var(--color-warning, var(--yellow))',   swipeColor:'#eab308', floorCls:'has-maintenance',     cls:'status-maintenance',     subs:['Hydraulic Leak / Pressure Drop','Heater Band / Thermocouple Failure','Barrel / Screw / Check Ring Issue','Chiller / Thermolator Failure'], statLabel:'Maintenance',   order:3 },
  materials:       { label:'Materials',        shortLabel:'Materials',    icon:'📦', cssColor:'#8b5cf6',         swipeColor:'#8b5cf6', floorCls:'has-materials',       cls:'status-materials',       subs:['Resin Moisture / Drying Issue','Colorant / Masterbatch Ratio Error','Vacuum / Material Loader Blockage','Wrong Resin / Regrind Issue'], statLabel:'Materials',     order:4 },
  processengineer: { label:'Process Engineer', shortLabel:'Process Eng.', icon:'⚙️', cssColor:'var(--color-purple, var(--purple))',   swipeColor:'#a855f7', floorCls:'has-processengineer', cls:'status-processengineer', subs:['Fill / Pack Pressure Adjustment','Temperature Profile Tuning','Cycle Time Optimization','Process Drift / Instability'], statLabel:'Process Eng.',  order:5 },
  quality:         { label:'Quality',          shortLabel:'Quality',      icon:'✨', cssColor:'#06b6d4',         swipeColor:'#06b6d4', floorCls:'has-quality',         cls:'status-quality',         subs:['Short Shot / Non-fill','Flash / Burrs','Sink Marks / Voids','Splay / Silver Streaks','Burn Marks / Degradation','Warp / Dimensional Out-of-Spec'], statLabel:'Quality',       order:6 },
  startup:         { label:'Startup',          shortLabel:'Startup',      icon:'🚀', cssColor:'var(--color-teal, var(--teal))',     swipeColor:'#14b8a6', floorCls:'has-startup',         cls:'status-startup',         subs:['Purging / Color Change','Mold Heat-Up / Stabilization','First Article Inspection (FAI)','Robot Homing / Path Setup'], statLabel:'Startup',       order:7 },
  tooldie:         { label:'Tool & Die',       shortLabel:'Tool & Die',   icon:'🔩', cssColor:'var(--color-orange, var(--orange))',   swipeColor:'#f97316', floorCls:'has-tooldie',         cls:'status-tooldie',         subs:['Broken / Bent Ejector Pin','Hot Runner / Gate Issue','Water Leak in Mold','Stuck Part / Sprue','Mold Greasing / PM'], statLabel:'Tool & Die',    order:8 },
  resolved:        { label:'Resolved',         shortLabel:'Resolved',     icon:'✓',  cssColor:'var(--color-success, var(--green))',    swipeColor:'#22c55e', floorCls:'all-resolved',        cls:'status-resolved',        subs:['Process Parameter Adjusted','Mold Cleaned / Repaired','Hardware Replaced','Temporary Workaround'],                      statLabel:'Resolved',      order:9 },
};
const DEFAULT_STATUSES = JSON.parse(JSON.stringify(STATUSES));
const CANONICAL_OPTIONAL_STATUSES = {
  attention: JSON.parse(JSON.stringify(STATUSES.attention))
};

// ── MASCOT CHARACTERS ──
// Animated SVG characters, one per job role. Appear in status swipe panels and empty states.
const MASCOTS = {
  maintenance: {
    name: 'TORCH', color: '#eab308',
    tagline: '"The floor runs hot. So do I."',
    svg(w=180,h=180){return `<svg width="${w}" height="${h}" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="90" cy="165" rx="38" ry="6" fill="rgba(0,0,0,0.4)"/><g class="mascot-flame-body"><path d="M90 155 C50 155 28 128 30 100 C32 78 44 65 50 50 C56 35 52 18 58 10 C62 4 68 8 66 18 C64 28 70 24 74 16 C78 8 84 12 82 22 C80 32 88 28 88 18 C88 10 96 8 96 18 C96 28 102 22 100 12 C98 4 106 2 108 12 C112 28 120 38 128 55 C136 72 150 88 150 108 C150 135 126 155 90 155Z" fill="#1a1600" stroke="#eab308" stroke-width="2.5"/><path d="M90 145 C62 145 46 126 48 104 C50 86 60 74 66 62 C70 52 68 38 72 30 C76 22 80 28 78 36 C76 44 82 40 84 32 C86 24 92 28 90 36 C88 44 96 40 94 30 C92 22 100 20 100 32 C100 42 108 36 106 26 C108 38 118 52 122 70 C128 90 134 104 132 116 C130 135 114 145 90 145Z" fill="rgba(245,166,35,0.18)"/><ellipse cx="90" cy="100" rx="32" ry="34" fill="#111000"/><ellipse cx="78" cy="96" rx="8" ry="9" fill="#eab308"/><ellipse cx="102" cy="96" rx="8" ry="9" fill="#eab308"/><circle cx="78" cy="97" r="4.5" fill="#0f1117"/><circle cx="102" cy="97" r="4.5" fill="#0f1117"/><circle cx="80" cy="94" r="2" fill="white" opacity="0.8"/><circle cx="104" cy="94" r="2" fill="white" opacity="0.8"/><path d="M76 112 Q90 121 104 112" stroke="#eab308" stroke-width="3" stroke-linecap="round" fill="none"/><rect x="82" y="114" width="7" height="5" rx="2" fill="#eab308"/><rect x="91" y="114" width="7" height="5" rx="2" fill="#eab308"/><ellipse cx="90" cy="48" rx="30" ry="11" fill="#eab308"/><rect x="62" y="44" width="56" height="10" rx="5" fill="#ca8a04"/><rect x="58" y="51" width="64" height="5" rx="2.5" fill="#eab308" opacity="0.55"/></g><g class="mascot-wrench-anim"><rect x="70" y="140" width="40" height="12" rx="6" fill="#1a1600" stroke="#eab308" stroke-width="2"/><circle cx="70" cy="146" r="8" fill="#1a1600" stroke="#eab308" stroke-width="2"/><circle cx="70" cy="146" r="4" fill="transparent" stroke="#eab308" stroke-width="2"/><circle cx="110" cy="146" r="8" fill="#1a1600" stroke="#eab308" stroke-width="2"/><circle cx="110" cy="146" r="4" fill="transparent" stroke="#eab308" stroke-width="2"/></g></svg>`;}
  },
  tooldie: {
    name: 'GAUGE', color: '#f97316',
    tagline: '"Everything spins around precision."',
    svg(w=180,h=180){return `<svg width="${w}" height="${h}" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="90" cy="170" rx="32" ry="5" fill="rgba(0,0,0,0.4)"/><g class="mascot-gear-outer"><circle cx="90" cy="86" r="74" fill="none" stroke="#c2410c" stroke-width="3"/><rect x="86" y="7" width="8" height="14" rx="2" fill="#c2410c"/><rect x="86" y="151" width="8" height="14" rx="2" fill="#c2410c"/><rect x="7" y="82" width="14" height="8" rx="2" fill="#c2410c"/><rect x="151" y="82" width="14" height="8" rx="2" fill="#c2410c"/><rect x="30" y="26" width="8" height="14" rx="2" fill="#c2410c" transform="rotate(45 34 33)"/><rect x="130" y="130" width="8" height="14" rx="2" fill="#c2410c" transform="rotate(45 134 137)"/><rect x="130" y="26" width="8" height="14" rx="2" fill="#c2410c" transform="rotate(-45 134 33)"/><rect x="30" y="130" width="8" height="14" rx="2" fill="#c2410c" transform="rotate(-45 34 137)"/><rect x="14" y="55" width="14" height="8" rx="2" fill="#c2410c" transform="rotate(30 21 59)"/><rect x="150" y="115" width="14" height="8" rx="2" fill="#c2410c" transform="rotate(30 157 119)"/><rect x="150" y="55" width="14" height="8" rx="2" fill="#c2410c" transform="rotate(-30 157 59)"/><rect x="14" y="115" width="14" height="8" rx="2" fill="#c2410c" transform="rotate(-30 21 119)"/></g><g class="mascot-gear-inner"><circle cx="90" cy="86" r="50" fill="none" stroke="#ea580c" stroke-width="2"/><rect x="87" y="31" width="6" height="10" rx="2" fill="#ea580c"/><rect x="87" y="131" width="6" height="10" rx="2" fill="#ea580c"/><rect x="35" y="83" width="10" height="6" rx="2" fill="#ea580c"/><rect x="135" y="83" width="10" height="6" rx="2" fill="#ea580c"/><rect x="51" y="47" width="6" height="10" rx="2" fill="#ea580c" transform="rotate(45 54 52)"/><rect x="123" y="119" width="6" height="10" rx="2" fill="#ea580c" transform="rotate(45 126 124)"/><rect x="123" y="47" width="6" height="10" rx="2" fill="#ea580c" transform="rotate(-45 126 52)"/><rect x="51" y="119" width="6" height="10" rx="2" fill="#ea580c" transform="rotate(-45 54 124)"/></g><g class="mascot-gauge-body"><circle cx="90" cy="86" r="36" fill="#1c0d00" stroke="#f97316" stroke-width="2.5"/><circle cx="78" cy="82" r="13" fill="rgba(251,191,36,0.08)" stroke="#fdba74" stroke-width="2.5"/><circle cx="102" cy="82" r="13" fill="rgba(251,191,36,0.08)" stroke="#fdba74" stroke-width="2.5"/><line x1="91" y1="82" x2="89" y2="82" stroke="#fdba74" stroke-width="2.5" stroke-linecap="round"/><line x1="65" y1="82" x2="56" y2="84" stroke="#fdba74" stroke-width="2" stroke-linecap="round"/><line x1="115" y1="82" x2="124" y2="84" stroke="#fdba74" stroke-width="2" stroke-linecap="round"/><circle cx="78" cy="82" r="6" fill="#f97316"/><circle cx="102" cy="82" r="6" fill="#f97316"/><circle cx="78" cy="82" r="3.5" fill="#0f1117"/><circle cx="102" cy="82" r="3.5" fill="#0f1117"/><circle cx="79.5" cy="80" r="1.5" fill="white" opacity="0.7"/><circle cx="103.5" cy="80" r="1.5" fill="white" opacity="0.7"/><line x1="80" y1="98" x2="100" y2="98" stroke="#f97316" stroke-width="3" stroke-linecap="round"/><rect x="40" y="98" width="18" height="8" rx="4" fill="#1c0d00" stroke="#f97316" stroke-width="1.5"/><rect x="122" y="98" width="18" height="8" rx="4" fill="#1c0d00" stroke="#f97316" stroke-width="1.5"/><rect x="75" y="120" width="13" height="18" rx="6" fill="#1c0d00" stroke="#f97316" stroke-width="1.5"/><rect x="92" y="120" width="13" height="18" rx="6" fill="#1c0d00" stroke="#f97316" stroke-width="1.5"/><rect x="72" y="132" width="19" height="10" rx="4" fill="#431407"/><rect x="89" y="132" width="19" height="10" rx="4" fill="#431407"/><rect x="72" y="132" width="7" height="10" rx="3" fill="#ea580c"/><rect x="89" y="132" width="7" height="10" rx="3" fill="#ea580c"/></g></svg>`;}
  },
  controlman: {
    name: 'SETTER', color: '#38bdf8',
    tagline: '"Two halves. One perfect part."',
    svg(w=180,h=180){return `<svg width="${w}" height="${h}" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="90" cy="172" rx="34" ry="5" fill="rgba(0,0,0,0.35)"/><ellipse cx="90" cy="96" rx="18" ry="22" fill="rgba(56,189,248,0.2)" stroke="#38bdf8" stroke-width="1" opacity="0.6"/><ellipse class="mascot-mold-seam" cx="90" cy="96" rx="10" ry="14" fill="rgba(56,189,248,0.35)"/><g class="mascot-mold-left"><path d="M90 30 L52 46 L44 80 L44 115 L52 148 L90 162 Z" fill="#071e2a" stroke="#38bdf8" stroke-width="2.5"/><line x1="56" y1="60" x2="78" y2="60" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.5"/><line x1="52" y1="80" x2="78" y2="80" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.5"/><line x1="52" y1="100" x2="78" y2="100" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.5"/><line x1="52" y1="120" x2="78" y2="120" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.5"/><circle cx="62" cy="72" r="3" fill="#38bdf8" opacity="0.6"/><circle cx="62" cy="110" r="3" fill="#38bdf8" opacity="0.6"/><ellipse cx="68" cy="86" rx="9" ry="10" fill="#38bdf8"/><circle cx="68" cy="87" r="5" fill="#0f1117"/><circle cx="70" cy="84" r="2" fill="white" opacity="0.7"/><rect x="26" y="88" width="22" height="9" rx="4.5" fill="#071e2a" stroke="#38bdf8" stroke-width="1.8"/><rect x="56" y="148" width="14" height="20" rx="6" fill="#071e2a" stroke="#38bdf8" stroke-width="1.8"/><rect x="52" y="161" width="21" height="10" rx="4" fill="#0c3d6e"/><rect x="52" y="161" width="8" height="10" rx="3" fill="#38bdf8" opacity="0.7"/></g><g class="mascot-mold-right"><path d="M90 30 L128 46 L136 80 L136 115 L128 148 L90 162 Z" fill="#071e2a" stroke="#38bdf8" stroke-width="2.5"/><line x1="102" y1="60" x2="124" y2="60" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.5"/><line x1="102" y1="80" x2="128" y2="80" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.5"/><line x1="102" y1="100" x2="128" y2="100" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.5"/><line x1="102" y1="120" x2="128" y2="120" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.5"/><circle cx="118" cy="72" r="3" fill="#38bdf8" opacity="0.6"/><circle cx="118" cy="110" r="3" fill="#38bdf8" opacity="0.6"/><ellipse cx="112" cy="86" rx="9" ry="10" fill="#38bdf8"/><circle cx="112" cy="87" r="5" fill="#0f1117"/><circle cx="114" cy="84" r="2" fill="white" opacity="0.7"/><rect x="132" y="88" width="22" height="9" rx="4.5" fill="#071e2a" stroke="#38bdf8" stroke-width="1.8"/><rect x="110" y="148" width="14" height="20" rx="6" fill="#071e2a" stroke="#38bdf8" stroke-width="1.8"/><rect x="107" y="161" width="21" height="10" rx="4" fill="#0c3d6e"/><rect x="107" y="161" width="8" height="10" rx="3" fill="#38bdf8" opacity="0.7"/></g><path d="M78 112 Q90 120 102 112" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" fill="none"/><line x1="90" y1="30" x2="90" y2="162" stroke="#38bdf8" stroke-width="1" stroke-dasharray="5 4" opacity="0.3"/></svg>`;}
  },
  startup: {
    name: 'CINDER', color: '#14b8a6',
    tagline: '"Cold metal? Not on my watch."',
    svg(w=180,h=180){return `<svg width="${w}" height="${h}" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="90" cy="170" rx="32" ry="5" fill="rgba(0,0,0,0.35)"/><circle class="mascot-heat-ring-3" cx="90" cy="90" r="70" fill="none" stroke="#14b8a6" stroke-width="2" stroke-dasharray="9 6" opacity="0.25"/><circle class="mascot-heat-ring-2" cx="90" cy="90" r="55" fill="none" stroke="#14b8a6" stroke-width="3" stroke-dasharray="11 5" opacity="0.4"/><circle class="mascot-heat-ring-1" cx="90" cy="90" r="40" fill="none" stroke="#14b8a6" stroke-width="4" stroke-dasharray="12 4" opacity="0.65"/><g class="mascot-ramp-body"><circle cx="90" cy="90" r="30" fill="rgba(20,184,166,0.12)" stroke="#14b8a6" stroke-width="0.5"/><circle cx="90" cy="90" r="27" fill="#071a18" stroke="#14b8a6" stroke-width="2.5"/><path d="M73 76 Q79 70 85 74" stroke="#14b8a6" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M95 74 Q101 70 107 76" stroke="#14b8a6" stroke-width="2.5" stroke-linecap="round" fill="none"/><ellipse cx="80" cy="86" rx="8" ry="8.5" fill="#14b8a6"/><ellipse cx="100" cy="86" rx="8" ry="8.5" fill="#14b8a6"/><circle cx="80" cy="87" r="4.5" fill="#0f1117"/><circle cx="100" cy="87" r="4.5" fill="#0f1117"/><circle cx="82" cy="84" r="2" fill="white" opacity="0.8"/><circle cx="102" cy="84" r="2" fill="white" opacity="0.8"/><path d="M74 101 Q90 114 106 101" stroke="#14b8a6" stroke-width="3" stroke-linecap="round" fill="none"/><rect x="80" y="104" width="8" height="5" rx="2" fill="#14b8a6"/><rect x="90" y="104" width="8" height="5" rx="2" fill="#14b8a6"/><g class="mascot-heat-waves"><path d="M70 52 Q74 44 78 52 Q82 44 86 52" stroke="#14b8a6" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.8"/><path d="M84 48 Q88 40 92 48 Q96 40 100 48" stroke="#14b8a6" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M98 52 Q102 44 106 52 Q110 44 114 52" stroke="#14b8a6" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.8"/></g><rect x="44" y="84" width="21" height="9" rx="4.5" fill="#071a18" stroke="#14b8a6" stroke-width="1.8"/><rect x="115" y="84" width="21" height="9" rx="4.5" fill="#071a18" stroke="#14b8a6" stroke-width="1.8"/><rect x="77" y="116" width="12" height="18" rx="5" fill="#071a18" stroke="#14b8a6" stroke-width="1.8"/><rect x="91" y="116" width="12" height="18" rx="5" fill="#071a18" stroke="#14b8a6" stroke-width="1.8"/><rect x="73" y="128" width="20" height="9" rx="4" fill="#0a3530"/><rect x="87" y="128" width="20" height="9" rx="4" fill="#0a3530"/><rect x="73" y="128" width="8" height="9" rx="3" fill="#14b8a6" opacity="0.7"/><rect x="87" y="128" width="8" height="9" rx="3" fill="#14b8a6" opacity="0.7"/></g></svg>`;}
  },
  quality: {
    name: 'SPEC', color: '#06b6d4',
    tagline: '"I see everything. Everything."',
    svg(w=180,h=180){return `<svg width="${w}" height="${h}" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="90" cy="172" rx="28" ry="5" fill="rgba(0,0,0,0.3)"/><g class="mascot-mag-body"><ellipse class="mascot-scan-beam" cx="82" cy="76" rx="44" ry="44" fill="rgba(6,182,212,0.08)"/><circle cx="82" cy="76" r="52" fill="#071520" stroke="#06b6d4" stroke-width="4"/><path d="M50 50 Q66 44 78 52" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.15"/><ellipse cx="82" cy="33" rx="14" ry="10" fill="#06b6d4" opacity="0.85"/><rect x="78" y="30" width="8" height="14" rx="4" fill="#06b6d4"/><ellipse cx="70" cy="72" rx="9" ry="10" fill="#06b6d4"/><ellipse cx="94" cy="72" rx="9" ry="10" fill="#06b6d4"/><circle cx="70" cy="73" r="5" fill="#0f1117"/><circle cx="94" cy="73" r="5" fill="#0f1117"/><circle cx="72" cy="70" r="2.2" fill="white" opacity="0.8"/><circle cx="96" cy="70" r="2.2" fill="white" opacity="0.8"/><path d="M60 60 Q70 56 79 60" stroke="#06b6d4" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M85 60 Q94 56 104 60" stroke="#06b6d4" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M68 90 Q82 97 96 90" stroke="#06b6d4" stroke-width="2.5" stroke-linecap="round" fill="none"/><rect x="12" y="92" width="26" height="34" rx="4" fill="#071520" stroke="#06b6d4" stroke-width="1.8"/><rect x="18" y="88" width="14" height="6" rx="3" fill="#06b6d4" opacity="0.8"/><line x1="18" y1="102" x2="32" y2="102" stroke="#06b6d4" stroke-width="1.5" opacity="0.7"/><line x1="18" y1="108" x2="32" y2="108" stroke="#06b6d4" stroke-width="1.5" opacity="0.7"/><rect x="78" y="126" width="16" height="38" rx="8" fill="#071520" stroke="#06b6d4" stroke-width="2.5"/><line x1="81" y1="136" x2="91" y2="136" stroke="#06b6d4" stroke-width="1.5" opacity="0.5"/><line x1="81" y1="142" x2="91" y2="142" stroke="#06b6d4" stroke-width="1.5" opacity="0.5"/><line x1="81" y1="148" x2="91" y2="148" stroke="#06b6d4" stroke-width="1.5" opacity="0.5"/><rect x="66" y="158" width="22" height="10" rx="5" fill="#0e4d6b"/><rect x="88" y="158" width="22" height="10" rx="5" fill="#0e4d6b"/><rect x="66" y="158" width="9" height="10" rx="4" fill="#06b6d4" opacity="0.6"/><rect x="88" y="158" width="9" height="10" rx="4" fill="#06b6d4" opacity="0.6"/></g></svg>`;}
  },
  processengineer: {
    name: 'SIGMA', color: '#a855f7',
    tagline: '"The trend line never lies. Usually."',
    svg(w=180,h=180){return `<svg width="${w}" height="${h}" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="90" cy="172" rx="36" ry="5" fill="rgba(0,0,0,0.3)"/><g class="mascot-sigma-body"><rect x="20" y="90" width="140" height="74" rx="8" fill="#12083a" stroke="#a855f7" stroke-width="1.5" opacity="0.7"/><line x1="20" y1="110" x2="160" y2="110" stroke="#a855f7" stroke-width="0.5" opacity="0.3"/><line x1="20" y1="127" x2="160" y2="127" stroke="#a855f7" stroke-width="0.5" opacity="0.3"/><line x1="20" y1="144" x2="160" y2="144" stroke="#a855f7" stroke-width="0.5" opacity="0.3"/><line x1="55" y1="90" x2="55" y2="164" stroke="#a855f7" stroke-width="0.5" opacity="0.3"/><line x1="90" y1="90" x2="90" y2="164" stroke="#a855f7" stroke-width="0.5" opacity="0.3"/><line x1="125" y1="90" x2="125" y2="164" stroke="#a855f7" stroke-width="0.5" opacity="0.3"/><rect x="30" y="138" width="10" height="22" rx="2" fill="#a855f7" opacity="0.5"/><rect x="44" y="122" width="10" height="38" rx="2" fill="#a855f7" opacity="0.7"/><rect x="58" y="110" width="10" height="50" rx="2" fill="#a855f7" opacity="0.9"/><rect x="72" y="118" width="10" height="42" rx="2" fill="#a855f7" opacity="0.75"/><rect x="86" y="104" width="10" height="56" rx="2" fill="#a855f7"/><rect x="100" y="112" width="10" height="48" rx="2" fill="#a855f7" opacity="0.8"/><rect x="114" y="120" width="10" height="40" rx="2" fill="#a855f7" opacity="0.65"/><rect x="128" y="128" width="10" height="32" rx="2" fill="#a855f7" opacity="0.5"/><rect x="142" y="116" width="10" height="44" rx="2" fill="#a855f7" opacity="0.7"/><polyline class="mascot-wave-line" points="35,137 49,121 63,109 77,117 91,103 105,111 119,119 133,127 147,115" stroke="#d8b4fe" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle class="mascot-data-node" cx="35" cy="137" r="4" fill="#d8b4fe" style="animation-delay:0s"/><circle class="mascot-data-node" cx="63" cy="109" r="4" fill="#d8b4fe" style="animation-delay:0.4s"/><circle class="mascot-data-node" cx="91" cy="103" r="4" fill="#d8b4fe" style="animation-delay:0.8s"/><circle class="mascot-data-node" cx="119" cy="119" r="4" fill="#d8b4fe" style="animation-delay:1.2s"/><circle class="mascot-data-node" cx="147" cy="115" r="4" fill="#d8b4fe" style="animation-delay:1.6s"/><circle cx="90" cy="60" r="30" fill="#190c34" stroke="#a855f7" stroke-width="2.5"/><path d="M64 46 Q72 28 90 32 Q108 28 116 46" fill="#a855f7" opacity="0.5"/><circle cx="79" cy="59" r="10" fill="none" stroke="#a855f7" stroke-width="2.2"/><circle cx="101" cy="59" r="10" fill="none" stroke="#a855f7" stroke-width="2.2"/><line x1="89" y1="59" x2="91" y2="59" stroke="#a855f7" stroke-width="2" stroke-linecap="round"/><line x1="69" y1="59" x2="62" y2="61" stroke="#a855f7" stroke-width="1.8" stroke-linecap="round"/><line x1="111" y1="59" x2="118" y2="61" stroke="#a855f7" stroke-width="1.8" stroke-linecap="round"/><circle cx="79" cy="60" r="5.5" fill="#d8b4fe" opacity="0.9"/><circle cx="101" cy="60" r="5.5" fill="#d8b4fe" opacity="0.9"/><circle cx="79" cy="60" r="3" fill="#0f1117"/><circle cx="101" cy="60" r="3" fill="#0f1117"/><circle cx="80.5" cy="58" r="1.5" fill="white" opacity="0.7"/><circle cx="102.5" cy="58" r="1.5" fill="white" opacity="0.7"/><path d="M80 74 Q90 79 100 74" stroke="#a855f7" stroke-width="2" stroke-linecap="round" fill="none"/><rect x="0" y="106" width="24" height="9" rx="4.5" fill="#190c34" stroke="#a855f7" stroke-width="1.8"/><rect x="156" y="106" width="24" height="9" rx="4.5" fill="#190c34" stroke="#a855f7" stroke-width="1.8"/></g></svg>`;}
  },
  materials: {
    name: 'LIFT', color: '#8b5cf6',
    tagline: '"I don\'t drive the forklift. I am the forklift."',
    svg(w=180,h=180){return `<svg width="${w}" height="${h}" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="90" cy="176" rx="50" ry="5" fill="rgba(0,0,0,0.45)"/><g class="mascot-lift-chassis"><rect x="24" y="112" width="124" height="44" rx="10" fill="#160c20" stroke="#8b5cf6" stroke-width="2.5"/><rect x="32" y="120" width="30" height="28" rx="4" fill="rgba(139,92,246,0.1)" stroke="#8b5cf6" stroke-width="1"/><rect x="68" y="120" width="30" height="28" rx="4" fill="rgba(139,92,246,0.1)" stroke="#8b5cf6" stroke-width="1"/><rect x="104" y="120" width="36" height="28" rx="4" fill="rgba(139,92,246,0.15)" stroke="#8b5cf6" stroke-width="1"/><line x1="108" y1="126" x2="136" y2="126" stroke="#8b5cf6" stroke-width="1.2" opacity="0.6"/><line x1="108" y1="130" x2="136" y2="130" stroke="#8b5cf6" stroke-width="1.2" opacity="0.6"/><line x1="108" y1="134" x2="136" y2="134" stroke="#8b5cf6" stroke-width="1.2" opacity="0.6"/><line x1="108" y1="138" x2="136" y2="138" stroke="#8b5cf6" stroke-width="1.2" opacity="0.6"/><line x1="108" y1="142" x2="136" y2="142" stroke="#8b5cf6" stroke-width="1.2" opacity="0.6"/><rect x="138" y="116" width="18" height="36" rx="6" fill="#160c20" stroke="#8b5cf6" stroke-width="2"/></g><g class="mascot-lift-wheel" style="transform-origin:52px 160px"><circle cx="52" cy="160" r="18" fill="#111" stroke="#8b5cf6" stroke-width="2.5"/><circle cx="52" cy="160" r="10" fill="#160c20" stroke="#8b5cf6" stroke-width="1.5"/><line x1="52" y1="142" x2="52" y2="178" stroke="#8b5cf6" stroke-width="1.5" opacity="0.5"/><line x1="34" y1="160" x2="70" y2="160" stroke="#8b5cf6" stroke-width="1.5" opacity="0.5"/></g><g class="mascot-lift-wheel" style="transform-origin:128px 160px;animation-delay:-0.3s"><circle cx="128" cy="160" r="18" fill="#111" stroke="#8b5cf6" stroke-width="2.5"/><circle cx="128" cy="160" r="10" fill="#160c20" stroke="#8b5cf6" stroke-width="1.5"/><line x1="128" y1="142" x2="128" y2="178" stroke="#8b5cf6" stroke-width="1.5" opacity="0.5"/><line x1="110" y1="160" x2="146" y2="160" stroke="#8b5cf6" stroke-width="1.5" opacity="0.5"/></g><g class="mascot-lift-chassis"><rect x="20" y="52" width="10" height="72" rx="3" fill="#160c20" stroke="#8b5cf6" stroke-width="1.8"/><rect x="34" y="52" width="10" height="72" rx="3" fill="#160c20" stroke="#8b5cf6" stroke-width="1.8"/><line x1="20" y1="70" x2="44" y2="70" stroke="#8b5cf6" stroke-width="1.5" opacity="0.5"/><line x1="20" y1="90" x2="44" y2="90" stroke="#8b5cf6" stroke-width="1.5" opacity="0.5"/><line x1="20" y1="110" x2="44" y2="110" stroke="#8b5cf6" stroke-width="1.5" opacity="0.5"/></g><g class="mascot-lift-forks"><rect x="6" y="96" width="46" height="6" rx="3" fill="#8b5cf6"/><rect x="6" y="106" width="46" height="6" rx="3" fill="#8b5cf6"/><rect x="2" y="80" width="52" height="16" rx="3" fill="#1e0f38" stroke="#8b5cf6" stroke-width="1.5" opacity="0.8"/><rect x="8" y="70" width="40" height="12" rx="2" fill="#1e0f38" stroke="#8b5cf6" stroke-width="1" opacity="0.6"/></g><g class="mascot-lift-chassis"><rect x="58" y="64" width="80" height="52" rx="14" fill="#160c20" stroke="#8b5cf6" stroke-width="2.5"/><rect x="58" y="76" width="80" height="7" fill="#8b5cf6" opacity="0.3"/><rect x="58" y="100" width="80" height="7" fill="#8b5cf6" opacity="0.3"/><circle cx="98" cy="44" r="28" fill="#160c20" stroke="#8b5cf6" stroke-width="2.5"/><ellipse cx="98" cy="22" rx="30" ry="10" fill="#8b5cf6"/><rect x="70" y="18" width="56" height="10" rx="5" fill="#7c3aed"/><rect x="66" y="25" width="64" height="5" rx="2.5" fill="#8b5cf6" opacity="0.55"/><ellipse cx="86" cy="44" rx="9" ry="10" fill="#8b5cf6"/><ellipse cx="110" cy="44" rx="9" ry="10" fill="#8b5cf6"/><circle cx="86" cy="45" r="5" fill="#0f1117"/><circle cx="110" cy="45" r="5" fill="#0f1117"/><circle cx="88" cy="42" r="2.2" fill="white" opacity="0.8"/><circle cx="112" cy="42" r="2.2" fill="white" opacity="0.8"/><path d="M80 58 Q98 70 116 58" stroke="#8b5cf6" stroke-width="3.5" stroke-linecap="round" fill="none"/><rect x="138" y="72" width="26" height="11" rx="5.5" fill="#160c20" stroke="#8b5cf6" stroke-width="2"/></g></svg>`;}
  },
  alert: {
    name: 'HAZARD', color: '#dc2626',
    tagline: '"Nobody pushes me and walks away happy."',
    svg(w=180,h=180){return `<svg width="${w}" height="${h}" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="90" cy="174" rx="36" ry="5" fill="rgba(0,0,0,0.4)"/><circle class="mascot-estop-ring" cx="90" cy="84" r="72" fill="none" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="6 5" opacity="0.35"/><rect x="60" y="118" width="60" height="52" rx="6" fill="#1a0000" stroke="#dc2626" stroke-width="2"/><line x1="62" y1="128" x2="118" y2="128" stroke="#fbbf24" stroke-width="7" opacity="0.4"/><line x1="62" y1="144" x2="118" y2="144" stroke="#fbbf24" stroke-width="7" opacity="0.4"/><line x1="62" y1="160" x2="118" y2="160" stroke="#fbbf24" stroke-width="7" opacity="0.4"/><ellipse cx="90" cy="117" rx="37" ry="7.5" fill="#1a0000" stroke="#fbbf24" stroke-width="3"/><rect x="76" y="100" width="28" height="22" rx="4" fill="#1a0000" stroke="#dc2626" stroke-width="2"/><g class="mascot-estop-body"><circle cx="90" cy="85" r="44" fill="#7f1d1d"/><circle cx="90" cy="82" r="44" fill="#dc2626"/><circle cx="90" cy="82" r="40" fill="#ef4444"/><ellipse cx="77" cy="67" rx="14" ry="8" fill="rgba(255,255,255,0.16)" transform="rotate(-20 77 67)"/><ellipse cx="76" cy="82" rx="8" ry="9.5" fill="#1a0000"/><ellipse cx="104" cy="82" rx="8" ry="9.5" fill="#1a0000"/><circle cx="76" cy="83" r="5.5" fill="white"/><circle cx="104" cy="83" r="5.5" fill="white"/><circle cx="78" cy="81" r="2.5" fill="#1a0000"/><circle cx="106" cy="81" r="2.5" fill="#1a0000"/><circle cx="79" cy="79.5" r="1" fill="white" opacity="0.8"/><circle cx="107" cy="79.5" r="1" fill="white" opacity="0.8"/><path d="M68 72 Q76 67 84 70" stroke="#1a0000" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M96 70 Q104 67 112 72" stroke="#1a0000" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M76 97 Q90 91 104 97" stroke="#1a0000" stroke-width="3" stroke-linecap="round" fill="none"/><rect x="82" y="93" width="6" height="4" rx="1.5" fill="#1a0000"/><rect x="92" y="93" width="6" height="4" rx="1.5" fill="#1a0000"/></g><circle class="mascot-estop-ring" cx="90" cy="82" r="47" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-dasharray="8 6" opacity="0.75"/></svg>`;}
  },
  open: {
    name: 'KLAX', color: '#ef4444',
    tagline: '"I don\'t make the trouble. I just announce it."',
    svg(w=180,h=180){return `<svg width="${w}" height="${h}" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="90" cy="172" rx="30" ry="5" fill="rgba(0,0,0,0.35)"/><path class="mascot-bell-wave2" d="M22 112 Q22 26 90 12 Q158 26 158 112" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/><path class="mascot-bell-wave1" d="M38 118 Q38 44 90 32 Q142 44 142 118" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"/><g class="mascot-bell-body"><path d="M52 148 Q46 82 90 66 Q134 82 128 148Z" fill="#1a0000" stroke="#ef4444" stroke-width="2.5"/><path d="M54 148 Q48 86 90 70 Q132 86 126 148Z" fill="#ef4444"/><ellipse cx="72" cy="96" rx="10" ry="16" fill="rgba(255,255,255,0.13)" transform="rotate(-15 72 96)"/><ellipse cx="90" cy="148" rx="40" ry="10" fill="#ef4444" stroke="#dc2626" stroke-width="2.5"/><ellipse cx="78" cy="118" rx="8" ry="8.5" fill="#dc2626"/><ellipse cx="102" cy="118" rx="8" ry="8.5" fill="#dc2626"/><circle cx="78" cy="119" r="4.5" fill="#0f1117"/><circle cx="102" cy="119" r="4.5" fill="#0f1117"/><circle cx="80" cy="117" r="2" fill="white" opacity="0.8"/><circle cx="104" cy="117" r="2" fill="white" opacity="0.8"/><path d="M70 108 Q78 104 86 107" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M94 107 Q102 104 110 108" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M76 130 Q90 140 104 130" stroke="#dc2626" stroke-width="3" stroke-linecap="round" fill="none"/><rect x="86" y="146" width="8" height="14" rx="4" fill="#dc2626"/><circle cx="90" cy="162" r="6" fill="#dc2626" stroke="#1a0000" stroke-width="2"/><rect x="82" y="60" width="16" height="12" rx="4" fill="#7f1d1d"/></g></svg>`;}
  },
  resolved: {
    name: 'CLEAR', color: '#22c55e',
    tagline: '"Case closed. Press on."',
    svg(w=180,h=180){return `<svg width="${w}" height="${h}" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="90" cy="172" rx="32" ry="5" fill="rgba(0,0,0,0.3)"/><circle class="mascot-clear-glow" cx="90" cy="80" r="66" fill="rgba(34,197,94,0.06)"/><circle class="mascot-clear-glow" cx="90" cy="80" r="54" fill="rgba(34,197,94,0.09)" style="animation-delay:0.8s"/><rect x="74" y="140" width="32" height="30" rx="5" fill="#0a1f0f" stroke="#22c55e" stroke-width="2"/><rect x="70" y="136" width="40" height="10" rx="3" fill="#0a1f0f" stroke="#22c55e" stroke-width="2"/><line x1="82" y1="150" x2="98" y2="150" stroke="#22c55e" stroke-width="1.5" opacity="0.5"/><line x1="82" y1="158" x2="98" y2="158" stroke="#22c55e" stroke-width="1.5" opacity="0.5"/><rect x="82" y="130" width="16" height="14" rx="4" fill="#0a1f0f" stroke="#22c55e" stroke-width="2"/><g class="mascot-clear-dome"><circle cx="90" cy="80" r="52" fill="#0a1f0f" stroke="#22c55e" stroke-width="3"/><circle cx="90" cy="80" r="48" fill="#16a34a"/><circle cx="90" cy="80" r="44" fill="#22c55e"/><ellipse cx="75" cy="62" rx="14" ry="9" fill="rgba(255,255,255,0.18)" transform="rotate(-20 75 62)"/><ellipse cx="76" cy="80" rx="8" ry="8.5" fill="#0a1f0f"/><ellipse cx="104" cy="80" rx="8" ry="8.5" fill="#0a1f0f"/><circle cx="76" cy="81" r="5" fill="white"/><circle cx="104" cy="81" r="5" fill="white"/><circle cx="78" cy="79" r="2.5" fill="#0a1f0f"/><circle cx="106" cy="79" r="2.5" fill="#0a1f0f"/><circle cx="79" cy="78" r="1" fill="white" opacity="0.8"/><circle cx="107" cy="78" r="1" fill="white" opacity="0.8"/><path d="M70 70 Q76 66 82 69" stroke="#0a1f0f" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M98 69 Q104 66 110 70" stroke="#0a1f0f" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M74 94 Q90 106 106 94" stroke="#0a1f0f" stroke-width="3.5" stroke-linecap="round" fill="none"/><rect x="80" y="96" width="7" height="5" rx="2" fill="#0a1f0f"/><rect x="93" y="96" width="7" height="5" rx="2" fill="#0a1f0f"/></g><path class="mascot-clear-ray" d="M32 80 L16 80" stroke="#22c55e" stroke-width="3" stroke-linecap="round"/><path class="mascot-clear-ray" d="M148 80 L164 80" stroke="#22c55e" stroke-width="3" stroke-linecap="round" style="animation-delay:0.4s"/><path class="mascot-clear-ray" d="M48 37 L36 25" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" style="animation-delay:0.8s"/><path class="mascot-clear-ray" d="M132 37 L144 25" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" style="animation-delay:1.2s"/><path class="mascot-clear-ray" d="M90 24 L90 8" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" style="animation-delay:1.6s"/></svg>`;}
  },
};

// Derived helpers — do not edit
// ALL_STATUSES is now managed via rebuildDerivedStatus() — access as ALL_STATUSES
// ── CONFIG LOAD / SAVE ──

const STATUS_FALLBACK = {
  label: 'Unknown',
  shortLabel: 'Unknown',
  statLabel: 'Unknown',
  icon: '❔',
  cssColor: '#6b7280',
  swipeColor: '#6b7280',
  color: '#6b7280',
  subs: [],
  order: 999
};

function getStatusDef(statusKey) {
  return STATUSES[statusKey] || STATUS_FALLBACK;
}

function getStatusColor(statusKey) {
  const st = getStatusDef(statusKey);
  return st.swipeColor || st.cssColor || st.color || STATUS_FALLBACK.swipeColor;
}

// ── SUBCATEGORY SEARCH INDEX ──
let subToCats = {};

function buildSubToCats() {
  subToCats = {};
  Object.entries(STATUSES).forEach(([key, def]) => {
    (def.subs || []).forEach(sub => {
      if (!subToCats[sub]) subToCats[sub] = [];
      if (!subToCats[sub].includes(key)) subToCats[sub].push(key);
    });
  });
}

function getSubCats(sub) {
  return subToCats[sub] || [];
}

function getAllSubs() {
  const seen = {};
  Object.values(STATUSES).forEach(def => {
    (def.subs || []).forEach(sub => { seen[sub] = true; });
  });
  return Object.keys(seen).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function getStatusLabel(statusKey, mode = 'label') {
  const st = getStatusDef(statusKey);
  if (mode === 'short') return st.shortLabel || st.label || STATUS_FALLBACK.shortLabel;
  if (mode === 'stat') return st.statLabel || st.shortLabel || st.label || STATUS_FALLBACK.statLabel;
  return st.label || STATUS_FALLBACK.label;
}

function getStatusSubs(statusKey) {
  const st = getStatusDef(statusKey);
  if (!Array.isArray(st.subs)) return [];
  return [...st.subs].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
}

function getAlphabetizedStatusKeys({ includeOpen = true, includeResolved = true } = {}) {
  return Object.keys(STATUSES || {})
    .filter(key => (includeOpen || key !== 'open') && (includeResolved || key !== 'resolved'))
    .sort((a, b) => getStatusLabel(a, 'short').localeCompare(getStatusLabel(b, 'short'), undefined, { sensitivity: 'base' }));
}

function toColumnMajorOrder(items, columnCount) {
  const source = Array.isArray(items) ? items : [];
  const cols = Math.max(1, Number(columnCount) || 1);
  const rows = Math.ceil(source.length / cols);
  const ordered = [];
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const idx = row * cols + col;
      if (idx < source.length) ordered.push(source[idx]);
    }
  }
  return ordered;
}

function applyColumnMajorGridLayout(el, itemCount, columnCount = 2) {
  if (!el) return;
  const cols = Math.max(1, Number(columnCount) || 1);
  const rows = Math.max(1, Math.ceil(Math.max(0, Number(itemCount) || 0) / cols));
  el.style.display = 'grid';
  el.style.gridAutoFlow = 'row';
  el.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  el.style.gridTemplateRows = `repeat(${rows}, minmax(0, auto))`;
  el.style.gridAutoColumns = 'minmax(0, 1fr)';
}

function normalizeLoadedStatuses(rawStatuses) {
  if (!rawStatuses || typeof rawStatuses !== 'object' || Array.isArray(rawStatuses)) {
    return deepCopy(DEFAULT_STATUSES);
  }

  const normalized = {};
  Object.entries(rawStatuses).forEach(([key, value], idx) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const safeLabel = String(value.label || key || 'Status').trim() || key;
    const slug = slugifyStatusLabel(safeLabel);
    const color = String(value.cssColor || value.swipeColor || '#8b949e');
    normalized[key] = {
      label: safeLabel,
      shortLabel: String(value.shortLabel || safeLabel),
      icon: String(value.icon || '●'),
      cssColor: color,
      swipeColor: String(value.swipeColor || color),
      floorCls: String(value.floorCls || (key === 'resolved' ? 'all-resolved' : `has-${slug}`)),
      cls: String(value.cls || `status-${slug}`),
      subs: Array.isArray(value.subs) ? value.subs.map(v => String(v).trim()).filter(Boolean) : [],
      statLabel: String(value.statLabel || safeLabel),
      order: Number.isFinite(Number(value.order)) ? Number(value.order) : idx
    };
  });

  // Keep the canonical lockstep statuses present if Firestore omits them,
  // but do not seed any other old in-code defaults into the live config.
  if (!normalized.open) normalized.open = deepCopy(DEFAULT_STATUSES.open);
  if (!normalized.resolved) normalized.resolved = deepCopy(DEFAULT_STATUSES.resolved);
  Object.entries(CANONICAL_OPTIONAL_STATUSES).forEach(([key, value]) => {
    if (!normalized[key]) normalized[key] = deepCopy(value);
  });
  return normalized;
}

function stopStatusConfigListener() {
  if (statusConfigUnsubscribe) {
    statusConfigUnsubscribe();
    statusConfigUnsubscribe = null;
  }
}

function refreshStatusDependentUI() {
  buildStatusFilterPills();
  refreshVisibleData();

  if (document.getElementById('add-modal')?.classList.contains('visible')) {
    renderLogCatButtons();
    renderLogSubChips();
    updateLogCatPill();
    if (subcategorySheetState.open) renderSubcategorySheet();
  }
}

async function loadConfig() {
  const mySerial = ++statusConfigLoadSerial;
  const plantId = currentPlantId;
  stopStatusConfigListener();
  const sqlBootstrap = await ensureSqlPlantBootstrap(plantId);
  if (sqlBootstrap?.statusConfig?.statuses) {
    const loadedStatuses = normalizeLoadedStatuses(sqlBootstrap.statusConfig.statuses);
    SUBCATEGORY_ROUTES = normalizeSubcategoryRoutes(sqlBootstrap.statusConfig.subcategoryRoutes, loadedStatuses);
    STATUSES = syncStatusesFromSubcategoryRoutes(loadedStatuses, SUBCATEGORY_ROUTES);
    rebuildDerivedStatus();
    refreshStatusDependentUI();
    return;
  }
  if (shouldUseSqlStagingReads(plantId)) {
    const payload = await requireSqlRead(
      `status config ${plantId}`,
      () => dataApi.getStatusConfig(plantId),
      `Status config is missing in D1 for plant ${plantId}.`
    );
    const sqlStatuses = payload?.statusConfig?.statuses || null;
    if (!sqlStatuses || typeof sqlStatuses !== 'object') {
      throw new Error(`Status config is missing in D1 for plant ${plantId}.`);
    }
    const loadedStatuses = normalizeLoadedStatuses(sqlStatuses);
    SUBCATEGORY_ROUTES = normalizeSubcategoryRoutes(payload?.statusConfig?.subcategoryRoutes, loadedStatuses);
    STATUSES = syncStatusesFromSubcategoryRoutes(loadedStatuses, SUBCATEGORY_ROUTES);
    rebuildDerivedStatus();
    refreshStatusDependentUI();
    return;
  }
  try {
    const snap = await getDoc(plantDoc('config', 'statuses'));
    if (mySerial !== statusConfigLoadSerial || plantId !== currentPlantId) return;
    if (snap.exists()) {
      const data = snap.data();

      const existingStatuses = data.statuses && typeof data.statuses === 'object' && !Array.isArray(data.statuses)
        ? data.statuses
        : {};
      const migratedStatuses = { ...existingStatuses };
      let addedDefaults = false;

      // Preserve plant-specific custom statuses and only backfill missing built-ins.
      for (const [key, def] of Object.entries(DEFAULT_STATUSES)) {
        if (!migratedStatuses[key]) {
          migratedStatuses[key] = JSON.parse(JSON.stringify(def));
          addedDefaults = true;
        }
      }

      SUBCATEGORY_ROUTES = normalizeSubcategoryRoutes(data.subcategoryRoutes, migratedStatuses);
      STATUSES = syncStatusesFromSubcategoryRoutes(migratedStatuses, SUBCATEGORY_ROUTES);
      
      // Since we just changed the available statuses,
      // we must rebuild the logic that buttons depend on
      rebuildDerivedStatus();
      buildStatusFilterPills();
      renderIssues();

      if (addedDefaults) {
        if (DEMO_MODE) {
          console.log('🔄 Demo status config missing built-ins; using runtime defaults without saving.');
        } else {
          console.log('🔄 Backfilled missing built-in statuses without overwriting custom categories...');
          await saveConfig();
          console.log('✅ Status config merged and saved!');
        }
      }
    } else {
      // No config exists - save the default comprehensive categories outside demo mode.
      if (DEMO_MODE) {
        console.log('💾 Demo status config not found; using bundled defaults without saving.');
      } else {
        console.log('💾 Saving initial comprehensive ticket categories...');
        await saveConfig();
        console.log('✅ Initial configuration saved!');
      }
      rebuildDerivedStatus();
      buildStatusFilterPills();
      renderIssues();
    }

    if (mySerial !== statusConfigLoadSerial || plantId !== currentPlantId) return;
    statusConfigUnsubscribe = onSnapshot(plantDoc('config', 'statuses'), snap2 => {
      if (mySerial !== statusConfigLoadSerial || plantId !== currentPlantId) return;
      if (!snap2.exists()) return;
      const data2 = snap2.data() || {};
      if (!data2.statuses) return;
      const loadedStatuses = normalizeLoadedStatuses(data2.statuses);
      SUBCATEGORY_ROUTES = normalizeSubcategoryRoutes(data2.subcategoryRoutes, loadedStatuses);
      STATUSES = syncStatusesFromSubcategoryRoutes(loadedStatuses, SUBCATEGORY_ROUTES);
      rebuildDerivedStatus();
      refreshStatusDependentUI();
    }, err => {
      console.warn('status config listener error', err);
    });
  } catch (e) {
    console.error("Error loading config:", e);
  }
}
    
function buildStatusFilterPills() {
  const container = document.getElementById('stat-pills-row');
  if (!container) return;
  const keys = getAlphabetizedStatusKeys();
  container.innerHTML = keys.map(key => {
    const col = getStatusColor(key);
    return `
      <div class="stat-pill" id="pill-${key}" onclick="toggleStatFilter('${key}')">
        <div class="dot" style="background:${col}"></div>
        <span id="stat-${key}">0 ${getStatusLabel(key, 'stat')}</span>
      </div>
    `;
  }).join('');
}

async function saveConfig() {
  STATUSES = syncStatusesFromSubcategoryRoutes(STATUSES, SUBCATEGORY_ROUTES);
  if (shouldUseSqlStagingReads(currentPlantId)) {
    await dataApi.updateStatusConfig(currentPlantId, {
      statuses: STATUSES,
      subcategoryRoutes: SUBCATEGORY_ROUTES
    });
    invalidateSqlPlantBootstrap(currentPlantId);
    return;
  }
  await setDoc(plantDoc('config', 'statuses'), { statuses: STATUSES, subcategoryRoutes: SUBCATEGORY_ROUTES });
}

function rebuildDerivedStatus() {
  // Rebuild ALL_STATUSES and STATUS_ORDER after STATUSES changes
  window._ALL_STATUSES = getAlphabetizedStatusKeys({ includeOpen: false, includeResolved: false });
  window._STATUS_ORDER = Object.entries(STATUSES).sort((a,b)=>a[1].order-b[1].order).map(([k])=>k);
  buildStatusFilterPills();
  buildSubToCats();

  // Rebuild status filter dropdown
  const sf = document.getElementById('status-filter');
  if (sf) {
    const curVal = sf.value;
    sf.innerHTML = '<option value="">All Status</option>';
    getAlphabetizedStatusKeys().forEach(k => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = getStatusLabel(k);
      sf.appendChild(opt);
    });
    sf.value = curVal;
  }
}
rebuildDerivedStatus();

function gameLevelFromXp(xp) {
  const safeXp = Math.max(0, Number(xp || 0));
  return Math.max(1, Math.floor(Math.sqrt(safeXp / 100)) + 1);
}

function gameLevelProgress(xp) {
  const level = gameLevelFromXp(xp);
  const prevLevelFloor = Math.pow(level - 1, 2) * 100;
  const nextLevelFloor = Math.pow(level, 2) * 100;
  const span = Math.max(1, nextLevelFloor - prevLevelFloor);
  return Math.max(0, Math.min(100, Math.round(((xp - prevLevelFloor) / span) * 100)));
}

function shouldShowLevelUpCelebration() {
  const userKey = currentUser?.uid || 'anonymous';
  const today = localDateStr(new Date());
  const storageKey = `gameLevelUpCelebrationLastSeen:${userKey}`;
  try {
    const lastShown = localStorage.getItem(storageKey) || '';
    if (lastShown === today) return false;
    localStorage.setItem(storageKey, today);
  } catch (e) {
    // If storage is unavailable, fall back to allowing the celebration.
  }
  return true;
}

function renderGamePanel() {
  const xp = Number(gameUserStats?.totals?.xp || 0);
  const level = gameLevelFromXp(xp);
  const streak = Number(gameUserStats?.streaks?.current || 0);
  const missionCount = gameMissions.length;
  const progressPct = gameLevelProgress(xp);

  // XP bar labels
  const prevFloor = Math.pow(level - 1, 2) * 100;
  const nextFloor = Math.pow(level, 2) * 100;
  const xpInLevel = xp - prevFloor;
  const xpNeeded = nextFloor - prevFloor;

  // Detect level-up
  if (typeof gamePrevLevel !== 'undefined' && level > gamePrevLevel && gamePrevLevel > 0) {
    if (shouldShowLevelUpCelebration()) showLevelUpCelebration(level);
  }
  gamePrevLevel = level;

  const pillXpPrimary = document.getElementById('game-pill-xp');
  if (pillXpPrimary) pillXpPrimary.textContent = `${xp} XP`;
  document.querySelectorAll('.game-pill .game-pill-xp').forEach(el => {
    if (el !== pillXpPrimary) el.textContent = `${xp} XP`;
  });

  const pillMissionPrimary = document.getElementById('game-pill-mission');
  if (pillMissionPrimary) pillMissionPrimary.textContent = `${missionCount} missions`;
  document.querySelectorAll('.game-pill .game-pill-mission').forEach(el => {
    if (el !== pillMissionPrimary) el.textContent = `${missionCount} missions`;
  });

  const totalXpEl = document.getElementById('game-total-xp');
  const levelBadgeEl = document.getElementById('game-level-badge');
  const streakEl = document.getElementById('game-streak');
  const progressEl = document.getElementById('game-level-progress');
  const xpCurrentEl = document.getElementById('game-xp-current');
  const xpToNextEl = document.getElementById('game-xp-to-next');

  if (totalXpEl) totalXpEl.textContent = String(xp);
  if (levelBadgeEl) levelBadgeEl.textContent = String(level);
  const udXpLevelEl = document.getElementById('ud-xp-level');
  if (udXpLevelEl) udXpLevelEl.textContent = `Lv.${level}`;
  if (streakEl) streakEl.textContent = String(streak);
  if (progressEl) progressEl.style.width = `${progressPct}%`;
  if (xpCurrentEl) xpCurrentEl.textContent = `${xpInLevel} / ${xpNeeded} XP`;
  if (xpToNextEl) xpToNextEl.textContent = `to Level ${level + 1}`;

  const missionsList = document.getElementById('game-missions-list');
  if (missionsList) {
    if (!gameMissions.length) {
      missionsList.innerHTML = `<div class="game-mission-meta" style="padding:8px 0;text-align:center;">No active missions for this plant.</div>`;
    } else {
      let anyBadged = false;
      missionsList.innerHTML = gameMissions.map(m => {
        const current = Number(m.progress?.current || 0);
        const target = Number(m.objective?.threshold || 1);
        const pct = Math.max(0, Math.min(100, Math.round((current / Math.max(1, target)) * 100)));
        const completed = pct >= 100;
        const near = pct >= 90 && !completed;
        if (completed || near) anyBadged = true;
        // Detect completion transition
        const prevPct = gameMissionPrevPct.get(m.id);
        if (completed && prevPct !== undefined && prevPct < 100) {
          showMissionCompleteCelebration(m);
        }
        gameMissionPrevPct.set(m.id, pct);
        const progressColor = completed
          ? 'linear-gradient(90deg,#22c55e,#4ade80)'
          : pct > 50
            ? 'linear-gradient(90deg,var(--color-warning, var(--yellow)),var(--color-success, var(--green)))'
            : 'linear-gradient(90deg,var(--color-purple, var(--purple)),var(--color-info, var(--blue)))';
        const glowColor = completed ? '0 0 8px rgba(34,197,94,0.5)' : 'none';
        return `<div class="game-mission-item${completed ? ' game-mission-complete' : ''}">
          <div class="game-mission-head">
            <span>${completed ? '✓ ' : near ? '🔔 ' : ''}${esc(m.name || 'Mission')}</span>
            <strong style="color:${completed ? 'var(--color-success, var(--green))' : near ? 'var(--color-warning, var(--yellow))' : 'var(--color-text, var(--text))'}">${pct}%</strong>
          </div>
          <div class="game-progress"><span style="width:${pct}%;background:${progressColor};box-shadow:${glowColor}"></span></div>
          <div class="game-mission-meta">${current} / ${target} &nbsp;·&nbsp; <span style="color:var(--color-warning, var(--yellow))">${Number(m.rewards?.xp || 0)} XP</span> reward</div>
        </div>`;
      }).join('');
      updateGamePillBadge(anyBadged);
    }
  }

  // Badges card
  const badgesList = document.getElementById('game-badges-list');
  if (badgesList) {
    const defs = gameBadgeDefs.length ? gameBadgeDefs : DEFAULT_BADGE_DEFS;
    if (!defs.length) {
      badgesList.innerHTML = `<div class="game-mission-meta" style="text-align:center;">No badges configured.</div>`;
    } else {
      badgesList.innerHTML = `<div class="game-badge-grid">${defs.map(b => {
        const earned = !!gameUserBadges[b.id];
        return `<div class="game-badge-tile ${earned ? 'earned' : 'locked'}" title="${esc(b.description || b.name)}">
          <span class="badge-icon">${b.icon || '🏅'}</span>
          <span class="badge-name">${esc(b.name)}</span>
          ${earned ? '<span style="font-size:9px;color:var(--color-success, var(--green));">✓</span>' : ''}
        </div>`;
      }).join('')}</div>`;
    }
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lbList = document.getElementById('game-leaderboard-list');
  if (lbList) {
    if (!gameLeaderboard.length) {
      lbList.innerHTML = `<div class="game-mission-meta" style="padding:8px 0;text-align:center;">Leaderboard is warming up…</div>`;
    } else {
      lbList.innerHTML = gameLeaderboard.slice(0, 8).map((entry, idx) => {
        const isMe = entry.uid === currentUser?.uid;
        const medal = medals[idx] || `${idx + 1}.`;
        return `<div class="game-leader-row"${isMe ? ' style="background:rgba(168,85,247,0.07);border-radius:8px;padding:7px 8px;margin:-2px -4px;"' : ''}>
          <div class="game-leader-left">
            <span class="game-leader-medal">${medal}</span>
            <span class="game-leader-name">${esc(entry.displayName || entry.name || 'User')}</span>
            ${isMe ? '<span class="game-leader-you">you</span>' : ''}
          </div>
          <strong style="color:var(--color-warning, var(--yellow));flex-shrink:0">${Number(entry.xp || 0)} XP</strong>
        </div>`;
      }).join('');
    }
  }
  renderStoreCard();
}

window.toggleGameDrawer = (forceOpen) => {
  const drawer = document.getElementById('game-drawer');
  if (!drawer) return;
  gameDrawerOpen = typeof forceOpen === 'boolean' ? forceOpen : !gameDrawerOpen;
  drawer.classList.toggle('open', gameDrawerOpen);
  if (gameDrawerOpen) updateGamePillBadge(false); // clear badge when drawer opens
};

function showGameToast(message) {
  const el = document.getElementById('game-toast');
  if (!el) return;
  const isPositive = String(message).startsWith('+');
  const isNegative = String(message).startsWith('-') || String(message).startsWith('−');
  const icon = isNegative ? '💀' : isPositive ? '⚡' : '🎯';
  const color = isNegative ? 'var(--color-danger, var(--red))' : 'var(--color-warning, var(--yellow))';
  el.innerHTML = `<span style="color:${color};font-size:14px;">${icon}</span><span>${esc(message)}</span>`;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

function showLevelUpCelebration(level) {
  const overlay = document.createElement('div');
  overlay.className = 'game-levelup-overlay';
  overlay.innerHTML = `
    <div class="confetti-container" id="levelup-confetti"></div>
    <div class="game-levelup-card" style="position:relative;z-index:1;">
      <div class="game-levelup-label">Level Up!</div>
      <div class="game-levelup-num">${level}</div>
      <div class="game-levelup-title">Keep it up!</div>
    </div>`;
  document.body.appendChild(overlay);
  launchConfetti(overlay.querySelector('.confetti-container'));
  showGameToast(`Level ${level} reached!`);
  setTimeout(() => overlay.remove(), 3000);
}

function launchConfetti(container, count = 55) {
  if (!container) return;
  const colors = ['#a855f7','#3b82f6','#22c55e','#eab308','#f97316','#ef4444','#38bdf8','#ec4899'];
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const color = colors[i % colors.length];
    const left   = Math.random() * 100;
    const dur    = 1.4 + Math.random() * 1.4;
    const delay  = Math.random() * 0.9;
    const size   = 6 + Math.floor(Math.random() * 8);
    piece.style.cssText = `left:${left}%;width:${size}px;height:${size}px;background:${color};` +
      `animation-duration:${dur}s;animation-delay:${delay}s;` +
      `border-radius:${Math.random() > 0.5 ? '50%' : '2px'};`;
    container.appendChild(piece);
  }
}

function showMissionCompleteCelebration(mission) {
  const xp = Number(mission.rewards?.xp || 0);
  const overlay = document.createElement('div');
  overlay.className = 'game-mission-complete-overlay';
  overlay.innerHTML = `
    <div class="confetti-container" id="mission-confetti"></div>
    <div class="game-mission-complete-card">
      <div class="game-mission-complete-label">Mission Complete!</div>
      <div style="font-size:40px;line-height:1;margin:6px 0;">🎯</div>
      <div class="game-mission-complete-name">${esc(mission.name || 'Mission')}</div>
      ${xp ? `<div class="game-mission-complete-xp">+${xp} XP</div>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  launchConfetti(overlay.querySelector('.confetti-container'), 65);
  showGameToast(`+${xp} XP • Mission complete!`);
  setTimeout(() => overlay.remove(), 3500);
}

function showBadgeEarnedCelebration(badge) {
  const overlay = document.createElement('div');
  overlay.className = 'game-mission-complete-overlay';
  overlay.innerHTML = `
    <div class="confetti-container"></div>
    <div class="game-badge-complete-card">
      <div class="game-mission-complete-label">Badge Unlocked!</div>
      <span class="game-badge-icon">${badge.icon || '🏅'}</span>
      <div class="game-mission-complete-name">${esc(badge.name)}</div>
      <div style="font-size:12px;color:var(--color-text-muted, var(--text2));margin-top:4px;">${esc(badge.description || '')}</div>
      ${Number(badge.xpReward||0) ? `<div class="game-mission-complete-xp" style="margin-top:8px;">+${badge.xpReward} XP</div>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  launchConfetti(overlay.querySelector('.confetti-container'), 45);
  showGameToast(`Badge unlocked: ${badge.name}`);
  setTimeout(() => overlay.remove(), 3500);
}

function updateGamePillBadge(show) {
  document.querySelectorAll('.game-pill-badge').forEach(el => {
    el.style.display = show ? '' : 'none';
  });
}

function checkBadgeTrigger(badge, stats) {
  const threshold = Number(badge.threshold || 1);
  switch (badge.triggerType) {
    case 'xp_milestone':        return Number(stats.totals?.xp || 0) >= threshold;
    case 'level_reached':       return Number(stats.totals?.level || 1) >= threshold;
    case 'streak_days':         return Number(stats.streaks?.current || 0) >= threshold;
    case 'issues_resolved':     return Number(stats.totals?.issuesResolved || 0) >= threshold;
    case 'photos_attached':     return Number(stats.totals?.photosAttached || 0) >= threshold;
    case 'issues_created':      return Number(stats.totals?.issuesCreated || 0) >= threshold;
    case 'missions_completed':  return Number(stats.totals?.missionsCompleted || 0) >= threshold;
    default: return false;
  }
}

async function checkAndAwardBadges() {
  if (!currentPlantId || !currentUser?.uid) return;
  if (shouldUseSqlStagingReads(currentPlantId)) return;
  const defs = (gameBadgeDefs.length ? gameBadgeDefs : DEFAULT_BADGE_DEFS).filter(b => b.isEnabled !== false);
  for (const badge of defs) {
    if (gameUserBadges[badge.id]) continue; // already earned
    if (!checkBadgeTrigger(badge, gameUserStats)) continue;
    // Award optimistically to prevent re-triggering
    gameUserBadges[badge.id] = { earnedAt: new Date(), badgeName: badge.name, icon: badge.icon };
    try {
      const badgesRef = userBadgesDoc(currentUser.uid);
      await setDoc(badgesRef, {
        earnedBadges: {
          [badge.id]: { earnedAt: serverTimestamp(), badgeName: badge.name, icon: badge.icon || '🏅' }
        },
        updatedAt: serverTimestamp()
      }, { merge: true });
      showBadgeEarnedCelebration(badge);
      // Award badge XP as a direct stat increment (no dedup loop risk — badge already marked earned)
      if (Number(badge.xpReward || 0) > 0) {
        const badgeXp = Number(badge.xpReward);
        await Promise.all([
          setDoc(gameUserStatsDoc(currentUser.uid), { totals: { xp: increment(badgeXp) } }, { merge: true }),
          setDoc(doc(db, 'users', currentUser.uid), { globalLifetimeXp: increment(badgeXp) }, { merge: true })
        ]);
        userLifetimeXp = Math.max(0, userLifetimeXp + badgeXp);
        renderStoreCard();
      }
    } catch (e) {
      console.warn('Badge award failed:', e?.message);
    }
  }
}

async function ensureGamificationConfig() {
  if (!currentPlantId) return;
  if (shouldUseSqlStagingReads(currentPlantId)) return;
  const ref = gameConfigDoc();
  const snap = await getDoc(ref);
  if (!snap.exists()) await setDoc(ref, { ...GAME_DEFAULT_CONFIG, schemaVersion: 1, updatedAt: serverTimestamp() }, { merge: true });
}

async function backfillGlobalXpIfNeeded() {
  // Fresh-start: no migration from old globalXp field
}

function stopGamificationListeners() {
  if (gameStatsUnsubscribe) { gameStatsUnsubscribe(); gameStatsUnsubscribe = null; }
  if (gameMissionsUnsubscribe) { gameMissionsUnsubscribe(); gameMissionsUnsubscribe = null; }
  if (gameLeaderboardUnsubscribe) { gameLeaderboardUnsubscribe(); gameLeaderboardUnsubscribe = null; }
  if (gameConfigUnsubscribe) { gameConfigUnsubscribe(); gameConfigUnsubscribe = null; }
  if (gameBadgesUnsubscribe) { gameBadgesUnsubscribe(); gameBadgesUnsubscribe = null; }
  if (gameSqlPollTimer) { clearTimeout(gameSqlPollTimer); gameSqlPollTimer = null; }
  gameMissionProgressCache.clear();
}

function applySqlGamificationState(payload = {}) {
  const sqlConfig = payload.config?.config || null;
  if (!sqlConfig || typeof sqlConfig !== 'object') {
    throw new Error(`Gamification config is missing in D1 for plant ${currentPlantId}.`);
  }
  gameConfig = sqlConfig;
  gameBadgeDefs = Array.isArray(gameConfig.badges) ? gameConfig.badges : DEFAULT_BADGE_DEFS;
  gameUserBadges = payload.badges?.earnedBadges || {};
  gameUserStats = payload.stats || { totals: { xp: 0, level: 1 }, streaks: { current: 0 } };
  gameMissions = Array.isArray(payload.missions) ? payload.missions : [];
  if (payload.user && Number.isFinite(Number(payload.user.globalLifetimeXp))) {
    userLifetimeXp = Math.max(0, Number(payload.user.globalLifetimeXp || 0));
  }
  const leaderboard = payload.leaderboard || {};
  if (Array.isArray(leaderboard.entries)) {
    gameLeaderboard = leaderboard.entries;
  } else if (leaderboard.entriesByUid && typeof leaderboard.entriesByUid === 'object') {
    gameLeaderboard = Object.values(leaderboard.entriesByUid).sort((a, b) => Number(b?.xp || 0) - Number(a?.xp || 0));
  } else {
    gameLeaderboard = [];
  }
  renderGamePanel();
  const defs = gameBadgeDefs.length ? gameBadgeDefs : DEFAULT_BADGE_DEFS;
  (Array.isArray(payload.awardSummary?.badges) ? payload.awardSummary.badges : []).forEach(entry => {
    const badge = defs.find(def => def.id === entry.id) || entry;
    if (badge?.id) showBadgeEarnedCelebration(badge);
  });
}

function startGamificationListeners() {
  stopGamificationListeners();
  if (!currentPlantId || !currentUser?.uid) return;

  // Reset so the first Firestore snapshot doesn't false-trigger a level-up celebration
  gamePrevLevel = 0;

  if (shouldUseSqlStagingReads(currentPlantId)) {
    const poll = async () => {
      if (!currentPlantId || !currentUser?.uid) return;
      if (pageHidden) {
        gameSqlPollTimer = setTimeout(poll, 10000);
        return;
      }
      try {
        const payload = await requireSqlRead(
          `gamification ${currentPlantId}`,
          () => dataApi.getGamificationState(currentPlantId),
          `Gamification state is missing in D1 for plant ${currentPlantId}.`
        );
        if (!payload) {
          throw new Error(`Gamification state is missing in D1 for plant ${currentPlantId}.`);
        }
        applySqlGamificationState(payload);
      } catch (e) {
        console.warn('Gamification SQL poll failed:', e?.message || e);
      }
      gameSqlPollTimer = setTimeout(poll, 10000);
    };
    void poll();
    return;
  }

  // Config listener — keeps gameBadgeDefs + leaderboardPeriod live
  gameConfigUnsubscribe = onSnapshot(gameConfigDoc(), snap => {
    gameConfig = snap.exists() ? snap.data() : GAME_DEFAULT_CONFIG;
    gameBadgeDefs = Array.isArray(gameConfig.badges) ? gameConfig.badges : DEFAULT_BADGE_DEFS;
  });

  // User badges listener
  gameBadgesUnsubscribe = onSnapshot(userBadgesDoc(currentUser.uid), snap => {
    gameUserBadges = snap.exists() ? (snap.data()?.earnedBadges || {}) : {};
    renderGamePanel();
  });

  gameStatsUnsubscribe = onSnapshot(gameUserStatsDoc(currentUser.uid), snap => {
    gameUserStats = snap.exists() ? snap.data() : { totals: { xp: 0, level: 1 }, streaks: { current: 0 } };
    renderGamePanel();
    checkAndAwardBadges();
  });
  gameMissionsUnsubscribe = onSnapshot(query(gameMissionsCol(), where('isActive', '==', true), orderBy('startsAt', 'desc'), limit(6)), async snap => {
    const missionRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const activeMissionIds = new Set(missionRows.map(m => m.id));
    Array.from(gameMissionProgressCache.keys()).forEach(missionId => {
      if (!activeMissionIds.has(missionId)) gameMissionProgressCache.delete(missionId);
    });
    const missingMissionIds = missionRows
      .map(m => m.id)
      .filter(missionId => !gameMissionProgressCache.has(missionId));
    if (missingMissionIds.length) {
      const progressRows = await Promise.all(missingMissionIds.map(async missionId => {
        const progressSnap = await getDoc(missionProgressDoc(missionId, currentUser.uid));
        return { missionId, progress: progressSnap.exists() ? progressSnap.data() : null };
      }));
      progressRows.forEach(row => gameMissionProgressCache.set(row.missionId, row.progress));
    }
    gameMissions = missionRows.map(m => ({ ...m, progress: gameMissionProgressCache.get(m.id) || null }));
    renderGamePanel();
  });
  gameLeaderboardUnsubscribe = onSnapshot(gameLeaderboardDoc('weekly'), snap => {
    const data = snap.exists() ? snap.data() : {};
    if (Array.isArray(data.entries)) {
      gameLeaderboard = data.entries;
    } else if (data.entriesByUid && typeof data.entriesByUid === 'object') {
      gameLeaderboard = Object.values(data.entriesByUid).sort((a, b) => Number(b?.xp || 0) - Number(a?.xp || 0));
    } else {
      gameLeaderboard = [];
    }
    renderGamePanel();
  });
}

function missionReasonMatches(mission, reason) {
  const type = mission?.objective?.type || '';
  if (type === 'resolve_issues_older_than_hours') return reason === 'issue_resolved';
  if (type === 'status_changes') return reason === 'status_changed_valid';
  if (type === 'workflow_advances') return reason === 'workflow_step_advance';
  if (type === 'serial_captures') return reason === 'serial_captured_when_required';
  if (type === 'photo_attachments') return reason === 'photo_attached';
  if (type === 'issues_created') return reason === 'issue_created_complete';
  if (type.startsWith('trigger:')) return type.slice(8) === reason;
  return false;
}

async function updateMissionProgress(reason) {
  if (!currentUser?.uid || !Array.isArray(gameMissions) || gameMissions.length === 0) return;
  for (const mission of gameMissions) {
    if (!missionReasonMatches(mission, reason)) continue;
    const threshold = Math.max(1, Number(mission?.objective?.threshold || 1));
    const progressRef = missionProgressDoc(mission.id, currentUser.uid);
    let prevProgress = gameMissionProgressCache.get(mission.id) || null;
    if (!prevProgress) {
      const progressSnap = await getDoc(progressRef);
      prevProgress = progressSnap.exists() ? progressSnap.data() : null;
    }
    const current = Number(prevProgress?.current || 0);
    const next = Math.min(threshold, current + 1);
    const completed = next >= threshold;
    const pct = Math.round((next / threshold) * 100);
    const nextProgress = {
      subjectId: currentUser.uid,
      subjectType: 'user',
      current: next,
      target: threshold,
      percent: pct,
      completed
    };
    await setDoc(progressRef, {
      ...nextProgress,
      updatedAt: serverTimestamp()
    }, { merge: true });
    gameMissionProgressCache.set(mission.id, nextProgress);
    if (completed && !prevProgress?.completed) {
      await setDoc(gameUserStatsDoc(currentUser.uid), {
        totals: { missionsCompleted: increment(1) },
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
  }
}

async function awardGamification(reason, context = {}) {
  if (DEMO_MODE) return;
  if (!currentPlantId || !currentUser?.uid) return;
  try {
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const tags = Array.isArray(context.tags) ? context.tags.map(t => String(t || '').trim()).filter(Boolean) : [];
      if (reason === 'photo_attached') {
        const photoCapKey = `photo:${context.issueId || 'none'}`;
        const priorPhotoCount = Number(gameCapTracker.get(photoCapKey) || 0);
        const maxPhotos = Number(gameConfig?.caps?.photo_attached_per_issue || 0);
        if (maxPhotos > 0 && priorPhotoCount >= maxPhotos) return;
      }
      if (reason === 'status_changed_valid') {
        const hourBucket = Math.floor(Date.now() / 3600000);
        const statusCapKey = `status:${context.issueId || 'none'}:${hourBucket}`;
        const priorStatusCount = Number(gameCapTracker.get(statusCapKey) || 0);
        const maxStatusPerHour = Number(gameConfig?.caps?.status_changed_valid_per_issue_per_hour || 0);
        if (maxStatusPerHour > 0 && priorStatusCount >= maxStatusPerHour) return;
      }
      const payload = await dataApi.awardGamification(currentPlantId, { reason, context: { ...context, tags } });
      if (payload?.stats || payload?.config || payload?.missions || payload?.badges || payload?.leaderboard) {
        applySqlGamificationState(payload);
      }
      if (reason === 'photo_attached') {
        const photoCapKey = `photo:${context.issueId || 'none'}`;
        gameCapTracker.set(photoCapKey, Number(gameCapTracker.get(photoCapKey) || 0) + 1);
      }
      if (reason === 'status_changed_valid') {
        const hourBucket = Math.floor(Date.now() / 3600000);
        const statusCapKey = `status:${context.issueId || 'none'}:${hourBucket}`;
        gameCapTracker.set(statusCapKey, Number(gameCapTracker.get(statusCapKey) || 0) + 1);
      }
      const awardSummary = payload?.awardSummary || null;
      if (awardSummary?.awarded && Number(awardSummary.totalDelta || 0)) {
        showGameToast(`${awardSummary.totalDelta > 0 ? '+' : ''}${awardSummary.totalDelta} XP • ${reason.replaceAll('_', ' ')}`);
      }
      return;
    }
    if (!gameConfig) {
      const cfgSnap = await getDoc(gameConfigDoc());
      gameConfig = cfgSnap.exists() ? cfgSnap.data() : GAME_DEFAULT_CONFIG;
    }
    if (!gameConfig?.enabled) return;
    const base = Number(gameConfig.weights?.[reason] || gameConfig.penalties?.[reason] || 0);
    const tags = Array.isArray(context.tags) ? context.tags.map(t => String(t || '').trim()).filter(Boolean) : [];
    const customRules = Array.isArray(gameConfig.customRules) ? gameConfig.customRules : [];
    const matchingCustomRules = customRules.filter(rule => {
      if (rule?.isEnabled === false) return false;
      const trigger = String(rule?.triggerKey || '').trim();
      if (!trigger) return false;
      return trigger === reason || tags.includes(trigger);
    });
    const customDelta = matchingCustomRules.reduce((sum, rule) => sum + Number(rule?.points || 0), 0);
    const totalDelta = base + customDelta;
    if (!totalDelta) return;
    const issueId = context.issueId || 'none';
    const dedupeKey = `${currentUser.uid}:${issueId}:${reason}:${context.dedupeSuffix || ''}`;
    const dedupeSnap = await getDocs(query(gameEventsCol(), where('dedupeKey', '==', dedupeKey), limit(1)));
    if (!dedupeSnap.empty) return;

    if (reason === 'photo_attached') {
      const photoCapKey = `photo:${issueId}`;
      const priorPhotoCount = Number(gameCapTracker.get(photoCapKey) || 0);
      const maxPhotos = Number(gameConfig?.caps?.photo_attached_per_issue || 0);
      if (maxPhotos > 0 && priorPhotoCount >= maxPhotos) return;
    }

    if (reason === 'status_changed_valid') {
      const hourBucket = Math.floor(Date.now() / 3600000);
      const statusCapKey = `status:${issueId}:${hourBucket}`;
      const priorStatusCount = Number(gameCapTracker.get(statusCapKey) || 0);
      const maxStatusPerHour = Number(gameConfig?.caps?.status_changed_valid_per_issue_per_hour || 0);
      if (maxStatusPerHour > 0 && priorStatusCount >= maxStatusPerHour) return;
    }

    const evtRef = doc(gameEventsCol());
    const statsRef = gameUserStatsDoc(currentUser.uid);
    const batch = writeBatch(db);
    batch.set(evtRef, {
      type: 'xp_awarded',
      eventAt: serverTimestamp(),
      actor: currentActor(),
      source: { issueId, action: reason, tags },
      delta: { xp: totalDelta, baseXp: base, customXp: customDelta },
      appliedRules: matchingCustomRules.map(rule => ({ id: rule?.id || '', label: rule?.label || '', triggerKey: rule?.triggerKey || '', points: Number(rule?.points || 0) })),
      reason,
      dedupeKey,
      schemaVersion: 1
    });
    const totalsCounters = { xp: increment(totalDelta) };
    if (reason === 'issue_resolved')                totalsCounters.issuesResolved = increment(1);
    if (reason === 'issue_created_complete')        totalsCounters.issuesCreated = increment(1);
    if (reason === 'photo_attached')                totalsCounters.photosAttached = increment(1);
    if (reason === 'serial_captured_when_required') totalsCounters.serialsCaptured = increment(1);
    batch.set(statsRef, {
      userId: currentUser.uid,
      displayName: currentUser.displayName || currentUser.email || 'User',
      totals: totalsCounters,
      streaks: { current: increment(totalDelta > 0 ? 1 : 0) },
      lastEventAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      schemaVersion: 1
    }, { merge: true });
    batch.set(doc(db, 'users', currentUser.uid), { globalLifetimeXp: increment(totalDelta) }, { merge: true });
    await batch.commit();
    userLifetimeXp = Math.max(0, userLifetimeXp + totalDelta);
    updateStoreXpDisplay();

    const currentXp = Number(gameUserStats?.totals?.xp || 0) + totalDelta;
    const nextLevel = gameLevelFromXp(currentXp);
    await updateDoc(statsRef, { 'totals.level': nextLevel });
    await setDoc(gameLeaderboardDoc(), {
      [`entriesByUid.${currentUser.uid}`]: {
        uid: currentUser.uid,
        displayName: currentUser.displayName || currentUser.email || 'User',
        xp: currentXp,
        updatedAt: serverTimestamp()
      },
      updatedAt: serverTimestamp()
    }, { merge: true });
    if (reason === 'photo_attached') {
      const photoCapKey = `photo:${issueId}`;
      gameCapTracker.set(photoCapKey, Number(gameCapTracker.get(photoCapKey) || 0) + 1);
    }
    if (reason === 'status_changed_valid') {
      const hourBucket = Math.floor(Date.now() / 3600000);
      const statusCapKey = `status:${issueId}:${hourBucket}`;
      gameCapTracker.set(statusCapKey, Number(gameCapTracker.get(statusCapKey) || 0) + 1);
    }
    await updateMissionProgress(reason);
    showGameToast(`${totalDelta > 0 ? '+' : ''}${totalDelta} XP • ${reason.replaceAll('_', ' ')}`);
  } catch (e) {
    console.warn('Gamification award skipped:', e?.message || e);
  }
}

// ── XP STORE ──

async function loadStoreConfig() {
  if (shouldUseSqlStagingReads(currentPlantId)) {
    let config = null;
    try {
      const sqlBootstrap = await ensureSqlPlantBootstrap(currentPlantId);
      config = sqlBootstrap?.storeConfig?.config;
      if (!config) {
        const payload = await dataApi.getStoreConfig(currentPlantId);
        config = payload?.storeConfig?.config || null;
      }
    } catch (e) {
      console.warn('Failed to load store config from D1:', e);
    }
    if (!config || typeof config !== 'object') {
      console.warn(`Store config is missing in D1 for plant ${currentPlantId}. Falling back to default store items.`);
      config = { items: DEFAULT_STORE_ITEMS };
    }
    storeItems = normalizeStoreItems(config.items || config);
    ensureCurrentThemeAccess();
    restoreSavedThemeSelection();
    renderThemeChoices();
    renderStoreCard();
    renderStoreModal();
    updateStoreXpDisplay();
    updateActiveThemeChoice(readSavedTheme('midnight'));
    if (storeConfigUnsubscribe) {
      storeConfigUnsubscribe();
      storeConfigUnsubscribe = null;
    }
    return;
  }
  try {
    const globalSnap = await getDoc(globalStoreConfigDoc());
    if (globalSnap.exists()) {
      storeItems = normalizeStoreItems(globalSnap.data().items);
    } else {
      const legacySnap = await getDoc(legacyPlantStoreConfigDoc());
      storeItems = normalizeStoreItems(legacySnap.exists() ? legacySnap.data().items : DEFAULT_STORE_ITEMS);
    }
  } catch(e) {
    storeItems = normalizeStoreItems(DEFAULT_STORE_ITEMS);
  }
  ensureCurrentThemeAccess();
  restoreSavedThemeSelection();
  renderThemeChoices();
  renderStoreCard();
  renderStoreModal();
  updateStoreXpDisplay();
  updateActiveThemeChoice(readSavedTheme('midnight'));
  if (storeConfigUnsubscribe) storeConfigUnsubscribe();
  storeConfigUnsubscribe = onSnapshot(globalStoreConfigDoc(), snap => {
    const incoming = snap.exists() ? snap.data().items : DEFAULT_STORE_ITEMS;
    storeItems = normalizeStoreItems(incoming);
    ensureCurrentThemeAccess();
    restoreSavedThemeSelection();
    renderThemeChoices();
    renderStoreCard();
    renderStoreModal();
    updateStoreXpDisplay();
    updateActiveThemeChoice(readSavedTheme('midnight'));
  }, err => {
    console.warn('Global store listener failed:', err);
  });
}

function restoreSavedThemeSelection() {
  const savedTheme = readSavedTheme('');
  if (!savedTheme || !savedTheme.startsWith('storetheme_')) return;
  if (!getThemeCatalogEntry(savedTheme)) return;
  applyTheme(savedTheme);
}

function normalizeStoreItems(rawItems) {
  const incoming = Array.isArray(rawItems) ? rawItems : [];
  const byId = new Map();
  const normalizeThemeItem = (item = {}, idx = 0) => {
    const themeKey = item.themeKey ? String(item.themeKey).trim() : null;
    const id = themeKey ? `theme_${themeKey}` : (String(item.id || '').trim() || `storeitem_${idx}`);
    return {
      ...item,
      id,
      type: 'theme',
      themeKey,
      name: String(item.name || 'Theme').trim() || 'Theme',
      price: Math.max(0, Number(item.price || 0)),
      isActive: item.isActive !== false,
      customVars: normalizeThemeVars(item.customVars || {}),
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : idx
    };
  };
  // Seed with defaults so new code-defined items always appear even when
  // Firestore has an older snapshot that predates them.
  DEFAULT_STORE_ITEMS.forEach((item, idx) => {
    const id = String(item.id || '').trim();
    if (!id) return;
    byId.set(id, normalizeThemeItem(item, idx));
  });
  incoming.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const type = String(item.type || 'theme');
    if (type !== 'theme') {
      const id = String(item.id || '').trim() || `storeitem_${idx}`;
      byId.set(id, {
        ...(byId.get(id) || {}),
        ...item,
        id,
        type,
        name: String(item.name || 'Store Item'),
        price: Math.max(0, Number(item.price || 0)),
        isActive: item.isActive !== false,
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : idx
      });
      return;
    }
    const normalized = normalizeThemeItem(item, idx);
    byId.set(normalized.id, {
      ...(byId.get(normalized.id) || {}),
      ...normalized
    });
  });

  return [...byId.values()].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function isItemUnlocked(itemId) {
  return userInventory.unlockedItems.includes(itemId);
}

function getStoreItemForTheme(themeKey) {
  return storeItems.find(item => item.type === 'theme' && item.themeKey === themeKey && item.isActive !== false) || null;
}

function isThemeLocked(themeKey) {
  const theme = getThemeCatalogEntry(themeKey);
  if (!theme) return false;
  return !theme.isOwned;
}

function ensureCurrentThemeAccess() {
  const savedTheme = readSavedTheme('midnight');
  if (!getThemeCatalogEntry(savedTheme)) return;
  if (!isThemeLocked(savedTheme)) return;
  showGameToast('🔒 Theme locked — switched to Midnight');
  applyTheme('midnight');
}

window.purchaseStoreItem = purchaseStoreItem;
async function purchaseStoreItem(itemId) {
  const item = storeItems.find(i => i.id === itemId);
  if (!item || !currentUser) return;
  if (isItemUnlocked(itemId)) { showGameToast('Already owned!'); return; }
  if (userSpendableXp() < item.price) {
    showGameToast(`Need ${item.price} XP — you have ${userSpendableXp()}`);
    return;
  }
  try {
    if (shouldUseSqlBootstrap()) {
      const payload = await dataApi.purchaseStoreItem({
        itemId,
        price: Number(item.price || 0)
      });
      userXpSpent = Number(payload?.user?.globalXpSpent || (userXpSpent + item.price));
      const nextInventory = payload?.user?.inventory || {};
      userInventory = {
        unlockedItems: Array.isArray(nextInventory.unlockedItems) ? nextInventory.unlockedItems : [...new Set([...userInventory.unlockedItems, itemId])],
        activeMascot: nextInventory.activeMascot || null
      };
      currentUserProfileData = {
        ...currentUserProfileData,
        globalXpSpent: userXpSpent,
        inventory: userInventory
      };
      renderStoreCard();
      updateStoreXpDisplay();
      renderThemeChoices();
      renderStoreModal();
      updateActiveThemeChoice(readSavedTheme('midnight'));
      showGameToast(`Unlocked ${item.name}!`);
      if (item.type === 'theme') {
        if (item.themeKey) applyTheme(item.themeKey);
        else if (item.customVars) applyTheme(`storetheme_${item.id}`);
      }
      return;
    }
    const userRef = doc(db, 'users', currentUser.uid);
    await runTransaction(db, async tx => {
      const snap = await tx.get(userRef);
      const data = snap.exists() ? snap.data() : {};
      const lifetimeXp = Number(data.globalLifetimeXp || 0);
      const xpSpent = Number(data.globalXpSpent || 0);
      const spendable = Math.max(0, lifetimeXp - xpSpent);
      if (spendable < item.price) throw new Error('insufficient_xp');
      const existing = Array.isArray(data.inventory?.unlockedItems) ? data.inventory.unlockedItems : [];
      tx.set(userRef, {
        globalXpSpent: xpSpent + item.price,
        inventory: { unlockedItems: [...new Set([...existing, itemId])] }
      }, { merge: true });
    });
    userXpSpent += item.price;
    if (!userInventory.unlockedItems.includes(itemId)) userInventory.unlockedItems.push(itemId);
    renderStoreCard();
    updateStoreXpDisplay();
    renderThemeChoices();
    renderStoreModal();
    updateActiveThemeChoice(readSavedTheme('midnight'));
    showGameToast(`Unlocked ${item.name}!`);
    if (item.type === 'theme') {
      if (item.themeKey) applyTheme(item.themeKey);
      else if (item.customVars) applyTheme(`storetheme_${item.id}`);
    }
  } catch(e) {
    if (e?.message === 'insufficient_xp') showGameToast('Not enough XP!');
    else console.warn('Purchase failed:', e);
  }
}

function renderStoreCard() {
  const xpLabel = document.getElementById('game-store-xp-label');
  if (xpLabel) xpLabel.textContent = `${userSpendableXp()} XP`;

  const list = document.getElementById('game-store-list');
  if (!list) return;
  const active = storeItems.filter(i => i.isActive !== false);
  if (!active.length) {
    list.innerHTML = `<div class="game-mission-meta" style="padding:8px 0;text-align:center;color:var(--color-text-subtle, var(--text3));">No items in the store yet.</div>`;
    return;
  }
  list.innerHTML = active.map(item => {
    const owned = isItemUnlocked(item.id);
    const canAfford = userSpendableXp() >= item.price;
    let swatches = '';
    if (item.type === 'theme') {
      let colors = [];
      if (item.themeKey) {
        const opt = THEME_OPTIONS.find(t => t.key === item.themeKey);
        colors = opt?.colors || [];
      } else if (item.customVars) {
        colors = [item.customVars['--bg'] || '#111', item.customVars['--accent'] || '#888', item.customVars['--text'] || '#fff'];
      }
      if (colors.length) swatches = `<span class="store-item-swatches">${colors.map(c => `<span class="store-item-swatch" style="background:${c}"></span>`).join('')}</span>`;
    }
    return `<div class="store-item-row${owned ? ' owned' : ''}">
      <div class="store-item-info">
        <span class="store-item-name">${esc(item.name)}</span>
        ${swatches}
      </div>
      <div class="store-item-action">
        ${owned
          ? `<span class="store-item-owned">✓ Owned</span>`
          : `<button class="store-buy-btn${canAfford ? '' : ' cant-afford'}" onclick="purchaseStoreItem('${item.id}')" ${canAfford ? '' : 'disabled'}>${item.price} XP</button>`}
      </div>
    </div>`;
  }).join('');
}

// ── STORE MODAL ──

const STORE_THEME_ITEM_PREFIX = 'storeitem:';
let _pendingPurchaseItemId = null;

function updateStoreXpDisplay() {
  const spendable = userSpendableXp();
  const el = document.getElementById('store-spendable-xp');
  if (el) el.textContent = spendable;
  const udEl = document.getElementById('ud-store-xp');
  if (udEl) udEl.textContent = `${spendable} XP`;
}

function openStoreModal() {
  renderStoreModal();
  document.getElementById('store-modal')?.classList.add('visible');
  document.body.style.overflow = 'hidden';
}
window.openStoreModal = openStoreModal;

function closeStoreModal() {
  document.getElementById('store-modal')?.classList.remove('visible');
  document.body.style.overflow = '';
}
window.closeStoreModal = closeStoreModal;

function switchStoreTab(tab) {
  document.querySelectorAll('.store-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('.store-tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `store-panel-${tab}`));
}
window.switchStoreTab = switchStoreTab;
window.renderStoreModal = renderStoreModal;
window.syncBuiltInThemesToFirestore = syncBuiltInThemesToFirestore;

async function syncBuiltInThemesToFirestore() {
  if (currentUserRole !== 'admin') {
    showGameToast('Admins only');
    return;
  }
  const syncBtn = document.getElementById('store-sync-themes-btn');
  if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = 'Syncing…'; }
  try {
    let incomingItems = [];
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const payload = await dataApi.getStoreConfig(currentPlantId);
      incomingItems = Array.isArray(payload?.storeConfig?.config?.items) ? payload.storeConfig.config.items : [];
    } else {
      const storeRef = globalStoreConfigDoc();
      const snap = await getDoc(storeRef);
      incomingItems = Array.isArray(snap.data()?.items) ? snap.data().items : [];
    }
    const builtInIds = new Set(BUILT_IN_THEME_STORE_ITEMS.map(item => item.id));
    const nonBuiltIns = incomingItems.filter(item => !builtInIds.has(String(item?.id || '').trim()));
    const mergedItems = [...nonBuiltIns, ...BUILT_IN_THEME_STORE_ITEMS];
    mergedItems.sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
    if (shouldUseSqlStagingReads(currentPlantId)) {
      await dataApi.updateStoreConfig(currentPlantId, {
        config: {
          items: mergedItems,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser?.uid || null
        }
      });
      invalidateSqlPlantBootstrap(currentPlantId);
      await loadStoreConfig();
      showGameToast('✅ Built-in themes synced to D1');
    } else {
      const storeRef = globalStoreConfigDoc();
      await setDoc(storeRef, {
        items: mergedItems,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || null
      }, { merge: true });
      showGameToast('✅ Built-in themes synced to Firestore');
    }
  } catch (e) {
    console.error('Theme sync failed:', e);
    showGameToast('Could not sync themes');
  } finally {
    if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = 'Sync Built-ins'; }
  }
}

function renderStoreModal() {
  updateStoreXpDisplay();
  const activeSelection = readSavedTheme('midnight');
  const spendable = userSpendableXp();
  const catalog = getThemeCatalog();
  const freeThemes = catalog.filter(theme => theme.isFree);
  const paidThemes = catalog.filter(theme => !theme.isFree);

  const freeGrid = document.getElementById('store-free-themes');
  const paidGrid = document.getElementById('store-paid-themes');

  if (freeGrid) freeGrid.innerHTML = freeThemes.map(entry => _buildStoreThemeCard(entry, activeSelection, spendable)).join('');
  if (paidGrid) {
    paidGrid.innerHTML = paidThemes.length
      ? paidThemes.map(entry => _buildStoreThemeCard(entry, activeSelection, spendable)).join('')
      : `<div class="store-coming-soon" style="padding:18px 14px;text-align:center;">
          <div class="store-cs-title">No premium themes available</div>
          <div class="store-cs-sub">Add theme items from the admin store editor to publish them here.</div>
        </div>`;
  }

  const adminTools = document.getElementById('store-admin-tools');
  if (adminTools) adminTools.style.display = currentUserRole === 'admin' ? 'flex' : 'none';
}

function _buildStoreThemeCard(theme, activeKey, spendable) {
  const [bg, accent, textColor] = getThemePreviewColors(theme);
  const nameOnly = theme.shortLabel || themeLabelSansIcon(theme.label);
  const isActive = theme.key === activeKey;
  const owned = theme.isOwned;
  const price = theme.price || 0;
  const canAfford = spendable >= price;

  let cardCls = 'store-theme-card';
  if (isActive) cardCls += ' stc-active';
  if (!owned && !canAfford) cardCls += ' stc-dim';

  let badge = '';
  let action = '';
  let previewAction = `<button class="stc-btn stc-preview-btn" onclick="event.stopPropagation();previewStoreTheme('${theme.key}')">Preview</button>`;
  if (isActive) {
    badge = `<span class="stc-badge stc-badge-active">Active</span>`;
  } else if (owned) {
    badge = `<span class="stc-badge stc-badge-owned">${theme.isFree ? (theme.source === 'saved-custom' ? 'Saved' : 'Free') : '✓ Owned'}</span>`;
  } else if (theme.storeItemId && canAfford) {
    action = `<button class="stc-btn stc-price-btn" onclick="event.stopPropagation();openPurchaseConfirm('${theme.storeItemId}')">${price} XP</button>`;
  } else {
    badge = `<span class="stc-badge stc-badge-locked">🔒 ${price}</span>`;
  }

  const clickHandler = owned
    ? (theme.source === 'store-custom' && theme.storeItemId
        ? `onclick="applyStoreThemeItem('${theme.storeItemId}')"`
        : `onclick="applyTheme('${theme.key}');renderStoreModal();"`)
    : '';

  return `<div class="${cardCls}" role="button" tabindex="0" ${clickHandler}>
    <div class="stc-preview" style="--stc-bg:${bg};--stc-accent:${accent};--stc-text:${textColor}">
      <div class="stc-preview-bg"></div>
      <div class="stc-preview-stripe"></div>
      <div class="stc-preview-ui">
        <!-- Header -->
        <div class="stc-ui-header" style="background:${accent}25; border-bottom: 1.5px solid ${textColor}15;">
          <div class="stc-ui-dot stc-ui-dot-sm" style="background:${accent}"></div>
          <div class="stc-ui-line-sm" style="background:${textColor}; opacity: 0.6; width: 45%;"></div>
        </div>
        <!-- Cards List -->
        <div class="stc-ui-body">
          <div class="stc-ui-card" style="background:${textColor}0a; border: 1px solid ${textColor}15;">
            <div class="stc-ui-row">
              <div class="stc-ui-dot stc-ui-dot-sm" style="background:${accent}"></div>
              <div class="stc-ui-line-sm" style="background:${textColor}; opacity: 0.8; width: 55%;"></div>
            </div>
            <div class="stc-ui-line-sm" style="background:${textColor}; opacity: 0.35; width: 85%;"></div>
          </div>
          <div class="stc-ui-card" style="background:${textColor}05; border: 1px solid ${textColor}0c; opacity: 0.8;">
            <div class="stc-ui-row">
              <div class="stc-ui-line-sm" style="background:${textColor}; opacity: 0.5; width: 35%;"></div>
            </div>
          </div>
        </div>
        <!-- Navigation -->
        <div class="stc-ui-nav" style="background:${bg}; border-top: 1.5px solid ${textColor}15;">
          <div class="stc-ui-dot stc-ui-dot-sm" style="background:${accent}"></div>
          <div class="stc-ui-dot stc-ui-dot-sm" style="background:${textColor}; opacity: 0.3;"></div>
          <div class="stc-ui-dot stc-ui-dot-sm" style="background:${textColor}; opacity: 0.3;"></div>
        </div>
      </div>
      ${isActive ? '<div class="stc-active-check">✓</div>' : ''}
    </div>
    <div class="stc-footer">
      <span class="stc-name">${esc(nameOnly)}</span>
      <span class="stc-action">${badge}${action}${previewAction}</span>
    </div>
  </div>`;
}

function previewStoreTheme(themeKey) {
  if (!themeKey) return;
  if (themeKey.startsWith('storetheme_')) {
    const itemId = themeKey.replace('storetheme_', '');
    const item = storeItems.find(i => i.id === itemId && i.type === 'theme' && i.isActive !== false);
    if (!item?.customVars) return;
    clearCustomThemeVars();
    removeThemeClasses(THEME_KEYS);
    applyCustomThemeVars(item.customVars);
    document.body.dataset.themeMode = inferThemeModeFromVars(item.customVars);
    updateThemeModeUI();
    return;
  }
  if (themeKey.startsWith('custom_')) {
    applyTheme(themeKey);
    return;
  }
  const builtIn = THEME_OPTIONS.find(t => t.key === themeKey);
  if (!builtIn) return;
  applyThemeVarsFromEngine(THEME_VARS_MAP[themeKey] || {}, {
    themeKeys: THEME_KEYS,
    classThemeKey: themeKey,
    mode: builtIn.mode || 'dark',
    clearExtraKeys: [..._appliedCustomVarKeys]
  });
  _appliedCustomVarKeys = new Set();
  updateThemeModeUI();
}
window.previewStoreTheme = previewStoreTheme;

function applyStoreThemeItem(itemId) {
  const item = storeItems.find(i => i.id === itemId && i.type === 'theme' && i.isActive !== false);
  if (!item) return;
  if (!isItemUnlocked(itemId)) {
    openPurchaseConfirm(itemId);
    return;
  }
  if (item.themeKey) {
    applyTheme(item.themeKey);
    renderStoreModal();
    return;
  }
  clearCustomThemeVars();
  applyCustomThemeVars(item.customVars || {});
  document.body.dataset.themeMode = inferThemeModeFromVars(item.customVars || {});
  saveThemeSelection(`${STORE_THEME_ITEM_PREFIX}${item.id}`);
  _syncThemePrefsToFirestore();
  updateThemeModeUI();
  renderStoreModal();
}
window.applyStoreThemeItem = applyStoreThemeItem;

function openPurchaseConfirm(itemId) {
  const item = storeItems.find(i => i.id === itemId);
  if (!item) return;
  if (userSpendableXp() < item.price) { showGameToast(`Need ${item.price} XP`); return; }
  _pendingPurchaseItemId = itemId;
  const theme = item.themeKey
    ? getThemeCatalogEntry(item.themeKey)
    : getThemeCatalogEntry(`storetheme_${item.id}`);
  const icon = document.getElementById('purchase-confirm-icon');
  const title = document.getElementById('purchase-confirm-title');
  const desc = document.getElementById('purchase-confirm-desc');
  const remaining = document.getElementById('purchase-confirm-remaining');
  const btn = document.getElementById('purchase-confirm-btn');
  if (icon) icon.textContent = theme?.label.match(/^\S+/)?.[0] || '🎨';
  if (title) title.textContent = `Unlock ${esc(item.name)}?`;
  if (desc) desc.textContent = `Spend ${item.price} XP to permanently unlock the ${esc(item.name)} theme.`;
  if (remaining) remaining.textContent = `You'll have ${userSpendableXp() - item.price} XP remaining.`;
  if (btn) btn.textContent = `Buy for ${item.price} XP`;
  document.getElementById('purchase-confirm-modal')?.classList.add('visible');
}
window.openPurchaseConfirm = openPurchaseConfirm;

function closePurchaseConfirm() {
  _pendingPurchaseItemId = null;
  document.getElementById('purchase-confirm-modal')?.classList.remove('visible');
}
window.closePurchaseConfirm = closePurchaseConfirm;

async function confirmStorePurchase() {
  if (!_pendingPurchaseItemId) return;
  const itemId = _pendingPurchaseItemId;
  closePurchaseConfirm();
  await purchaseStoreItem(itemId);
  renderStoreModal();
  updateStoreXpDisplay();
}
window.confirmStorePurchase = confirmStorePurchase;

// ── SHIFT SCHEDULE ──
// startMinutes = minutes from midnight for shift start.
// Shifts cover from their startMinutes up to (but not including) the next shift's startMinutes.
// The last shift wraps overnight back to the first shift's start.
// To add per-plant schedules later: populate PLANT_SHIFT_SCHEDULES[plantId] in switchPlant()
// after reading from Firestore (e.g. plants/{plantId}/config/shifts).
const DEFAULT_SHIFT_SCHEDULE = [
  { key: 'first',  label: '1st Shift', shortLabel: '1st', startMinutes: 5*60+54, color: '#3b82f6' },
  { key: 'second', label: '2nd Shift', shortLabel: '2nd', startMinutes: 13*60+54, color: '#f59e0b' },
  { key: 'third',  label: '3rd Shift', shortLabel: '3rd', startMinutes: 21*60+54, color: '#8b5cf6' },
];
const PLANT_SHIFT_SCHEDULES = {}; // keyed by plantId; empty = use DEFAULT_SHIFT_SCHEDULE

function getShiftSchedule(plantId) {
  return PLANT_SHIFT_SCHEDULES[plantId] || DEFAULT_SHIFT_SCHEDULE;
}

function getShiftForTime(date, schedule) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  for (let i = 0; i < schedule.length; i++) {
    const start = schedule[i].startMinutes;
    const end = schedule[(i + 1) % schedule.length].startMinutes;
    if (start < end) {
      if (minutes >= start && minutes < end) return schedule[i].key;
    } else {
      if (minutes >= start || minutes < end) return schedule[i].key;
    }
  }
  return schedule[0].key;
}

let issues = [];
const issuesById = new Map();
let issueHistoryCursor = null;
let issueHistoryFetchInFlight = null;
let issueDisplayLimit = 50;
const PAGE_SIZE = 50;
let pendingPhotos = [];   // for add modal
let logCatKey = null;
let logCatSub = null;
let isSearchMode = false;
let editPhotos = [];      // for edit modal (existing + new)
let editTargetId = null;
let currentMachine = null;
let resolveTargetId = null;
let reopenTargetId = null;
let currentUser = null;
let issueScope = 'all';
let issueShiftFilter = 'all';
let mapMode = 'log'; // 'log' | 'hist' | 'notes'
let pressContributionIndex = new Map();
let pressContributionPlantId = null;
let pressContributionLoading = null;
let issuePeriod = 'today';
let unsubscribe = null;
let pageHidden = false;
let statusConfigUnsubscribe = null;
let statusConfigLoadSerial = 0;
let issueLogLayoutMode = 'masonic'; // 'masonic' | 'grid'
let issueLogLayoutRaf = null;
let issueLogDeferredRelayoutTimer = null;
let issueLogResizeObserver = null;
let gameDrawerOpen = false;
let storeItems = [];
let storeConfigUnsubscribe = null;
let userInventory = { unlockedItems: [], activeMascot: null };
let userLifetimeXp = 0;
let userXpSpent = 0;
function userSpendableXp() { return Math.max(0, userLifetimeXp - userXpSpent); }

const BUILT_IN_THEME_STORE_ITEMS = BUILT_IN_THEME_DEFS.map(theme => ({
  id: `theme_${theme.key}`,
  type: 'theme',
  themeKey: theme.key,
  customVars: null,
  name: theme.name,
  price: Number(theme.price || 0),
  isActive: true,
  order: Number(theme.order || 0)
}));

const DEFAULT_STORE_ITEMS = [
  // Canonical store catalog lives here. normalizeStoreItems() seeds these defaults
  // before applying any Firestore config, so new code-defined items still appear.
  ...BUILT_IN_THEME_STORE_ITEMS,
  {
    id: 'theme_nocturne_slate',
    type: 'theme',
    themeKey: null,
    customVars: {
      '--bg': '#121722',
      '--bg2': '#1a2130',
      '--bg3': '#242d3f',
      '--border': '#344055',
      '--text': '#e7edf7',
      '--text2': '#b5c0d4',
      '--text3': '#8c99af',
      '--accent': '#5d84d6',
      '--accent2': '#7d9de0',
      '--green': '#4bbf8a',
      '--red': '#d96b7a',
      '--blue': '#5d84d6',
      '--yellow': '#d4b46a',
      '--orange': '#c98a62'
    },
    name: 'Nocturne Slate',
    price: 3,
    isActive: true,
    order: 16
  },
];

let gameConfig = null;
let gameUserStats = { totals: { xp: 0, level: 1 }, streaks: { current: 0 } };
let gameMissions = [];
let gameLeaderboard = [];
let gameStatsUnsubscribe = null;
let gameMissionsUnsubscribe = null;
let gameLeaderboardUnsubscribe = null;
let gameConfigUnsubscribe = null;
let gameBadgesUnsubscribe = null;
let gameSqlPollTimer = null;
let gamePrevLevel = 0;
const gameCapTracker = new Map();
const gameMissionPrevPct = new Map();
const gameMissionProgressCache = new Map();
let gameBadgeDefs = [];
let gameUserBadges = {};

const DEFAULT_BADGE_DEFS = [
  { id: 'badge_first_resolve',  name: 'First Responder', icon: '✅', description: 'Resolve your first issue',   triggerType: 'issues_resolved',  threshold: 1,   xpReward: 25,  isEnabled: true },
  { id: 'badge_streak_3',       name: 'On a Roll',       icon: '🔥', description: 'Maintain a 3-day streak',  triggerType: 'streak_days',      threshold: 3,   xpReward: 30,  isEnabled: true },
  { id: 'badge_streak_10',      name: 'Committed',       icon: '💪', description: '10-day streak',             triggerType: 'streak_days',      threshold: 10,  xpReward: 100, isEnabled: true },
  { id: 'badge_photo_pro',      name: 'Photo Pro',       icon: '📸', description: 'Attach 50 photos',          triggerType: 'photos_attached',  threshold: 50,  xpReward: 75,  isEnabled: true },
  { id: 'badge_level_5',        name: 'Veteran',         icon: '⭐', description: 'Reach Level 5',             triggerType: 'level_reached',    threshold: 5,   xpReward: 150, isEnabled: true },
  { id: 'badge_xp_500',         name: 'XP Hunter',       icon: '⚡', description: 'Earn 500 total XP',         triggerType: 'xp_milestone',     threshold: 500, xpReward: 50,  isEnabled: true },
  { id: 'badge_resolver_10',    name: 'Problem Solver',  icon: '🏆', description: 'Resolve 10 issues',         triggerType: 'issues_resolved',  threshold: 10,  xpReward: 100, isEnabled: true },
];
const GAME_DEFAULT_CONFIG = {
  enabled: true,
  weights: { issue_created_complete: 5, status_changed_valid: 2, workflow_step_advance: 3, issue_resolved: 8, photo_attached: 2, serial_captured_when_required: 4 },
  penalties: { issue_reopened: -6, missing_required_serial: -5, invalid_status_bounce: -2 },
  caps: { photo_attached_per_issue: 1, status_changed_valid_per_issue_per_hour: 3 },
  customRules: []
};
renderGamePanel();
const issueLogMasonicState = {
  columnWidth: 0,
  columnCount: 1,
  gutter: 8,
  positions: new Map()
};

const MAX_DIM = 1000;
const JPEG_QUALITY = 0.70;

// ── AUTH ──
function resetGoogleSignInButton() {
  if (NO_AUTH_MODE || DEMO_MODE) return;
  const btn = document.getElementById('google-signin-btn');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = googleBtnHTML;
}

async function signInWithGoogle() {
  if (NO_AUTH_MODE || DEMO_MODE) return;
  const btn = document.getElementById('google-signin-btn');
  if (!btn) return;
  btn.disabled = true; btn.textContent = 'Signing in…';
  try { 
    await signInWithPopup(auth, provider);
  }
  catch(e) {
    console.error('Sign in error:', e.code, e.message);
    resetGoogleSignInButton();
  }
}
const googleBtnHTML = `<svg class="google-logo" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Sign in with Google`;
const googleSignInBtn = document.getElementById('google-signin-btn');
if (googleSignInBtn) {
  googleSignInBtn.innerHTML = googleBtnHTML;
  googleSignInBtn.addEventListener('click', signInWithGoogle);
}
const demoLoginBtn = document.getElementById('demo-login-btn');
if (demoLoginBtn) {
  demoLoginBtn.addEventListener('click', () => {
    try { sessionStorage.removeItem('demo_signed_out'); } catch (_) {}
    if (DEMO_MODE) {
      signInAnonymously(auth).catch(e => {
        console.error('Demo anon sign-in failed:', e);
        showDemoAuthError(e);
      });
    } else {
      const url = new URL(window.location.href);
      url.searchParams.set('demo', '1');
      window.location.href = url.toString();
    }
  });
}



async function doSignOut() {
  if (NO_AUTH_MODE) {
    await bootstrapNoAuthSession();
    return;
  }
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  stopStatusConfigListener();
  stopGamificationListeners();
  if (DEMO_MODE) {
    try { sessionStorage.setItem('demo_signed_out', 'true'); } catch (_) {}
  }
  apiSessionClient.clear();
  await fbSignOut(auth);
}

function applyUserIdentityToShell(user) {
  const displayName = user.displayName || user.email || 'User';
  const firstName = user.displayName ? user.displayName.split(' ')[0] : user.email || 'User';
  document.getElementById('user-name-display').textContent = firstName;
  const fullNameEl = document.getElementById('dropdown-full-name');
  const emailEl = document.getElementById('dropdown-email');
  if (fullNameEl) fullNameEl.textContent = displayName;
  if (emailEl) emailEl.textContent = user.email || '';

  const initials = displayName.split(' ').filter(Boolean).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase() || '?';
  const fallback = document.getElementById('user-avatar-fallback');
  const udAvatar = document.getElementById('ud-avatar');
  if (!fallback) return;

  if (user.photoURL) {
    fallback.style.backgroundImage = 'url(' + user.photoURL + ')';
    fallback.style.backgroundSize = 'cover';
    fallback.textContent = '';
    if (udAvatar) {
      udAvatar.style.backgroundImage = 'url(' + user.photoURL + ')';
      udAvatar.textContent = '';
    }
  } else {
    fallback.style.backgroundImage = '';
    fallback.textContent = displayName.charAt(0).toUpperCase();
    if (udAvatar) {
      udAvatar.style.backgroundImage = '';
      udAvatar.textContent = initials;
    }
  }
}

function applyOnboardingIdentityToShell(profile = {}) {
  const fullName = String(profile.fullName || '').trim();
  if (!fullName) return;
  const firstName = fullName.split(/\s+/)[0] || fullName;
  const nameEl = document.getElementById('user-name-display');
  const fullNameEl = document.getElementById('dropdown-full-name');
  if (nameEl) nameEl.textContent = firstName;
  if (fullNameEl) fullNameEl.textContent = fullName;
}

function profileOnboardingComplete(profile = {}) {
  return profile.profileOnboarding?.completed === true
    && String(profile.fullName || '').trim()
    && String(profile.ssoNumber || '').trim()
    && Array.isArray(profile.requestedPlantIds)
    && profile.requestedPlantIds.length > 0;
}

function setProfileOnboardingError(message = '') {
  const el = document.getElementById('profile-onboarding-error');
  if (el) el.textContent = message;
}

function selectedProfileOnboardingPlantIds() {
  return Array.from(document.querySelectorAll('#profile-onboarding-plant-menu input[type="checkbox"]:checked'))
    .map(input => input.value)
    .filter(Boolean);
}

function updateProfileOnboardingPlantLabel() {
  const label = document.getElementById('profile-onboarding-plant-label');
  if (!label) return;
  const selected = new Set(selectedProfileOnboardingPlantIds());
  if (!selected.size) {
    label.textContent = 'Select plants';
    return;
  }
  const names = availablePlantsForOnboarding.filter(p => selected.has(p.id)).map(p => p.name || p.id);
  label.textContent = names.length === 1 ? names[0] : `${names.length} plants selected`;
}

function closeProfileOnboardingPlantMenu() {
  document.getElementById('profile-onboarding-plant-menu')?.classList.remove('visible');
  const btn = document.getElementById('profile-onboarding-plant-toggle');
  btn?.classList.remove('open');
  btn?.setAttribute('aria-expanded', 'false');
}

function renderProfileOnboardingPlants(selectedIds = []) {
  const menu = document.getElementById('profile-onboarding-plant-menu');
  if (!menu) return;
  const selected = new Set(selectedIds.filter(Boolean));
  menu.innerHTML = availablePlantsForOnboarding.map(plant => {
    const checked = selected.has(plant.id) ? 'checked' : '';
    const location = plant.location ? `<small>${esc(plant.location)}</small>` : '';
    return `<label class="onboarding-plant-option" role="option" aria-selected="${checked ? 'true' : 'false'}">
      <input type="checkbox" value="${esc(plant.id)}" ${checked}>
      <span>${esc(plant.name || plant.id)}</span>
      ${location}
    </label>`;
  }).join('');
  updateProfileOnboardingPlantLabel();
}

async function completeProfileOnboarding() {
  const fullName = String(document.getElementById('profile-onboarding-full-name')?.value || '').trim();
  const ssoNumber = String(document.getElementById('profile-onboarding-sso')?.value || '').trim();
  const plantIds = selectedProfileOnboardingPlantIds();
  if (!fullName) throw new Error('Full name is required.');
  if (!ssoNumber) throw new Error('SSO number is required.');
  if (!plantIds.length) throw new Error('Choose at least one plant.');
  const availableIds = new Set(availablePlantsForOnboarding.map(p => p.id));
  const safePlantIds = plantIds.filter(id => availableIds.has(id));
  if (!safePlantIds.length) throw new Error('Choose at least one plant.');

  if (shouldUseSqlBootstrap()) {
    await dataApi.createAccessRequests({
      displayName: currentUser.displayName || currentUser.email || '',
      fullName,
      ssoNumber,
      plantIds: safePlantIds,
      profileOnboarding: {
        completed: true,
        version: PROFILE_ONBOARDING_VERSION,
        completedAt: new Date().toISOString()
      }
    });
  } else {
    const existingPlantIds = userPlants.map(p => p.id).filter(Boolean);
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', currentUser.uid), {
      displayName: currentUser.displayName || currentUser.email || '',
      email: currentUser.email || '',
      photoURL: currentUser.photoURL || '',
      fullName,
      ssoNumber,
      requestedPlantIds: safePlantIds,
      profileOnboarding: {
        completed: true,
        completedAt: serverTimestamp(),
        version: PROFILE_ONBOARDING_VERSION
      },
      updatedAt: serverTimestamp(),
      createdAt: currentUserProfileData.createdAt || serverTimestamp()
    }, { merge: true });
    safePlantIds.filter(plantId => !existingPlantIds.includes(plantId)).forEach(plantId => {
      batch.set(doc(db, 'plants', plantId, 'accessRequests', currentUser.uid), {
        uid: currentUser.uid,
        userId: currentUser.uid,
        displayName: fullName,
        fullName,
        ssoNumber,
        email: currentUser.email || '',
        photoURL: currentUser.photoURL || '',
        requestedPlantId: plantId,
        requestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: 'pending'
      }, { merge: true });
    });
    await batch.commit();
  }

  currentUserProfileData = {
    ...currentUserProfileData,
    fullName,
    ssoNumber,
    requestedPlantIds: safePlantIds,
    profileOnboarding: { completed: true, version: PROFILE_ONBOARDING_VERSION }
  };
  applyOnboardingIdentityToShell(currentUserProfileData);
}

function showProfileOnboardingIfNeeded(profile = {}) {
  if (DEMO_MODE || NO_AUTH_MODE || profileOnboardingComplete(profile)) {
    applyOnboardingIdentityToShell(profile);
    return Promise.resolve();
  }
  const overlay = document.getElementById('profile-onboarding-modal');
  const nameInput = document.getElementById('profile-onboarding-full-name');
  const ssoInput = document.getElementById('profile-onboarding-sso');
  const submitBtn = document.getElementById('profile-onboarding-submit');
  if (!overlay || !nameInput || !ssoInput || !submitBtn) return Promise.resolve();

  const existingSelection = Array.isArray(profile.requestedPlantIds) && profile.requestedPlantIds.length
    ? profile.requestedPlantIds
    : userPlants.map(p => p.id);
  nameInput.value = String(profile.fullName || currentUser?.displayName || '').trim();
  ssoInput.value = String(profile.ssoNumber || '').trim();
  renderProfileOnboardingPlants(existingSelection);
  setProfileOnboardingError('');
  overlay.classList.add('visible');
  setTimeout(() => (nameInput.value ? ssoInput : nameInput).focus(), 50);

  return new Promise(resolve => {
    submitBtn.onclick = async () => {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
      setProfileOnboardingError('');
      try {
        await completeProfileOnboarding();
        overlay.classList.remove('visible');
        closeProfileOnboardingPlantMenu();
        resolve();
      } catch (e) {
        setProfileOnboardingError(e.message || 'Could not save profile.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Continue';
      }
    };
  });
}

function renderPendingPlantAccessState() {
  document.getElementById('plant-name-display').textContent = 'Access pending';
  const issuesList = document.getElementById('issues-list');
  if (issuesList) {
    issuesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⏳</div>
        <div class="empty-state-text" style="margin-bottom:8px;">Your plant access request is pending admin approval.</div>
        <div class="empty-state-text">Once approved, reload AP Tracker and your assigned plants will appear here.</div>
      </div>`;
  }
  const issueCount = document.getElementById('issue-count');
  if (issueCount) issueCount.textContent = '0 issues';
  const statRow = document.getElementById('stat-pills-row');
  if (statRow) statRow.querySelectorAll('[id^="stat-"]').forEach(el => {
    const parts = String(el.textContent || '').split(' ');
    el.textContent = `0 ${parts.slice(1).join(' ') || ''}`.trim();
  });
  buildPlantDropdown();
}

document.getElementById('profile-onboarding-plant-toggle')?.addEventListener('click', e => {
  e.preventDefault();
  const menu = document.getElementById('profile-onboarding-plant-menu');
  const btn = document.getElementById('profile-onboarding-plant-toggle');
  if (!menu || !btn) return;
  const isOpen = menu.classList.contains('visible');
  menu.classList.toggle('visible', !isOpen);
  btn.classList.toggle('open', !isOpen);
  btn.setAttribute('aria-expanded', String(!isOpen));
});

document.getElementById('profile-onboarding-plant-menu')?.addEventListener('change', e => {
  if (!e.target?.matches?.('input[type="checkbox"]')) return;
  e.target.closest('.onboarding-plant-option')?.setAttribute('aria-selected', e.target.checked ? 'true' : 'false');
  updateProfileOnboardingPlantLabel();
});

document.addEventListener('click', e => {
  const picker = document.getElementById('profile-onboarding-plant-picker');
  if (picker && !picker.contains(e.target)) closeProfileOnboardingPlantMenu();
});

async function bootstrapNoAuthSession() {
  currentUser = { ...NO_AUTH_USER };
  const loginScreen = document.getElementById('login-screen');
  if (loginScreen) loginScreen.remove();
  document.getElementById('app').classList.add('visible');
  applyUserIdentityToShell(currentUser);
  const plantNameEl = document.getElementById('plant-name-display');
  if (plantNameEl) plantNameEl.textContent = 'No auth mode';
  const issuesList = document.getElementById('issues-list');
  if (issuesList) {
    issuesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔓</div>
        <div class="empty-state-text" style="margin-bottom:12px;">No-auth mode is loaded. Google sign-in is disabled on this page.</div>
      </div>`;
  }
  buildFloorMap();
  setTodayDate();
}

async function bootstrapSignedInSession(user) {
  currentUser = user;
  void apiSessionClient.warm();
  void refreshMigrationReadiness();
  document.getElementById('login-screen').classList.remove('visible');
  document.getElementById('app').classList.add('visible');
  applyUserIdentityToShell(user);

  // Write user lookup record so admins can find this user by email when adding to plants.
  // Fire-and-forget — failure is non-fatal.
  if (!shouldUseSqlBootstrap() && user.email && shouldSyncUserLookup(user.email)) {
    setDoc(doc(db, 'userLookup', user.email.toLowerCase()), {
      uid: user.uid,
      displayName: user.displayName || '',
      email: user.email,
      lastSeen: serverTimestamp()
    }, { merge: true }).catch(() => {});
  }

  // Build once before plant load to ensure machine controls exist,
  // then hydrate with plant-specific config and rebuild.
  buildFloorMap();
  await loadUserPlants();
  // Recovery: find real plants from alternative sources
  if (!DEMO_MODE && !shouldUseSqlBootstrap() && userPlants.some(p => p.id === DEMO_PLANT_ID)) {
    try {
      // Try user's own doc which we already have
      const userSnap2 = await rawGetDoc(doc(db, 'users', currentUser.uid));
      const userData2 = userSnap2.exists() ? userSnap2.data() : {};
      let realPlantIds = [];
      // Check old "plants" field (may contain real plants)
      if (Array.isArray(userData2.plants)) {
        realPlantIds = userData2.plants
          .map(p => typeof p === 'string' ? p : (p.id || ''))
          .filter(Boolean)
          .filter(id => id !== DEMO_PLANT_ID);
      }
      // Search member docs wherever Firebase cached them
      if (!realPlantIds.length) {
        const q = query(collectionGroup(db, 'members'), where('userId', '==', currentUser.uid));
        const memberSnap = await getDocs(q);
        memberSnap.forEach(d => {
          const plantId = d.ref.parent.parent?.id;
          if (plantId && plantId !== DEMO_PLANT_ID) realPlantIds.push(plantId);
        });
      }
      if (realPlantIds.length) {
        const seen = new Set();
        const deduped = realPlantIds.filter(id => { const k = seen.has(id); seen.add(id); return !k; });
        await rawSetDoc(doc(db, 'users', currentUser.uid), { plantIds: deduped, lastPlant: deduped[0] }, { merge: true });
        const plantDocs = await Promise.all(deduped.map(id => rawGetDoc(doc(db, 'plants', id))));
        userPlants = plantDocs.filter(s => s.exists()).map(s => ({ id: s.id, name: s.data().name || s.id, location: s.data().location || '' }));
        currentPlantId = deduped[0];
        currentPlantName = userPlants[0]?.name || deduped[0];
        document.getElementById('plant-name-display').textContent = currentPlantName;
        buildPlantDropdown();
      } else {
        console.warn('Recovery: no real plants found via old plants field or member docs');
      }
    } catch (e) {
      console.error('Plant recovery error:', e);
    }
  }
  await showProfileOnboardingIfNeeded(currentUserProfileData);
  if (!currentPlantId) {
    renderPendingPlantAccessState();
    setTodayDate();
    scheduleFcmTokenRegistration();
    return;
  }
  await hydrateCurrentPlantView();
  await hydrateLocalIssueOutboxForCurrentPlant();
  gameConfig = null;
  await ensureGamificationConfig();
  await backfillGlobalXpIfNeeded();
  startGamificationListeners();
  startListener();
  scheduleIssueOutboxFlush();
  _startMessagingInboxWatcher();
  startRoleFeedAlertsWatcher();
  _bindMessagingKeyboardShortcut();
  setTodayDate();
  scheduleFcmTokenRegistration();
  if (!localStorage.getItem(TUTORIAL_KEY)) setTimeout(() => window.openTutorial(), 900);
}

function applyDemoShell() {
  document.body.classList.add('demo-mode');
  const syncBanner = document.getElementById('sync-banner');
  if (syncBanner && !document.getElementById('demo-mode-pill')) {
    const pill = document.createElement('span');
    pill.id = 'demo-mode-pill';
    pill.className = 'demo-mode-pill';
    pill.textContent = 'Demo Sandbox';
    syncBanner.insertBefore(pill, document.getElementById('app-version-indicator') || null);
  }
  const adminPageBtn = document.getElementById('admin-page-btn');
  if (adminPageBtn) adminPageBtn.style.display = 'none';
}

function demoMemberPayload(role = 'editor') {
  const isAdmin = role === 'admin';
  return {
    userId: currentUser.uid,
    displayName: 'Demo Session',
    email: '',
    photoURL: '',
    role,
    isActive: true,
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    permissions: isAdmin ? { ...DEFAULT_PERMISSIONS } : { ...DEMO_PERMISSIONS }
  };
}

// A simple helper to race a promise against a timeout
function withTimeout(promise, timeoutMs, description = 'Operation') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${description} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function isPermissionDeniedError(error) {
  return error?.code === 'permission-denied'
    || String(error?.message || '').toLowerCase().includes('permission-denied');
}

function hydrateOfflineDemoSandbox() {
  PRESSES = { ...DEFAULT_PRESSES };
  ALL_MACHINES = Object.values(PRESSES).flat();
  STATUSES = deepCopy(DEFAULT_STATUSES);
  SUBCATEGORY_ROUTES = {};
  rebuildDerivedStatus();
  currentUserRole = 'editor';
  currentUserPermissions = { ...DEMO_PERMISSIONS };
  applyRoleUI();
  buildFloorMap();
  seedInMemoryDemoIssues();
  setSyncStatus('ok', 'Offline Demo Sandbox - loaded local demo data');
}

function seedInMemoryDemoIssues() {
  console.log('Seeding demo issues in-memory as offline fallback...');
  const now = new Date();
  
  const sampleIssues = [
    {
      id: 'sample_alert_robot_estop',
      machine: '1.07',
      machineCode: '1.07',
      note: 'Robot arm E-stop during part removal. Cell is safe and waiting for controlman review.',
      highPriority: true,
      priority: 'critical',
      shift: 'first',
      userId: 'demo_sample_operator',
      userName: 'Demo Operator',
      createdAt: now,
      dateTime: now.toLocaleString(),
      currentStatus: {
        statusKey: 'controlman',
        subStatusKey: 'Robot / EOAT (End of Arm Tooling) Fault',
        label: 'Controlman',
        subLabel: 'Robot / EOAT (End of Arm Tooling) Fault',
        color: '#38bdf8',
        enteredAt: now,
        enteredDateTime: now.toLocaleString(),
        enteredBy: { displayName: 'Demo Lead' },
        notePreview: 'Controlman called and reviewing servo fault.'
      },
      lifecycle: { isOpen: true, isResolved: false, openedAt: now },
      statusHistory: [
        { status: 'alert', subStatus: 'Robot / EOAT (End of Arm Tooling) Fault', by: 'Demo Operator', dateTime: now.toLocaleString() },
        { status: 'controlman', subStatus: 'Robot / EOAT (End of Arm Tooling) Fault', by: 'Demo Lead', dateTime: now.toLocaleString(), note: 'Controlman called and reviewing servo fault.' }
      ],
      photos: [],
      eventHistory: []
    },
    {
      id: 'sample_maintenance_leak',
      machine: '3.04',
      machineCode: '3.04',
      note: 'Hydraulic leak at clamp unit. Oil is contained and maintenance is replacing a high-pressure hose.',
      shift: 'first',
      userId: 'demo_sample_operator',
      userName: 'Demo Operator',
      createdAt: now,
      dateTime: now.toLocaleString(),
      currentStatus: {
        statusKey: 'maintenance',
        subStatusKey: 'Hydraulic Leak / Pressure Drop',
        label: 'Maintenance',
        subLabel: 'Hydraulic Leak / Pressure Drop',
        color: '#eab308',
        enteredAt: now,
        enteredDateTime: now.toLocaleString(),
        enteredBy: { displayName: 'Demo Maintenance' },
        notePreview: 'Maintenance on site with lockout complete.'
      },
      lifecycle: { isOpen: true, isResolved: false, openedAt: now },
      statusHistory: [
        { status: 'open', by: 'Demo Operator', dateTime: now.toLocaleString() },
        { status: 'maintenance', subStatus: 'Hydraulic Leak / Pressure Drop', by: 'Demo Maintenance', dateTime: now.toLocaleString(), note: 'Maintenance on site with lockout complete.' }
      ],
      photos: [],
      eventHistory: []
    },
    {
      id: 'sample_materials_serial',
      machine: '4.09',
      machineCode: '4.09',
      note: 'Material lot needs verification before startup can continue.',
      shift: 'first',
      userId: 'demo_sample_operator',
      userName: 'Demo Operator',
      createdAt: now,
      dateTime: now.toLocaleString(),
      currentStatus: {
        statusKey: 'startup',
        subStatusKey: 'First Article Inspection (FAI)',
        label: 'Startup',
        subLabel: 'First Article Inspection (FAI)',
        color: '#14b8a6',
        enteredAt: now,
        enteredDateTime: now.toLocaleString(),
        enteredBy: { displayName: 'Demo Materials' },
        notePreview: 'Lot STK12345 verified and released to startup.'
      },
      lifecycle: { isOpen: true, isResolved: false, openedAt: now },
      statusHistory: [
        { status: 'materials', subStatus: 'Wrong / Missing Material', by: 'Demo Operator', dateTime: now.toLocaleString(), note: 'S/N: STK12345' },
        { status: 'startup', subStatus: 'First Article Inspection (FAI)', by: 'Demo Materials', dateTime: now.toLocaleString(), note: 'Lot STK12345 verified and released to startup.' }
      ],
      photos: [],
      eventHistory: []
    }
  ];

  issuesById.clear();
  sampleIssues.forEach(issue => {
    issuesById.set(issue.id, issue);
  });
  rebuildIssuesArrayFromMap();
  refreshVisibleData();
  void _refreshRoleAlertBadgeCount();
}

async function ensureDemoPlantAccess() {
  try {
    const plantRef = doc(db, 'plants', DEMO_PLANT_ID);
    const memberRef = plantMemberDocRef(DEMO_PLANT_ID, currentUser.uid);
    const userRef = doc(db, 'users', currentUser.uid);

    await withTimeout(setDoc(memberRef, demoMemberPayload('editor'), { merge: true }), 7000, 'setDoc memberRef');
    await withTimeout(setDoc(userRef, { plantIds: [DEMO_PLANT_ID], lastPlant: DEMO_PLANT_ID, isDemoUser: true }, { merge: true }), 7000, 'setDoc userRef');

    const memberSnap = await withTimeout(getDoc(memberRef), 7000, 'getDoc memberRef');
    if (!memberSnap.exists()) {
      throw new Error('Demo member access was not visible after write');
    }

    const snap = await withTimeout(getDoc(plantRef), 4000, 'getDoc plantRef');

    if (!snap.exists()) {
      await withTimeout(setDoc(plantRef, {
        name: DEMO_PLANT_NAME,
        location: 'Demo Location',
        createdAt: serverTimestamp(),
        isActive: true,
        isDemo: true
      }), 4000, 'setDoc plantRef');
    }
    return true;
  } catch (e) {
    if (isPermissionDeniedError(e)) {
      console.warn('Demo plant access is not available yet; using local demo sandbox fallback.', e);
    } else {
      console.warn('Demo plant bootstrap timed out; using local demo sandbox fallback.', e);
    }
    return false;
  }
}

async function bootstrapDemoSession(user) {
  currentUser = user;
  document.getElementById('login-screen').classList.remove('visible');
  document.getElementById('app').classList.add('visible');
  document.getElementById('user-name-display').textContent = 'Demo Mode';
  const fullNameEl = document.getElementById('dropdown-full-name');
  const emailEl = document.getElementById('dropdown-email');
  if (fullNameEl) fullNameEl.textContent = 'AP Tracker Demo';
  if (emailEl) emailEl.textContent = 'Editable sandbox for exploring the app';

  applyDemoShell();

  currentPlantId = DEMO_PLANT_ID;
  currentPlantName = DEMO_PLANT_NAME;
  userPlants = [{ id: DEMO_PLANT_ID, name: DEMO_PLANT_NAME, location: 'Demo Location' }];
  buildPlantDropdown();
  document.getElementById('plant-name-display').textContent = currentPlantName;

  const hasRemoteDemoAccess = await ensureDemoPlantAccess();

  try {
    await loadStoreConfig();
  } catch (e) {
    console.warn('Demo store config load failed; continuing with defaults.', e);
  }

  if (!hasRemoteDemoAccess) {
    hydrateOfflineDemoSandbox();
    setTodayDate();
    buildDemoGuide();
    return;
  }

  let remoteDemoBootstrapReady = true;
  try {
    await withTimeout(
      Promise.all([loadPlantPresses(), loadCurrentMember(currentPlantId)]),
      7000,
      'bootstrapDemoSession plant bootstrap'
    );
  } catch (e) {
    remoteDemoBootstrapReady = false;
    console.warn('Demo config bootstrap failed; falling back to local sandbox data.', e);
  }

  if (!remoteDemoBootstrapReady) {
    hydrateOfflineDemoSandbox();
    setTodayDate();
    buildDemoGuide();
    return;
  }

  currentUserRole = 'editor';
  currentUserPermissions = { ...DEMO_PERMISSIONS };
  applyRoleUI();
  buildFloorMap();

  try {
    await withTimeout(loadConfig(), 5000, 'loadConfig');
  } catch (e) {
    if (isPermissionDeniedError(e)) {
      console.warn('Demo status config is not readable yet; using local defaults.', e);
    } else {
      console.warn('Demo status config load timed out; using local defaults.', e);
    }
    STATUSES = deepCopy(DEFAULT_STATUSES);
    SUBCATEGORY_ROUTES = {};
    rebuildDerivedStatus();
    refreshStatusDependentUI();
  }

  try {
    startListener();
  } catch (e) {
    console.warn('Demo listener failed to start; using local demo issues.', e);
    seedInMemoryDemoIssues();
    setSyncStatus('ok', 'Offline Demo Sandbox - loaded local demo data');
  }
  
  setTodayDate();
  buildDemoGuide();
}

function showDemoAuthError(error) {
  const loginScreen = document.getElementById('login-screen');
  const loginCard = loginScreen?.querySelector('.login-card');
  if (loginScreen) loginScreen.classList.add('visible');
  document.getElementById('app')?.classList.remove('visible');
  if (!loginCard) return;
  let errorEl = document.getElementById('demo-auth-error');
  if (!errorEl) {
    errorEl = document.createElement('div');
    errorEl.id = 'demo-auth-error';
    errorEl.className = 'login-error';
    loginCard.appendChild(errorEl);
  }
  const code = error?.code ? ` (${error.code})` : '';
  errorEl.textContent = `Demo access needs Firebase Anonymous Auth enabled${code}.`;
}

const DEMO_GUIDE_STEPS = [
  {
    key: 'floor',
    title: 'Floor map',
    desc: 'See rows and press status colors.',
    action: 'floor',
    btn: 'View map'
  },
  {
    key: 'log',
    title: 'Log an issue',
    desc: 'Open the issue form for a sample press.',
    action: 'log',
    btn: 'Try form'
  },
  {
    key: 'route',
    title: 'Route an issue',
    desc: 'Send work to the right team.',
    action: 'route',
    btn: 'Show card',
    visual: 'route'
  },
  {
    key: 'workflow',
    title: 'Workflow',
    desc: 'Use Called, Accepted, In Progress, Finished.',
    action: 'workflow',
    btn: 'Highlight'
  },
  {
    key: 'filters',
    title: 'Filters',
    desc: 'Filter by shift, machine, status, or search.',
    action: 'filters',
    btn: 'Open'
  },
  {
    key: 'export',
    title: 'Export',
    desc: 'Preview PDF or download XLS reports.',
    action: 'export',
    btn: 'Open'
  },
  {
    key: 'tools',
    title: 'Tools',
    desc: 'Explore Wiki, Notes, Todos, and Messages.',
    action: 'tools',
    btn: 'Show tools'
  }
];

function readDemoGuideDone() {
  try {
    const raw = localStorage.getItem(DEMO_GUIDE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (_) {
    return new Set();
  }
}

function saveDemoGuideDone(done) {
  try { localStorage.setItem(DEMO_GUIDE_KEY, JSON.stringify([...done])); } catch (_) {}
}

function triggerDemoTaskCelebration() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  container.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;overflow:hidden;';
  document.body.appendChild(container);
  launchConfetti(container, 45);
  setTimeout(() => container.remove(), 3000);
}

function markDemoGuideStep(key) {
  const done = readDemoGuideDone();
  if (done.has(key)) return;
  
  done.add(key);
  saveDemoGuideDone(done);
  
  try { triggerDemoTaskCelebration(); } catch (e) { console.error('Celebration failed:', e); }
  
  // Auto-advance if the completed step was the current active step
  const completedIdx = DEMO_GUIDE_STEPS.findIndex(step => step.key === key);
  if (completedIdx === window.currentDemoStepIndex) {
    let nextIncomplete = DEMO_GUIDE_STEPS.findIndex((step, idx) => idx > completedIdx && !done.has(step.key));
    if (nextIncomplete === -1) {
      nextIncomplete = DEMO_GUIDE_STEPS.findIndex(step => !done.has(step.key));
    }
    if (nextIncomplete !== -1) {
      window.currentDemoStepIndex = nextIncomplete;
    } else {
      window.currentDemoStepIndex = (window.currentDemoStepIndex + 1) % DEMO_GUIDE_STEPS.length;
    }
  }
  renderDemoGuideProgress(done);
}

function completeDemoGuideStep(key) {
  if (!DEMO_MODE || !key) return;
  markDemoGuideStep(key);
}
window.completeDemoGuideStep = completeDemoGuideStep;
window.DEMO_GUIDE_STEPS = DEMO_GUIDE_STEPS;

function resetDemoGuideProgress() {
  try { localStorage.removeItem(DEMO_GUIDE_KEY); } catch (_) {}
  window.currentDemoStepIndex = 0;
  renderDemoGuideProgress(new Set());
}

function renderDemoGuideProgress(done = readDemoGuideDone()) {
  const wrap = document.getElementById('demo-guide');
  if (!wrap) return;

  if (window.currentDemoStepIndex === undefined) {
    let firstIncompleteIdx = DEMO_GUIDE_STEPS.findIndex(step => !done.has(step.key));
    if (firstIncompleteIdx === -1) firstIncompleteIdx = 0;
    window.currentDemoStepIndex = firstIncompleteIdx;
  }

  DEMO_GUIDE_STEPS.forEach((step, idx) => {
    const stepEl = wrap.querySelector(`[data-demo-step="${step.key}"]`);
    if (stepEl) {
      stepEl.classList.toggle('done', done.has(step.key));
      stepEl.classList.toggle('active', idx === window.currentDemoStepIndex);
    }
  });

  const count = wrap.querySelector('[data-demo-guide-count]');
  if (count) {
    count.textContent = `Task ${window.currentDemoStepIndex + 1}/${DEMO_GUIDE_STEPS.length} (${done.size} done)`;
  }
  
  const pct = (done.size / DEMO_GUIDE_STEPS.length) * 100;
  const progressBar = wrap.querySelector('#demo-guide-progress-bar');
  if (progressBar) {
    progressBar.style.width = `${pct}%`;
  }
  
  const allComplete = done.size >= DEMO_GUIDE_STEPS.length;
  wrap.classList.toggle('complete', allComplete);
  wrap.classList.toggle('show-onboarding', allComplete);
}

function demoGuideScrollTo(selector) {
  document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function firstDemoIssueCard() {
  const openIssue = issues.find(issue => currentStatus(issue).status !== 'resolved') || issues[0];
  const escapedId = openIssue && window.CSS?.escape ? CSS.escape(openIssue.id) : String(openIssue?.id || '').replace(/"/g, '\\"');
  const row = openIssue ? document.querySelector(`.issue-row[data-id="${escapedId}"]`) : null;
  return row?.querySelector('.issue-card') || document.querySelector('.issue-card');
}

function flashDemoGuideTarget(el) {
  if (!el) return;
  el.classList.remove('demo-guide-flash');
  void el.offsetWidth;
  el.classList.add('demo-guide-flash');
  window.setTimeout(() => el.classList.remove('demo-guide-flash'), 1400);
}

function demoGuideStepVisual(step) {
  if (step?.visual !== 'route') return '';
  return `<div class="demo-guide-route-flow" aria-label="Swipe left or tap add status entry, then pick a category and subcategory">
    <span class="demo-route-chip">Swipe left</span>
    <span class="demo-route-or">or</span>
    <span class="demo-route-chip">+ Add</span>
    <span class="demo-route-arrow">→</span>
    <span class="demo-route-chip accent">Category</span>
    <span class="demo-route-arrow">→</span>
    <span class="demo-route-chip">Sub / Skip</span>
  </div>`;
}

function runDemoGuideAction(action, key) {
  switch (action) {
    case 'floor':
      window.setMapMode?.('log');
      demoGuideScrollTo('#floor-map');
      flashDemoGuideTarget(document.getElementById('floor-map'));
      break;
    case 'log': {
      window.setMapMode?.('log');
      const machine = Object.values(PRESSES).flat()[0] || '1.01';
      window.openAddModal?.(machine);
      break;
    }
    case 'route': {
      demoGuideScrollTo('.issues-section');
      const card = firstDemoIssueCard();
      flashDemoGuideTarget(card);
      break;
    }
    case 'workflow': {
      demoGuideScrollTo('.issues-section');
      const card = firstDemoIssueCard();
      const target = card?.querySelector('.wf-steps-wrap') || card;
      flashDemoGuideTarget(target);
      break;
    }
    case 'filters':
      if (!document.getElementById('filter-drawer')?.classList.contains('open')) window.toggleFilterDrawer?.();
      demoGuideScrollTo('.controls');
      flashDemoGuideTarget(document.getElementById('filter-drawer'));
      break;
    case 'export':
      demoGuideScrollTo('.issues-section');
      if (!document.getElementById('export-dropdown')?.classList.contains('visible')) window.toggleExportDropdown?.();
      flashDemoGuideTarget(document.getElementById('export-dropdown-wrap'));
      break;
    case 'tools':
      demoGuideScrollTo('header');
      if (!document.getElementById('header-quick-menu')?.classList.contains('visible')) toggleHeaderQuickMenu();
      flashDemoGuideTarget(document.getElementById('header-quick-wrap'));
      break;
    case 'tour':
      window.openTutorial?.();
      break;
    default:
      break;
  }
}

function buildDemoGuide() {
  if (!DEMO_MODE || document.getElementById('demo-guide')) return;
  const sectionHeader = document.querySelector('.section-header');
  if (!sectionHeader) return;

  const guide = document.createElement('section');
  guide.id = 'demo-guide';
  guide.className = 'demo-guide';
  guide.innerHTML = `
    <div class="demo-guide-head">
      <div>
        <div class="demo-guide-kicker">Demo Guide</div>
        <div class="demo-guide-title">Explore AP Tracker at your own pace</div>
      </div>
      <div class="demo-guide-actions">
        <div class="demo-guide-nav">
          <button class="demo-guide-nav-btn" type="button" data-demo-guide-prev aria-label="Previous step">&larr;</button>
          <span class="demo-guide-count" data-demo-guide-count>Task 1/${DEMO_GUIDE_STEPS.length}</span>
          <button class="demo-guide-nav-btn" type="button" data-demo-guide-next aria-label="Next step">&rarr;</button>
        </div>
        <button class="demo-guide-reset-btn" type="button" data-demo-guide-reset>Reset</button>
        <button class="demo-guide-tour-btn" type="button" data-demo-guide-action="tour">Start tour</button>
        <button class="demo-guide-collapse" type="button" data-demo-guide-toggle aria-expanded="true">Hide</button>
      </div>
    </div>
    <div class="demo-guide-body">
      ${DEMO_GUIDE_STEPS.map(step => `
        <div class="demo-guide-step" data-demo-step="${step.key}">
          <div class="demo-guide-check">✓</div>
          <div class="demo-guide-step-copy">
            <div class="demo-guide-step-title">${esc(step.title)}</div>
            <div class="demo-guide-step-desc">${esc(step.desc)}</div>
            ${demoGuideStepVisual(step)}
          </div>
          <button class="demo-guide-step-btn" type="button" data-demo-guide-action="${esc(step.action)}" data-demo-guide-key="${esc(step.key)}">${esc(step.btn)}</button>
        </div>
      `).join('')}
      <div class="demo-guide-onboarding" id="demo-guide-onboarding">
        <div class="demo-guide-onboarding-title">🎉 Mastered! Create Your Live Plant</div>
        <div class="demo-guide-onboarding-desc">Ready to build your own AP Tracker? Enter your plant details below to initialize your live production workspace:</div>
        <div class="demo-guide-onboarding-form">
          <input type="text" id="demo-onboarding-plant-name" placeholder="Plant Name (e.g. Chicago Assembly Floor)" required>
          <select id="demo-onboarding-role">
            <option value="Production Lead">Production Lead</option>
            <option value="Plant Manager">Plant Manager</option>
            <option value="Maintenance Specialist">Maintenance Specialist</option>
            <option value="CI Specialist">CI Specialist</option>
            <option value="Operator">Machine Operator</option>
          </select>
          <button class="demo-guide-onboarding-btn" type="button" id="demo-onboarding-submit-btn">Create Live Plant</button>
        </div>
      </div>
    </div>
    <div class="demo-guide-progress-bar-wrap">
      <div class="demo-guide-progress-bar" id="demo-guide-progress-bar"></div>
    </div>`;
  sectionHeader.parentNode.insertBefore(guide, sectionHeader);
  renderDemoGuideProgress();
}

async function handleOnboardingSubmit(btn) {
  const nameInput = document.getElementById('demo-onboarding-plant-name');
  const roleSelect = document.getElementById('demo-onboarding-role');
  if (!nameInput || !roleSelect) return;
  const plantName = nameInput.value.trim();
  const userRole = roleSelect.value;
  if (!plantName) {
    alert("⚠️ Plant name is required.");
    nameInput.focus();
    return;
  }
  
  btn.disabled = true;
  btn.textContent = "Authenticating...";
  
  try {
    // Prevent the Demo Mode auth listener from signing out the Google user
    sessionStorage.setItem('demo_onboarding_in_progress', 'true');
    
    // 1. Sign in with Google to get permanent user credentials
    let user;
    if (window.__testGoogleUser) {
      user = window.__testGoogleUser;
    } else {
      const result = await signInWithPopup(auth, provider);
      user = result.user;
    }
    if (!user) throw new Error("Google Authentication failed.");
    
    btn.textContent = "Creating plant...";
    
    // 2. Create the new Plant document & configurations sequentially
    const plantId = plantName.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36);
    
    const defaultPermissions = {
      isAdmin: true,
      canResolve: true,
      canEditTimeline: true,
      canDeleteIssues: true
    };
    
    // Set plant doc metadata
    await setDoc(doc(db, 'plants', plantId), {
      name: plantName,
      location: '',
      createdAt: serverTimestamp(),
      isActive: true
    });
    
    // Set members doc (User is Admin/Owner of the new plant)
    await setDoc(plantMemberDocRef(plantId, user.uid), {
      userId: user.uid,
      displayName: user.displayName || user.email || '',
      email: user.email || '',
      photoURL: user.photoURL || '',
      role: 'admin',
      userRole: userRole,
      isActive: true,
      addedAt: serverTimestamp(),
      permissions: defaultPermissions
    });
    
    // Initialize config documents (now that member doc exists, security rules will pass!)
    await setDoc(doc(db, 'plants', plantId, 'config', 'presses'), { presses: DEFAULT_PRESSES });
    await setDoc(doc(db, 'plants', plantId, 'config', 'statuses'), {
      statuses: deepCopy(DEFAULT_STATUSES),
      subcategoryRoutes: {}
    });
    
    // Initialize gamification config
    const defaultGameConfig = {
      rules: {
        issue_create: { label: 'Log an issue', trigger: 'issue_create', points: 10 },
        issue_resolve: { label: 'Resolve an issue', trigger: 'issue_resolve', points: 25 },
        event_add: { label: 'Add update note', trigger: 'event_add', points: 5 },
        photo_upload: { label: 'Upload photo / attachment', trigger: 'photo_upload', points: 15 }
      },
      missions: {},
      badges: {},
      xpFormula: { base: 100, exponent: 1.5 }
    };
    await setDoc(doc(db, 'plants', plantId, 'gamificationConfig', 'main'), {
      ...defaultGameConfig,
      updatedAt: serverTimestamp()
    });
    
    // Set user profile doc
    await setDoc(doc(db, 'users', user.uid), {
      displayName: user.displayName || '',
      email: user.email || '',
      plantIds: arrayUnion(plantId),
      role: userRole,
      lastPlant: plantId
    }, { merge: true });
    
    // Explicitly remove demo plant from their permanent list
    try {
      await setDoc(doc(db, 'users', user.uid), {
        plantIds: arrayRemove(DEMO_PLANT_ID)
      }, { merge: true });
    } catch (e) {
      console.warn("Failed to remove demo plant ID:", e);
    }
    
    // Clear flags
    sessionStorage.removeItem('demo_onboarding_in_progress');
    sessionStorage.removeItem('demo_signed_out');
    
    // Redirect out of demo mode by stripping "?demo=1" and setting the newly created plant ID
    const url = new URL(window.location.href);
    url.searchParams.delete('demo');
    url.searchParams.set('plant', plantId);
    
    btn.textContent = "Done! Redirecting...";
    window.location.href = url.toString();
  } catch (e) {
    console.error("Onboarding failed:", e);
    sessionStorage.removeItem('demo_onboarding_in_progress');
    alert("❌ Error: " + (e.message || "Failed to create plant."));
    btn.disabled = false;
    btn.textContent = "Create Live Plant";
  }
}

onAuthStateChanged(auth, async user => {
  if (!user) apiSessionClient.clear();
  if (DEMO_MODE) {
    const explicitlySignedOut = sessionStorage.getItem('demo_signed_out') === 'true';
    if (!user) {
      if (explicitlySignedOut) {
        stopRoleFeedAlertsWatcher();
        clearRoleAlertBadge();
        stopStatusConfigListener();
        if (_messagingInboxUnsubscribe) { _messagingInboxUnsubscribe(); _messagingInboxUnsubscribe = null; }
        _updateMessagingEntryBadges(0);
        currentUser = null;
        document.getElementById('login-screen').classList.add('visible');
        document.getElementById('app').classList.remove('visible');
        issues = [];
        issuesById.clear();
        issueHistoryCursor = null;
        issueHistoryFetchInFlight = null;
        attachmentPhotoCache.clear();
        issueEventHistoryCache.clear();
        attachmentsHydrationToken++;
        eventsHydrationToken++;
        resetGoogleSignInButton();
      } else {
        try { await signInAnonymously(auth); } catch (e) { console.error('Demo anon sign-in failed:', e); showDemoAuthError(e); }
      }
      return;
    }
    if (!user.isAnonymous) {
      if (sessionStorage.getItem('demo_onboarding_in_progress') === 'true') {
        return;
      }
      try {
        await fbSignOut(auth);
        await signInAnonymously(auth);
      } catch (e) {
        console.error('Demo anon sign-in failed:', e);
        showDemoAuthError(e);
      }
      return;
    }
    await bootstrapDemoSession(user);
    return;
  }
  if (NO_AUTH_MODE) {
    await bootstrapNoAuthSession();
    return;
  }
  let resolvedUser = user;
  if (resolvedUser) {
    try {
      await bootstrapSignedInSession(resolvedUser);
    } catch (e) {
      console.error('Session bootstrap failed:', e);
      setSyncStatus('err', 'Could not load your plant data. Check connection and retry.');
      document.getElementById('issues-list').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-text" style="margin-bottom:12px;">Unable to load your data right now.</div>
          <button onclick="window.location.reload()" style="font-size:13px;padding:8px 18px;border-radius:8px;border:1px solid var(--color-accent, var(--accent));background:transparent;color:var(--color-accent, var(--accent));cursor:pointer;font-family:'Nunito',sans-serif;">Reload</button>
        </div>`;
    }
  } else {
    stopRoleFeedAlertsWatcher();
    clearRoleAlertBadge();
    stopStatusConfigListener();
    if (_messagingInboxUnsubscribe) { _messagingInboxUnsubscribe(); _messagingInboxUnsubscribe = null; }
    _updateMessagingEntryBadges(0);
    currentUser = null;
    document.getElementById('login-screen').classList.add('visible');
    document.getElementById('app').classList.remove('visible');
    issues = [];
    issuesById.clear();
    issueHistoryCursor = null;
    issueHistoryFetchInFlight = null;
    attachmentPhotoCache.clear();
    issueEventHistoryCache.clear();
    attachmentsHydrationToken++;
    eventsHydrationToken++;
    resetGoogleSignInButton();
  }
});

// Pause issues listener when the page is hidden (another tab open) to avoid
// cross-tab persistence contention causing spurious permission-denied errors.
document.addEventListener('visibilitychange', () => {
  pageHidden = document.hidden;
  if (pageHidden) {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (retryTimeout) { clearTimeout(retryTimeout); retryTimeout = null; }
    if (issueBootstrapTimeout) { clearTimeout(issueBootstrapTimeout); issueBootstrapTimeout = null; }
  } else if (currentPlantId && currentUser) {
    startListener();
  }
});

let retryTimeout = null;
let retryCount = 0;
let issueBootstrapTimeout = null;
let sqlIssuePollTimer = null;
let lastSqlIssuePollPlantId = '';
let lastSqlIssuePollSignature = '';
const ISSUE_LISTENER_RETRY_BASE_MS = 500;
const ISSUE_LISTENER_RETRY_MAX_MS = 10000;
const ISSUE_LISTENER_RETRY_JITTER = 0.2;
const ISSUE_LISTENER_BOOTSTRAP_FALLBACK_MS = 3000;
const SQL_ISSUE_POLL_MS = 10000;

function nextIssueListenerRetryDelay(attempt) {
  const safeAttempt = Math.max(1, Number(attempt) || 1);
  const exponentialDelay = ISSUE_LISTENER_RETRY_BASE_MS * (2 ** (safeAttempt - 1));
  const cappedDelay = Math.min(exponentialDelay, ISSUE_LISTENER_RETRY_MAX_MS);
  const jitterFactor = 1 - ISSUE_LISTENER_RETRY_JITTER + (Math.random() * ISSUE_LISTENER_RETRY_JITTER * 2);
  return Math.round(cappedDelay * jitterFactor);
}

function formatRetryDelay(delayMs) {
  if (delayMs < 1000) return '<1s';
  return `${Math.round(delayMs / 1000)}s`;
}

function buildIssueFromSnapshot(docSnap) {
  const data = docSnap.data() || {};
  const cachedPhotos = attachmentPhotoCache.get(docSnap.id);
  const cachedHistory = issueEventHistoryCache.get(docSnap.id);
  return {
    id: docSnap.id,
    ...data,
    machine: data.machine || data.machineCode || '',
    resolved: typeof data.resolved === 'boolean' ? data.resolved : !!data.lifecycle?.isResolved,
    photos: Array.isArray(data.photos) && data.photos.length ? data.photos : (cachedPhotos || data.photos || []),
    eventHistory: cachedHistory || data.eventHistory || []
  };
}

function rebuildIssuesArrayFromMap() {
  issues = Array.from(issuesById.values());
}

async function loadIssueHistoryPage() {
  if (shouldUseSqlStagingReads(currentPlantId)) return;
  if (!currentPlantId || !issueHistoryCursor || issueHistoryFetchInFlight) return;
  const cursor = issueHistoryCursor;
  issueHistoryFetchInFlight = (async () => {
    const q = query(plantCol('issues'), orderBy('createdAt', 'desc'), startAfter(cursor), limit(HISTORY_ISSUES_PAGE_SIZE));
    const snap = await getDocs(q);
    if (snap.empty) {
      issueHistoryCursor = null;
      return;
    }
    snap.docs.forEach(d => {
      if (!issuesById.has(d.id)) issuesById.set(d.id, buildIssueFromSnapshot(d));
    });
    issueHistoryCursor = snap.docs[snap.docs.length - 1] || null;
    rebuildIssuesArrayFromMap();
    refreshVisibleData();
  })().finally(() => {
    issueHistoryFetchInFlight = null;
  });
  return issueHistoryFetchInFlight;
}

async function refreshIssuesFromSql() {
  const payload = await requireSqlRead(
    `issues ${currentPlantId}`,
    () => dataApi.listIssues(currentPlantId, { limit: 500 }),
    `Issues are missing in D1 for plant ${currentPlantId}.`
  );
  const nextSignature = JSON.stringify(payload.issues || []);
  const didPlantChange = lastSqlIssuePollPlantId !== currentPlantId;
  const didIssueSetChange = didPlantChange || lastSqlIssuePollSignature !== nextSignature;
  lastSqlIssuePollPlantId = currentPlantId;
  lastSqlIssuePollSignature = nextSignature;
  if (!didIssueSetChange) {
    void _refreshRoleAlertBadgeCount();
    refreshSyncState({
      status: 'live',
      fromCache: false,
      hasPendingWrites: false,
      lastServerAt: Date.now(),
      lastError: null,
      manualText: 'Live - synced from D1'
    });
    return true;
  }
  const normalized = normalizeSqlIssueList(payload.issues || []);
  issuesById.clear();
  normalized.forEach(issue => {
    issuesById.set(issue.id, issue);
  });
  rebuildIssuesArrayFromMap();
  refreshVisibleData();
  void _refreshRoleAlertBadgeCount();
  refreshSyncState({
    status: 'live',
    fromCache: false,
    hasPendingWrites: false,
    lastServerAt: Date.now(),
    lastError: null,
    manualText: 'Live - synced from D1'
  });
  return true;
}

function stopSqlIssuePolling() {
  if (sqlIssuePollTimer) {
    clearTimeout(sqlIssuePollTimer);
    sqlIssuePollTimer = null;
  }
  lastSqlIssuePollPlantId = '';
  lastSqlIssuePollSignature = '';
}

function startSqlIssuePolling() {
  stopSqlIssuePolling();
  if (!currentPlantId || !shouldUseSqlStagingReads(currentPlantId)) return;
  let active = true;
  unsubscribe = () => {
    active = false;
    stopSqlIssuePolling();
    unsubscribe = null;
  };
  const poll = async () => {
    if (!active || pageHidden || !currentPlantId) return;
    try {
      const ok = await refreshIssuesFromSql();
      if (ok) setSyncStatus('ok', 'Live - synced from D1');
      else setSyncStatus('err', 'D1 issue poll failed');
    } catch (error) {
      console.warn('SQL issue poll failed', error);
      setSyncStatus('err', 'D1 issue poll failed');
    }
    if (active) {
      sqlIssuePollTimer = setTimeout(poll, SQL_ISSUE_POLL_MS);
    }
  };
  void poll();
}

function startListener() {
  if (pageHidden) return;
  if (unsubscribe) unsubscribe();
  stopSqlIssuePolling();
  if (retryTimeout) { clearTimeout(retryTimeout); retryTimeout = null; }
  if (issueBootstrapTimeout) { clearTimeout(issueBootstrapTimeout); issueBootstrapTimeout = null; }
  if (!currentPlantId) return;
  if (shouldUseSqlStagingReads(currentPlantId)) {
    startSqlIssuePolling();
    return;
  }

  const q = query(plantCol('issues'), orderBy('createdAt', 'desc'), limit(MAX_LIVE_ISSUES));
  let firstSnapshotReceived = false;
  unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, snap => {
    firstSnapshotReceived = true;
    observeSyncSnapshot(snap);
    if (!snap.metadata?.fromCache) {
      removeSyncedOutboxItemsFromSnapshot(snap);
      scheduleIssueOutboxFlush();
    }
    if (issueBootstrapTimeout) { clearTimeout(issueBootstrapTimeout); issueBootstrapTimeout = null; }
    retryCount = 0; // reset on success
    snap.docChanges().forEach(change => {
      if (change.type === 'removed') {
        const removedIssueId = change.doc.id;
        issuesById.delete(removedIssueId);
        issueEventHistoryCache.delete(removedIssueId);
        issueDetailsHydrationInFlight.delete(removedIssueId);
        return;
      }
      issuesById.set(change.doc.id, buildIssueFromSnapshot(change.doc));
    });
    rebuildIssuesArrayFromMap();
    refreshVisibleData();
    void _refreshRoleAlertBadgeCount();
    if (!issueHistoryCursor && snap.docs.length) {
      issueHistoryCursor = snap.docs[snap.docs.length - 1];
    }
    if (snap.metadata?.hasPendingWrites) {
      setSyncStatus('syncing', 'Syncing - local changes pending');
    }
  }, err => {
    console.error('Snapshot error:', err);
    const isPermissionError = err?.code === 'permission-denied';
    if (isPermissionError) {
      if (DEMO_MODE) {
        seedInMemoryDemoIssues();
        setSyncStatus('ok', 'Offline Demo Sandbox — loaded local dummy data');
        return;
      }
      setSyncStatus('err', 'Access denied. Reload the page if this persists.');
      return;
    }
    if (DEMO_MODE) {
      seedInMemoryDemoIssues();
      setSyncStatus('ok', 'Offline Demo Sandbox — loaded local dummy data');
      return;
    }
    retryCount++;
    const delay = nextIssueListenerRetryDelay(retryCount);
    setSyncStatus('err', `Connection lost. Retrying in ${formatRetryDelay(delay)}…`);
    refreshVisibleData();
    retryTimeout = setTimeout(() => startListener(), delay);
  });
  issueBootstrapTimeout = setTimeout(async () => {
    if (firstSnapshotReceived || !currentPlantId) return;
    try {
      const snap = await getDocs(q);
      if (firstSnapshotReceived || !currentPlantId) return;
      issuesById.clear();
      snap.docs.forEach(d => issuesById.set(d.id, buildIssueFromSnapshot(d)));
      rebuildIssuesArrayFromMap();
      refreshVisibleData();
      void _refreshRoleAlertBadgeCount();
      if (snap.docs.length) {
        issueHistoryCursor = snap.docs[snap.docs.length - 1];
      }
      setSyncStatus(syncState.online ? 'cached' : 'offline', syncState.online ? 'Cached - showing saved data' : 'Offline - showing cached data');
    } catch (e) {
      console.warn('Bootstrap issues fallback read failed:', e);
      if (DEMO_MODE) {
        seedInMemoryDemoIssues();
        setSyncStatus('ok', 'Offline Demo Sandbox — loaded local dummy data');
      } else {
        setSyncStatus('err', 'Offline — unable to sync issues');
        rebuildIssuesArrayFromMap();
        refreshVisibleData();
      }
    }
  }, ISSUE_LISTENER_BOOTSTRAP_FALLBACK_MS);
}

// ── SYNC ──
function setSyncStatus(status, text) {
  const normalized = status === 'ok'
    ? 'live'
    : status === 'err'
      ? 'error'
      : status === 'syncing'
        ? 'syncing'
        : status === 'cached'
          ? 'cached'
          : status === 'offline'
            ? 'offline'
            : 'switching';
  refreshSyncState({
    status: normalized,
    manualText: text || '',
    lastError: normalized === 'error' ? text || 'Connection error' : null,
    lastServerAt: normalized === 'live' ? Date.now() : syncState.lastServerAt,
    fromCache: normalized === 'live' ? false : syncState.fromCache
  });
}

window.addEventListener('online', () => {
  refreshSyncState({ status: null, online: true, lastError: null, manualText: '' });
  if (currentPlantId && currentUser && !pageHidden && !unsubscribe) startListener();
  scheduleIssueOutboxFlush();
});
window.addEventListener('offline', () => {
  refreshSyncState({ status: 'offline', online: false, manualText: 'Offline - showing cached data' });
});
applySyncBanner();

async function refreshMigrationReadiness() {
  if (!shouldUseSqlBootstrap()) {
    migrationReadinessState.loading = false;
    migrationReadinessState.data = null;
    migrationReadinessState.error = '';
    migrationReadinessState.checkedAt = 0;
    renderMigrationStatusPill();
    return null;
  }
  migrationReadinessState.loading = true;
  migrationReadinessState.error = '';
  renderMigrationStatusPill();
  try {
    const payload = await dataApi.getMigrationReadiness();
    migrationReadinessState.data = payload || null;
    migrationReadinessState.checkedAt = Date.now();
    return payload;
  } catch (error) {
    migrationReadinessState.error = error?.message || 'Could not load SQL migration readiness.';
    migrationReadinessState.checkedAt = Date.now();
    return null;
  } finally {
    migrationReadinessState.loading = false;
    renderMigrationStatusPill();
  }
}

// ── SCOPE TOGGLE ──
window.setScope = s => {
  issueScope = s;
  ['all','mine'].forEach(x => document.getElementById('scope-'+x).classList.toggle('active', x===s));
  renderIssues(); updatePressStates(); updateStats();
  completeDemoGuideStep('filters');
};

// ── SHIFT FILTER ──
const SHIFT_FILTER_OPTIONS = [
  { value: 'all', label: 'All Shifts' },
  { value: 'first', label: '1st Shift' },
  { value: 'second', label: '2nd Shift' },
  { value: 'third', label: '3rd Shift' },
];
const shiftDropdown = createDropdownController({
  dropdownId: 'shift-dropdown',
  buttonId: 'shift-dropdown-btn',
  wrapId: 'shift-dropdown-wrap'
});

function getShiftFilterLabel(value) {
  return SHIFT_FILTER_OPTIONS.find(opt => opt.value === value)?.label || 'All Shifts';
}

function syncShiftFilterUi() {
  const activeValue = SHIFT_FILTER_OPTIONS.some(opt => opt.value === issueShiftFilter) ? issueShiftFilter : 'all';
  const label = document.getElementById('shift-filter-label');
  if (label) label.textContent = getShiftFilterLabel(activeValue);
  const btn = document.getElementById('shift-dropdown-btn');
  if (btn) btn.classList.toggle('active', true);
  document.querySelectorAll('#shift-dropdown [data-shell-value]').forEach(opt => {
    const isActive = opt.dataset.shellValue === activeValue;
    opt.classList.toggle('active', isActive);
    const check = opt.querySelector('.sort-opt-check');
    if (check) check.textContent = isActive ? '✓' : '';
  });
}

function closeShiftDropdown() {
  shiftDropdown.close();
}

window.toggleShiftDropdown = shiftDropdown.toggle;

window.setShiftFilter = s => {
  issueShiftFilter = SHIFT_FILTER_OPTIONS.some(opt => opt.value === s) ? s : 'all';
  syncShiftFilterUi();
  closeShiftDropdown();
  renderIssues(); updateFilterBadge();
  completeDemoGuideStep('filters');
};

// ── PERIOD TOGGLE ──
window.setPeriod = (s, options = {}) => {
  issuePeriod = s;
  ['today','24h','week','month','all'].forEach(x => document.getElementById('period-'+x).classList.toggle('active', x===s));
  document.getElementById('period-date').classList.remove('active');
  if (s === 'today') {
    document.getElementById('date-filter').value = localDateStr(new Date());
  } else {
    document.getElementById('date-filter').value = '';
  }
  updatePeriodTriggerLabel(s);
  updateCalLabel(document.getElementById('date-filter').value || localDateStr(new Date()), false);
  renderIssues(); updatePressStates(); updateStats();
  loadDailyScheduledPresses(scheduleDateForLookup());
  if (!options.silentDemoGuide) completeDemoGuideStep('filters');
};

window.onCalendarPick = val => {
  if (!val) return;
  ['today','24h','week','month','all'].forEach(x => document.getElementById('period-'+x).classList.remove('active'));
  document.getElementById('period-date').classList.add('active');
  issuePeriod = 'date';
  updatePeriodTriggerLabel(val);
  updateCalLabel(val, true);
  renderIssues(); updatePressStates(); updateStats(); updateFilterBadge();
  loadDailyScheduledPresses(val);
  completeDemoGuideStep('filters');
};

// ── DATE FILTER ──
function setTodayDate() {
  const today = localDateStr(new Date());
  document.getElementById('date-filter').value = today;
  updatePeriodTriggerLabel('today');
  updateCalLabel(today, false);
}

window.clearDate = () => {
  document.getElementById('date-filter').value = '';
  updatePeriodTriggerLabel('all');
  issuePeriod = 'all';
  ['today','24h','week','month','all'].forEach(x => document.getElementById('period-'+x).classList.toggle('active', x==='all'));
  renderIssues(); updatePressStates(); updateStats();
  loadDailyScheduledPresses(localDateStr(new Date()));
};

// Compute time window for period filter
function periodFilter(i) {
  const now = Date.now();
  const ts = i.timestamp || 0;
  const dateVal = document.getElementById('date-filter')?.value || '';
  if (issuePeriod === 'today') return i.dateKey === localDateStr(new Date());
  if (issuePeriod === 'date' && dateVal) return i.dateKey === dateVal;
  if (issuePeriod === '24h')   return ts >= now - 24*60*60*1000;
  if (issuePeriod === 'week')  return ts >= now - 7*24*60*60*1000;
  if (issuePeriod === 'month') return ts >= now - 30*24*60*60*1000;
  return true; // 'all'
}

// ── FLOOR MAP ──

async function refreshPressContributionIndex(force = false) {
  if (!currentPlantId) return;
  if (!force && pressContributionPlantId === currentPlantId && pressContributionIndex.size) return;
  if (pressContributionLoading) return pressContributionLoading;
  pressContributionLoading = (async () => {
    const next = new Map();
    const notesSnap = await getDocs(plantCol('pressNotes'));
    notesSnap.forEach(d => {
      const data = d.data() || {};
      const key = toPressId(data.machineCode || data.pressId || '');
      if (!key) return;
      const entry = next.get(key) || { hasNotes: false, hasWiki: false, noteCount: 0 };
      entry.hasNotes = true;
      entry.noteCount += 1;
      next.set(key, entry);
    });

    const plantNotesSnap = await getDocs(plantCol('notes'));
    plantNotesSnap.forEach(d => {
      const data = d.data() || {};
      const key = toPressId(data.machineCode || data.pressId || data.linkedPressId || '');
      if (!key) return;
      const entry = next.get(key) || { hasNotes: false, hasWiki: false, noteCount: 0 };
      entry.hasNotes = true;
      entry.noteCount += 1;
      next.set(key, entry);
    });

    const allMachines = Object.values(PRESSES || {}).flat().filter(Boolean);
    await Promise.all(allMachines.map(async machineCode => {
      const pressId = toPressId(machineCode);
      if (!pressId) return;
      const pagesSnap = await getDocs(pressWikiPagesCol(pressId));
      if (pagesSnap.empty) return;
      const entry = next.get(pressId) || { hasNotes: false, hasWiki: false, noteCount: 0 };
      entry.hasWiki = true;
      next.set(pressId, entry);
    }));

    pressContributionIndex = next;
    pressContributionPlantId = currentPlantId;
  })().finally(() => {
    pressContributionLoading = null;
  });
  return pressContributionLoading;
}

function pressContributionForMachine(machineCode) {
  const pressId = toPressId(machineCode);
  return pressContributionIndex.get(pressId) || { hasNotes: false, hasWiki: false, noteCount: 0 };
}

function applyPressContributionVisual(btn, machineCode) {
  const info = pressContributionForMachine(machineCode);
  btn.classList.remove('notes-signal', 'wiki-signal', 'notes-wiki-signal');
  delete btn.dataset.noteSignal;

  if (!info.hasNotes && !info.hasWiki) return;

  let signal = '';
  if (info.hasNotes && info.hasWiki) {
    signal = 'notes-wiki';
    btn.classList.add('notes-wiki-signal');
  } else if (info.hasWiki) {
    signal = 'wiki';
    btn.classList.add('wiki-signal');
  } else {
    signal = 'notes';
    btn.classList.add('notes-signal');
  }

  btn.dataset.noteSignal = signal;
  const signalText = signal === 'notes-wiki' ? 'Has notes and wiki content' : signal === 'wiki' ? 'Has wiki content' : 'Has notes';
  const currentTitle = String(btn.title || '').trim();
  btn.title = currentTitle ? `${currentTitle} · ${signalText}` : signalText;
}

// ── MAP MODE ──
window.setMapMode = mode => {
  const prevMode = mapMode;
  mapMode = mode;
  document.getElementById('mode-log').className = 'map-mode-btn' + (mode==='log' ? ' active-log' : '');
  document.getElementById('mode-hist').className = 'map-mode-btn' + (mode==='hist' ? ' active-hist' : '');
  document.getElementById('mode-notes').className = 'map-mode-btn' + (mode==='notes' ? ' active-hist' : '');
  document.getElementById('floor-map-label').textContent = mode==='log'
    ? 'FLOOR MAP — CLICK A PRESS TO REPORT AN ISSUE'
    : mode==='hist'
      ? 'FLOOR MAP — CLICK A PRESS TO VIEW TIMELINE'
      : 'FLOOR MAP — USER WIKI CONTRIBUTIONS';
  // Update all press button hover styles
  document.querySelectorAll('.press-btn').forEach(btn => {
    btn.classList.toggle('hist-mode', mode==='hist');
  });
  if (mode === 'notes') {
    void refreshPressContributionIndex(true).then(() => renderRowPanels());
  }
  if (mode === 'hist' && issuePeriod !== 'all') {
    window.setPeriod?.('all', { silentDemoGuide: true });
  }
  if (mode === 'log') {
    if (prevMode === 'hist') {
      document.getElementById('machine-filter').value = '';
      const bc = document.getElementById('machine-breadcrumb');
      if (bc) bc.classList.remove('visible');
      window.setPeriod?.('today', { silentDemoGuide: true });
    }
    document.getElementById('machine-filter').value = '';
    renderIssues(); updateFilterBadge();
  }
  renderRowTabs();
};

// ── PRESS MINI-CARD STATE ──
let activeMiniCard = null; // { machine, rowName }

window.handlePressClick = p => {
  completeDemoGuideStep('floor');
  if (mapMode === 'hist') { showMachineHistory(p); return; }
  if (mapMode === 'notes') {
    const pressId = toPressId(p);
    openPressWikiModal(pressId, p);
    return;
  }

  // Find which row this press belongs to
  let pressRow = null;
  for (const [rowName, machines] of Object.entries(PRESSES)) {
    if (machines.includes(p)) { pressRow = rowName; break; }
  }
  if (!pressRow) { openAddModal(p); return; }

  // Toggle off if same press tapped again
  if (activeMiniCard && activeMiniCard.machine === p) {
    closeMiniCard();
    return;
  }

  // Close any existing mini-card
  closeMiniCard();

  // Gather scoped issues for this press
  let scoped = issueScope==='mine' ? issues.filter(i=>i.userId===currentUser?.uid) : issues;
  scoped = scoped.filter(periodFilter);
  const pressIssues = scoped.filter(i => i.machine === p);
  const openIssues = pressIssues.filter(i => currentStatusKey(i) !== 'resolved');

  // Highlight the pressed button
  const btnEl = document.getElementById('press-'+p.replace(/[\s.]/g,'_'));
  if (btnEl) btnEl.classList.add('selected');

  // Find the mini-card area for this row
  const areaId = 'mc-area-' + pressRow.replace(/\s/g,'_');
  const area = document.getElementById(areaId);
  if (!area) { openAddModal(p); return; }

  // Cancel any pending close timer from previous card
  if (_mcCloseTimer) { clearTimeout(_mcCloseTimer); _mcCloseTimer = null; }

  activeMiniCard = { machine: p, rowName: pressRow };

  // Build mini-card
  const card = document.createElement('div');
  card.className = 'press-minicard';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'mc-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.onclick = (e) => { e.stopPropagation(); closeMiniCard(); };
  card.appendChild(closeBtn);

  // Top row: ID + status pill
  const top = document.createElement('div');
  top.className = 'mc-top';
  const idEl = document.createElement('div');
  idEl.className = 'mc-id';
  idEl.textContent = p;
  top.appendChild(idEl);

  if (openIssues.length === 0) {
    const statusPill = document.createElement('span');
    statusPill.className = 'mc-status-pill';
    statusPill.style.cssText = 'color:var(--color-success, var(--green));border-color:rgba(34,197,94,0.4);background:rgba(34,197,94,0.1);';
    statusPill.textContent = 'Clear';
    top.appendChild(statusPill);
  } else if (openIssues.length === 1) {
    const sk = currentStatusKey(openIssues[0]);
    const st = getStatusDef(sk);
    const col = getStatusColor(sk);
    const statusPill = document.createElement('span');
    statusPill.className = 'mc-status-pill';
    statusPill.style.cssText = 'color:'+col+';border-color:'+alphaColor(col,0.4)+';background:'+alphaColor(col,0.1)+';';
    statusPill.textContent = st.label;
    top.appendChild(statusPill);
  } else {
    const statusPill = document.createElement('span');
    statusPill.className = 'mc-status-pill';
    statusPill.style.cssText = 'color:var(--color-accent, var(--accent));border-color:rgba(249,115,22,0.4);background:rgba(249,115,22,0.1);';
    statusPill.textContent = openIssues.length + ' issues';
    top.appendChild(statusPill);
  }
  card.appendChild(top);

  const scheduleMount = document.createElement('div');
  const scheduleLoading = document.createElement('div');
  scheduleLoading.className = 'mc-schedule';
  scheduleLoading.innerHTML = '<div class="mc-schedule-title">Schedule</div><div class="mc-schedule-empty">Loading…</div>';
  scheduleMount.appendChild(scheduleLoading);
  card.appendChild(scheduleMount);

  const selectedScheduleDate = scheduleDateForLookup();
  getPressScheduleLookup(p, selectedScheduleDate)
    .then(lookupDoc => {
      if (!activeMiniCard || activeMiniCard.machine !== p) return;
      scheduleMount.innerHTML = '';
      renderScheduleSection(scheduleMount, lookupDoc, selectedScheduleDate);
    })
    .catch(() => {
      if (!activeMiniCard || activeMiniCard.machine !== p) return;
      scheduleMount.innerHTML = '';
      renderScheduleSection(scheduleMount, null, selectedScheduleDate);
    });

  // Issue list (if any open issues)
  if (openIssues.length > 0) {
    const issuesList = document.createElement('div');
    issuesList.className = 'mc-issues-list';
    openIssues.forEach(issue => {
      const sk = currentStatusKey(issue);
      const st = getStatusDef(sk);
      const col = getStatusColor(sk);
      const item = document.createElement('div');
      item.className = 'mc-issue-item';
      item.onclick = () => { closeMiniCard(); scrollToIssue(issue.id); };
      const bar = document.createElement('div');
      bar.className = 'mc-issue-bar';
      bar.style.background = col;
      item.appendChild(bar);
      const note = document.createElement('div');
      note.className = 'mc-issue-note';
      note.textContent = issue.note || '';
      item.appendChild(note);
      const lastEntry = issue.statusHistory && issue.statusHistory.length > 0 ? issue.statusHistory[issue.statusHistory.length-1] : null;
      if (lastEntry && lastEntry.subStatus) {
        const sub = document.createElement('span');
        sub.className = 'mc-issue-sub';
        sub.style.cssText = 'color:'+col+';border-color:'+alphaColor(col,0.4)+';';
        sub.textContent = lastEntry.subStatus;
        item.appendChild(sub);
      }
      const datePart = issue.dateTime ? issue.dateTime.replace(/,\s*\d{4}/, '') : '';
      const time = document.createElement('span');
      time.className = 'mc-issue-time';
      time.textContent = datePart;
      item.appendChild(time);
      issuesList.appendChild(item);
    });
    card.appendChild(issuesList);
  }

  // Toolbar footer
  const toolbar = document.createElement('div');
  toolbar.className = 'mc-toolbar';
  if (currentUserPermissions.canCreateIssue) {
    const addBtn = document.createElement('button');
    addBtn.className = 'mc-toolbar-btn';
    addBtn.style.color = 'var(--color-accent, var(--accent))';
    addBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' + (openIssues.length > 0 ? 'Add' : 'Report');
    addBtn.onclick = () => { closeMiniCard(); openAddModal(p); };
    toolbar.appendChild(addBtn);
  }
  // Wiki button (middle)
  const pressId = toPressId(p);
  const wikiBtn = document.createElement('button');
  wikiBtn.className = 'mc-toolbar-btn';
  wikiBtn.style.color = 'var(--color-teal, var(--teal))';
  wikiBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M3 2h10a1 1 0 011 1v8a1 1 0 01-1 1H5l-3 2V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>Wiki';
  wikiBtn.onclick = () => { closeMiniCard(); openPressWikiModal(pressId, p); };
  // Badge dot if wiki content exists (load count async without blocking)
  (async () => {
    try {
      const q = query(plantCol('pressNotes'), where('pressId', '==', pressId));
      const snap = await getDocs(q);
      if (snap.size > 0) {
        const dot = document.createElement('span');
        dot.className = 'mc-notes-dot';
        wikiBtn.appendChild(dot);
      }
    } catch(e) {}
  })();
  toolbar.appendChild(wikiBtn);
  const notesBtn = document.createElement('button');
  notesBtn.className = 'mc-toolbar-btn';
  notesBtn.style.color = 'var(--color-warning, var(--yellow))';
  notesBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M3 2h10v10l-2 2H3V2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 5h6M5 8h4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>Notes';
  notesBtn.onclick = () => { closeMiniCard(); window.openNotesModalFromPress?.(p); };
  toolbar.appendChild(notesBtn);
  const timelineBtn = document.createElement('button');
  timelineBtn.className = 'mc-toolbar-btn';
  timelineBtn.style.color = 'var(--color-info, var(--blue))';
  timelineBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M8 2v6l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/></svg>Timeline';
  timelineBtn.onclick = () => { closeMiniCard(); showMachineHistory(p); };
  toolbar.appendChild(timelineBtn);
  card.appendChild(toolbar);

  area.innerHTML = '';
  area.appendChild(card);
  area.classList.add('visible');
};

let _mcCloseTimer = null;
function closeMiniCard() {
  if (_mcCloseTimer) { clearTimeout(_mcCloseTimer); _mcCloseTimer = null; }
  if (!activeMiniCard) return;
  const areaId = 'mc-area-' + activeMiniCard.rowName.replace(/\s/g,'_');
  const area = document.getElementById(areaId);
  if (area) {
    area.classList.remove('visible');
    _mcCloseTimer = setTimeout(() => { if (!area.classList.contains('visible')) area.innerHTML = ''; _mcCloseTimer = null; }, 250);
  }
  const btnEl = document.getElementById('press-'+activeMiniCard.machine.replace(/[\s.]/g,'_'));
  if (btnEl) btnEl.classList.remove('selected');
  activeMiniCard = null;
}

window.showMachineHistory = machine => {
  // Set the machine filter dropdown and re-render the issue log
  const sel = document.getElementById('machine-filter');
  sel.value = machine;
  // Show breadcrumb
  const bc = document.getElementById('machine-breadcrumb');
  if (bc) { bc.classList.add('visible'); document.getElementById('breadcrumb-machine').textContent = 'Press ' + machine; }
  if (issuePeriod !== 'all') {
    window.setPeriod?.('all');
  }
  // Scroll down to the issue log smoothly
  document.querySelector('.issues-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  renderIssues(); updateFilterBadge();
};

window.clearMachineBreadcrumb = () => {
  const sel = document.getElementById('machine-filter');
  sel.value = '';
  const bc = document.getElementById('machine-breadcrumb');
  if (bc) bc.classList.remove('visible');
  renderIssues(); updateFilterBadge();
};

window.closeMachineHistory = () => {
  clearMachineBreadcrumb();
  setMapMode('log');
};

// Load collapsed state from localStorage
// ── ROW TAB STATE ──
// Load persisted row state
let savedRows = [];
try { savedRows = JSON.parse(localStorage.getItem('activeRows') || '[]'); } catch(e) {}
const activeRows = new Set(savedRows);
let savedResolvedRows = [];
try { savedResolvedRows = JSON.parse(localStorage.getItem('showResolvedRows') || '[]'); } catch(e) {}
const showResolvedRows = new Set(savedResolvedRows);
function saveResolvedRows() { try { localStorage.setItem('showResolvedRows', JSON.stringify([...showResolvedRows])); } catch(e) {} }
let savedHideUnscheduledRows = [];
try { savedHideUnscheduledRows = JSON.parse(localStorage.getItem('hideUnscheduledRows') || '[]'); } catch(e) {}
const hideUnscheduledRows = new Set(savedHideUnscheduledRows);
function saveHideUnscheduledRows() { try { localStorage.setItem('hideUnscheduledRows', JSON.stringify([...hideUnscheduledRows])); } catch(e) {} }

function saveActiveRows() {
  try { localStorage.setItem('activeRows', JSON.stringify([...activeRows])); } catch(e) {}
}

function buildFloorMap() {
  // Populate machine filter dropdown
  const sel = document.getElementById('machine-filter');
  sel.innerHTML = '<option value="">All Machines</option>';
  Object.values(PRESSES).flat().forEach(p => {
    const opt = document.createElement('option'); opt.value = p; opt.textContent = p;
    sel.appendChild(opt);
  });
  renderRowTabs();
}

function renderRowTabs() {
  const tabsEl = document.getElementById('row-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = '';

  // --- NEW SORTING LOGIC START ---
  const sortedRowNames = Object.keys(PRESSES).sort((a, b) => {
    // Extract numbers (e.g., "Row 2" becomes 2)
    const numA = parseInt(a.replace(/\D/g, '')) || 999;
    const numB = parseInt(b.replace(/\D/g, '')) || 999;
    return numA - numB;
  });
  // --- NEW SORTING LOGIC END ---

  // Change the loop to use the new sortedRowNames array
  for (const rowName of sortedRowNames) {
    const hasIssues = rowHasOpenIssues(rowName);
    const isActive = activeRows.has(rowName);
    const tab = document.createElement('button');
    tab.className = 'row-tab' + (hasIssues ? ' has-issues' : '') + (isActive ? ' active' : '');
    
    tab.onclick = () => {
      completeDemoGuideStep('floor');
      if (activeRows.has(rowName)) activeRows.delete(rowName);
      else activeRows.add(rowName);
      saveActiveRows();
      renderRowTabs();
      renderRowPanels();
      if (issueRowScope === 'active') renderIssues();
    };

    if (hasIssues && !isActive) {
      const dot = document.createElement('span');
      dot.className = 'tab-pulse';
      tab.appendChild(dot);
    } else if (hasIssues && isActive) {
      tab.appendChild(Object.assign(document.createElement('span'), {className:'tab-dot'}));
    }
    
    tab.appendChild(document.createTextNode(rowName.replace('Row ', 'R')));
    tabsEl.appendChild(tab);
  }

  // Collapse all button
  if (activeRows.size > 0) {
    const colBtn = document.createElement('button');
    colBtn.className = 'row-tab collapse-all-tab';
    colBtn.textContent = '✕ All';
    colBtn.onclick = () => {
      activeRows.clear();
      saveActiveRows();
      renderRowTabs();
      renderRowPanels();
      if (issueRowScope === 'active') renderIssues();
    };
    tabsEl.appendChild(colBtn);
  }
}

function rowHasOpenIssues(rowName) {
  let scoped = issueScope==='mine' ? issues.filter(i=>i.userId===currentUser?.uid) : issues;
  scoped = scoped.filter(periodFilter);
  return PRESSES[rowName]?.some(m => scoped.some(i=>i.machine===m && currentStatusKey(i)!=='resolved'));
}

// ── PILL EXPAND STATE ──
// Track which pill is expanded: { rowName: statusKey } — only one at a time globally
let expandedPill = { row: null, status: null };
let rowStatusOverflowState = { row: null, anchorEl: null };

function closeRowStatusOverflow() {
  rowStatusOverflowState = { row: null, anchorEl: null };
  document.getElementById('row-status-overflow-popover')?.remove();
}

function getRowStatusVisibleLimit() {
  return window.matchMedia?.('(max-width: 560px)')?.matches ? 2 : 3;
}

function positionRowStatusOverflowPopover(popover, anchorEl) {
  if (!popover || !anchorEl) return;
  const viewportPadding = 8;
  const anchorRect = anchorEl.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;

  const maxLeft = Math.max(viewportPadding, vw - popRect.width - viewportPadding);
  const left = Math.min(Math.max(anchorRect.right - popRect.width, viewportPadding), maxLeft);
  let top = anchorRect.bottom + 8;
  if (top + popRect.height + viewportPadding > vh) {
    const aboveTop = anchorRect.top - popRect.height - 8;
    top = aboveTop >= viewportPadding ? aboveTop : Math.max(viewportPadding, vh - popRect.height - viewportPadding);
  }

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function openRowStatusOverflowPopover(rowName, anchorEl, entries) {
  closeRowStatusOverflow();
  if (!anchorEl || !Array.isArray(entries) || !entries.length) return;

  const popover = document.createElement('div');
  popover.id = 'row-status-overflow-popover';
  popover.className = 'row-status-overflow-popover';
  popover.addEventListener('click', e => e.stopPropagation());

  const header = document.createElement('div');
  header.className = 'row-status-overflow-header';
  header.textContent = `${rowName} categories`;
  popover.appendChild(header);

  entries.forEach(entry => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row-spill row-status-overflow-item';
    btn.style.color = entry.color;
    btn.style.borderColor = alphaColor(entry.color, 0.5);
    btn.style.background = alphaColor(entry.color, 0.12);

    const left = document.createElement('span');
    left.className = 'row-status-overflow-label';
    left.textContent = `${entry.count} ${entry.label}`;
    btn.appendChild(left);

    btn.onclick = (e) => {
      e.stopPropagation();
      expandedPill = { row: rowName, status: entry.statusKey };
      closeRowStatusOverflow();
      renderRowPanels();
    };

    popover.appendChild(btn);
  });

  document.body.appendChild(popover);
  rowStatusOverflowState = { row: rowName, anchorEl };
  requestAnimationFrame(() => positionRowStatusOverflowPopover(popover, anchorEl));
}

window.toggleRowStatusOverflow = (rowName, anchorEl, entriesJson) => {
  const entries = Array.isArray(entriesJson) ? entriesJson : [];
  const isOpenForSameRow = rowStatusOverflowState.row === rowName && document.getElementById('row-status-overflow-popover');
  if (isOpenForSameRow) {
    closeRowStatusOverflow();
    return;
  }
  openRowStatusOverflowPopover(rowName, anchorEl, entries);
};

document.addEventListener('click', e => {
  const popover = document.getElementById('row-status-overflow-popover');
  if (!popover) return;
  if (e.target.closest('.row-status-overflow-popover')) return;
  if (e.target.closest('.row-status-overflow-trigger')) return;
  closeRowStatusOverflow();
});
window.addEventListener('scroll', () => {
  if (document.getElementById('row-status-overflow-popover')) closeRowStatusOverflow();
}, { passive: true });
window.addEventListener('resize', () => {
  if (document.getElementById('row-status-overflow-popover')) closeRowStatusOverflow();
});

window.scrollToIssue = id => {
  const body = document.getElementById('body-' + id);
  const chevron = document.getElementById('chevron-' + id);
  const card = body?.closest('.issue-card');
  if (!body || !card) return;
  // Expand the card if not already
  if (!body.classList.contains('visible')) {
    body.classList.add('visible');
    if (chevron) chevron.classList.add('open');
  }
  // Scroll to the card
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Brief highlight flash
  card.style.transition = 'box-shadow 0.3s';
  card.style.boxShadow = '0 0 0 2px var(--color-accent, var(--accent))';
  setTimeout(() => { card.style.boxShadow = ''; setTimeout(() => { card.style.transition = ''; }, 300); }, 1200);
};

function renderRowPanels() {
  const container = document.getElementById('row-panels');
  if (!container) return;
  container.innerHTML = '';
  closeRowStatusOverflow();
  activeMiniCard = null;

  let scoped = issueScope==='mine' ? issues.filter(i=>i.userId===currentUser?.uid) : issues;
  scoped = scoped.filter(periodFilter);

  const STATUS_PILL_LABELS = Object.fromEntries(Object.keys(STATUSES).map(k => [k, getStatusDef(k).icon + ' ' + getStatusLabel(k, 'short')]));
  const ORDER = window._STATUS_ORDER.filter(k=>k!=='resolved');
  const orderIndex = new Map(ORDER.map((sk, idx) => [sk, idx]));
  const visibleLimit = getRowStatusVisibleLimit();

  const sortedPanelRowNames = Object.keys(PRESSES).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, '')) || 999;
    const numB = parseInt(b.replace(/\D/g, '')) || 999;
    return numA - numB;
  });
  for (const rowName of sortedPanelRowNames) {
    if (!activeRows.has(rowName)) continue;
    const presses = PRESSES[rowName];
    // Determine unscheduled presses for the current date (null = no schedule loaded → don't highlight)
    const _schedDate = scheduleDateForLookup();
    const unscheduledSet = (scheduledPressesState && scheduledPressesState.date === _schedDate && scheduledPressesState.scheduled !== null)
      ? scheduledPressesState.scheduled : null;
    const panel = document.createElement('div');
    panel.className = 'row-panel';

    // Header with name + status pills
    const header = document.createElement('div');
    header.className = 'row-panel-header';
    const nameLbl = document.createElement('div');
    nameLbl.className = 'row-panel-name'; nameLbl.textContent = rowName;
    header.appendChild(nameLbl);

    // Compute and render status pills inline (secondary statuses also counted)
    const counts = {};
    presses.forEach(m => {
      scoped.filter(i=>i.machine===m).forEach(i => {
        getActiveStatuses(i).forEach(as => {
          counts[as.statusKey] = (counts[as.statusKey]||0) + 1;
        });
      });
    });
    const pillsWrap = document.createElement('div');
    pillsWrap.className = 'row-status-pills';
    pillsWrap.id = 'rowpills-' + rowName.replace(/\s/g,'_');
    const expandAreas = {};
    const statusEntries = ORDER
      .map(sk => {
        const count = counts[sk] || 0;
        if (!count) return null;
        const st = getStatusDef(sk);
        return {
          statusKey: sk,
          count,
          label: `${st.icon} ${getStatusLabel(sk, 'short')}`,
          color: getStatusColor(sk),
          order: orderIndex.get(sk) ?? 999
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || (a.order - b.order));
    const visibleEntries = statusEntries.slice(0, visibleLimit);
    const hiddenEntries = statusEntries.slice(visibleLimit);

    visibleEntries.forEach(entry => {
      const sk = entry.statusKey;
      const col = entry.color;
      const pill = document.createElement('span');
      pill.className = 'row-spill' + (expandedPill.row === rowName && expandedPill.status === sk ? ' active' : '');
      pill.style.color = col;
      pill.style.borderColor = alphaColor(col, 0.5);
      pill.style.background = alphaColor(col, 0.12);
      pill.textContent = `${entry.count} ${STATUS_PILL_LABELS[sk]}`;
      pill.onclick = (e) => {
        e.stopPropagation();
        if (expandedPill.row === rowName && expandedPill.status === sk) {
          expandedPill = { row: null, status: null };
        } else {
          expandedPill = { row: rowName, status: sk };
        }
        renderRowPanels();
      };
      pillsWrap.appendChild(pill);

      // Build expand area for this status
      const matchingIssues = [];
      presses.forEach(m => {
        scoped.filter(i => i.machine === m && issueHasActiveStatus(i, sk)).forEach(i => matchingIssues.push(i));
      });
      const area = document.createElement('div');
      area.className = 'row-pill-expand' + (expandedPill.row === rowName && expandedPill.status === sk ? ' visible' : '');
      const inner = document.createElement('div');
      inner.className = 'row-pill-expand-inner';
      const hdr = document.createElement('div');
      hdr.className = 'row-pill-expand-hdr';
      const title = document.createElement('span');
      title.className = 'row-pill-expand-title';
      title.style.color = entry.color;
      title.textContent = getStatusDef(sk).icon + ' ' + getStatusLabel(sk, 'short') + ' issues';
      hdr.appendChild(title);
      const closeBtn = document.createElement('button');
      closeBtn.className = 'row-pill-expand-close';
      closeBtn.textContent = '✕ close';
      closeBtn.onclick = (e) => { e.stopPropagation(); expandedPill = { row: null, status: null }; renderRowPanels(); };
      hdr.appendChild(closeBtn);
      inner.appendChild(hdr);

      matchingIssues.forEach(issue => {
        const mi = document.createElement('div');
        mi.className = 'mini-issue';
        mi.onclick = () => scrollToIssue(issue.id);
        const bar = document.createElement('div');
        bar.className = 'mini-issue-bar';
        bar.style.background = entry.color;
        mi.appendChild(bar);
        const mach = document.createElement('div');
        mach.className = 'mini-issue-machine';
        mach.textContent = issue.machine;
        mi.appendChild(mach);
        const note = document.createElement('div');
        note.className = 'mini-issue-note';
        note.textContent = issue.note || '';
        mi.appendChild(note);
        // Sub-status chip
        const lastEntry = issue.statusHistory && issue.statusHistory.length > 0 ? issue.statusHistory[issue.statusHistory.length-1] : null;
        if (lastEntry && lastEntry.subStatus) {
          const sub = document.createElement('span');
          sub.className = 'mini-issue-sub';
          sub.style.color = col;
          sub.style.borderColor = alphaColor(col, 0.4);
          sub.textContent = lastEntry.subStatus;
          mi.appendChild(sub);
        }
        // Time
        const datePart = issue.dateTime ? issue.dateTime.replace(/,\s*\d{4}/, '') : '';
        const time = document.createElement('span');
        time.className = 'mini-issue-time';
        time.textContent = datePart;
        mi.appendChild(time);
        inner.appendChild(mi);
      });

      area.appendChild(inner);
      expandAreas[sk] = area;
    });

    if (hiddenEntries.length > 0) {
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'row-spill row-spill-more row-status-overflow-trigger';
      moreBtn.textContent = `+${hiddenEntries.length} more`;
      moreBtn.onclick = (e) => {
        e.stopPropagation();
        openRowStatusOverflowPopover(rowName, moreBtn, hiddenEntries);
      };
      pillsWrap.appendChild(moreBtn);
    }
    header.appendChild(pillsWrap);

    // Top-right action buttons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'row-header-actions';

    // Resolved toggle
    const resTog = document.createElement('button');
    resTog.className = 'row-resolved-toggle' + (showResolvedRows.has(rowName) ? ' active' : '');
    resTog.textContent = '✓';
    resTog.title = showResolvedRows.has(rowName) ? 'Hide resolved' : 'Show resolved';
    resTog.onclick = () => {
      if (showResolvedRows.has(rowName)) showResolvedRows.delete(rowName);
      else showResolvedRows.add(rowName);
      saveResolvedRows();
      renderRowPanels();
    };
    actionsDiv.appendChild(resTog);

    // "No Schedule" toggle — only visible when a daily schedule is loaded for the active date
    // Active = show unscheduled presses; inactive = hide unscheduled presses (show scheduled only)
    if (unscheduledSet !== null) {
      const showing = hideUnscheduledRows.has(rowName);
      const schedTog = document.createElement('button');
      schedTog.className = 'row-resolved-toggle row-sched-toggle' + (showing ? ' active' : '');
      schedTog.textContent = showing ? '✓ N/S' : 'N/S';
      schedTog.title = showing ? 'Showing all presses — click to hide unscheduled' : 'Click to show unscheduled presses';
      schedTog.onclick = () => {
        if (hideUnscheduledRows.has(rowName)) hideUnscheduledRows.delete(rowName);
        else hideUnscheduledRows.add(rowName);
        saveHideUnscheduledRows();
        renderRowPanels();
      };
      actionsDiv.appendChild(schedTog);
    }

    header.appendChild(actionsDiv);

    panel.appendChild(header);

    // Presses — show only scheduled by default; N/S toggle reveals unscheduled
    const visiblePresses = (unscheduledSet && !hideUnscheduledRows.has(rowName))
      ? presses.filter(m => unscheduledSet.has(m))
      : presses;
    const btns = document.createElement('div'); btns.className = 'row-presses';
    visiblePresses.forEach(m => {
      const btn = document.createElement('button');
      btn.className = 'press-btn';
      btn.id = 'press-'+m.replace(/[\s.]/g,'_');
      btn.onclick = () => handlePressClick(m);

      // Number label
      const numEl = document.createElement('span');
      numEl.className = 'press-btn-num';
      numEl.textContent = m;
      btn.appendChild(numEl);

      // Gather all non-resolved issues for this press
      const mi = scoped.filter(i=>i.machine===m);
      const anyOpen = mi.filter(i=>currentStatusKey(i)!=='resolved');
      const anyResolved = mi.filter(i=>currentStatusKey(i)==='resolved');

      // Build status color list for bar segments — primary + secondary per issue
      const statusColors = [];
      anyOpen.forEach(i => {
        getActiveStatuses(i).forEach(as => {
          if (as.statusKey !== 'resolved') statusColors.push(getStatusColor(as.statusKey));
        });
      });

      // Bar container
      const barsEl = document.createElement('div');
      barsEl.className = 'press-btn-bars';
      if (statusColors.length > 0) {
        statusColors.forEach(col => {
          const bar = document.createElement('div');
          bar.className = 'press-btn-bar';
          bar.style.background = col;
          barsEl.appendChild(bar);
        });
      } else {
        // Single empty bar
        const bar = document.createElement('div');
        bar.className = 'press-btn-bar';
        if (anyResolved.length > 0 && showResolvedRows.has(rowName)) {
          bar.style.background = STATUSES.resolved?.swipeColor || '#22c55e';
        }
        barsEl.appendChild(bar);
      }
      btn.appendChild(barsEl);

      // Apply border color
      if (statusColors.length > 1) {
        // Multi-issue: orange accent border
        btn.classList.add('has-multi');
      } else if (statusColors.length === 1) {
        const sk = currentStatusKey(anyOpen[0]);
        const col = getStatusColor(sk);
        btn.style.borderColor = col;
        btn.style.color = col;
      } else if (anyResolved.length > 0 && showResolvedRows.has(rowName)) {
        btn.classList.add('all-resolved');
      }

      // hist-mode class if needed
      if (mapMode==='hist' || mapMode==='notes') btn.classList.add('hist-mode');
      if (mapMode==='notes') applyPressContributionVisual(btn, m);
      // Mark presses not appearing in today's daily schedule
      if (unscheduledSet && !unscheduledSet.has(m)) {
        btn.classList.add('not-scheduled');
        btn.title = 'Not scheduled';
      }
      btns.appendChild(btn);
    });
    panel.appendChild(btns);
    // Mini-card overlay area for press quick-view
    const mcArea = document.createElement('div');
    mcArea.className = 'press-minicard-area';
    mcArea.id = 'mc-area-' + rowName.replace(/\s/g,'_');
    panel.appendChild(mcArea);
    // Append pill expand areas after presses
    ORDER.forEach(sk => {
      if (expandAreas[sk]) panel.appendChild(expandAreas[sk]);
    });
    container.appendChild(panel);
  }
}

function updatePressStates() {
  // renderRowPanels handles press coloring and pills inline — just re-render tabs + panels
  renderRowTabs();
  renderRowPanels();
}

// ── PHOTO RESIZE ──
function resizeImage(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let {width,height} = img;
        if (width>MAX_DIM||height>MAX_DIM) {
          if (width>height) { height=Math.round(height*MAX_DIM/width); width=MAX_DIM; }
          else { width=Math.round(width*MAX_DIM/height); height=MAX_DIM; }
        }
        const c = document.createElement('canvas'); c.width=width; c.height=height;
        c.getContext('2d').drawImage(img,0,0,width,height);
        resolve(c.toDataURL('image/jpeg',JPEG_QUALITY));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── ADD MODAL ──
const ISSUE_LOG_PREFS_KEY = 'aptracker_issue_log_prefs_v1';
const ISSUE_QUICK_PHRASES = ['Leak', 'Down', 'Needs parts', 'Waiting on maintenance', 'Quality check', 'Escalate'];
let issueAdvancedExpanded = false;
let subcategorySheetState = { open: false, statusKey: '', selectedSub: '' };

function loadIssueLogPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ISSUE_LOG_PREFS_KEY) || '{}');
    return {
      timerMinutes: String(parsed?.timerMinutes || ''),
      urgent: Boolean(parsed?.urgent),
      advancedOpen: Boolean(parsed?.advancedOpen),
      lastShift: parsed?.lastShift || 'auto',
      lastStatusKey: parsed?.lastStatusKey || '',
      lastStatusSub: parsed?.lastStatusSub || ''
    };
  } catch (_) {
    return { timerMinutes: '', urgent: false, advancedOpen: false, lastShift: 'auto', lastStatusKey: '', lastStatusSub: '' };
  }
}

let issueLogPrefs = loadIssueLogPrefs();

function saveIssueLogPrefs() {
  try {
    localStorage.setItem(ISSUE_LOG_PREFS_KEY, JSON.stringify(issueLogPrefs));
  } catch (_) {}
}

function setIssueAdvancedDetailsExpanded(on) {
  issueAdvancedExpanded = Boolean(on);
  const panel = document.getElementById('issue-advanced-panel');
  const state = document.getElementById('issue-advanced-toggle-state');
  panel?.classList.toggle('visible', issueAdvancedExpanded);
  if (state) state.textContent = issueAdvancedExpanded ? 'Hide' : 'Show';
}

window.toggleIssueAdvancedDetails = function() {
  setIssueAdvancedDetailsExpanded(!issueAdvancedExpanded);
  issueLogPrefs.advancedOpen = issueAdvancedExpanded;
  saveIssueLogPrefs();
};

function renderIssueQuickPhrases() {
  const row = document.getElementById('issue-quick-phrases');
  if (!row) return;
  row.innerHTML = '';
  ISSUE_QUICK_PHRASES.forEach(phrase => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'issue-quick-phrase';
    btn.textContent = phrase;
    addTapListener(btn, () => appendIssueNotePhrase(phrase));
    row.appendChild(btn);
  });
}

function appendIssueNotePhrase(phrase) {
  const field = document.getElementById('issue-note');
  if (!field) return;
  const current = String(field.value || '').trim();
  const next = current ? `${current}${current.endsWith('.') ? '' : ';'} ${phrase}` : phrase;
  field.value = next;
  field.focus();
  field.setSelectionRange?.(field.value.length, field.value.length);
}

function openIssuePhotoSourceMenu(forceOpen) {
  const row = document.getElementById('log-photo-source-row');
  if (!row) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !row.classList.contains('visible');
  row.classList.toggle('visible', shouldOpen);
  if (shouldOpen) scrollAddModalToBottom();
}

function syncIssueLogPrefsFromModal() {
  const timer = document.getElementById('issue-timer-minutes');
  const shift = document.getElementById('issue-shift');
  issueLogPrefs.timerMinutes = String(timer?.value || '');
  issueLogPrefs.urgent = false;
  issueLogPrefs.advancedOpen = issueAdvancedExpanded;
  if (shift?.dataset?.autoApplied === '1') {
    issueLogPrefs.lastShift = 'auto';
  } else if (shift?.value && shift.value !== 'auto') {
    issueLogPrefs.lastShift = shift.value;
  } else {
    issueLogPrefs.lastShift = 'auto';
  }
  saveIssueLogPrefs();
}

function applyIssueLogDefaults() {
  const timer = document.getElementById('issue-timer-minutes');
  const urgent = document.getElementById('issue-urgent');
  const shift = document.getElementById('issue-shift');
  const issueDate = document.getElementById('issue-date');
  const issueTime = document.getElementById('issue-time-input');
  if (timer) timer.value = issueLogPrefs.timerMinutes || '';
  if (urgent) urgent.checked = false;
  if (issueDate && issueTime) resetIssueDateTime();
  if (shift) {
    const d = getIssueDateFromInputs('issue-date', 'issue-time-input');
    if (issueLogPrefs.lastShift === 'auto') {
      shift.dataset.autoApplied = '1';
      shift.value = getShiftForTime(d, getShiftSchedule(currentPlantId));
    } else {
      shift.dataset.autoApplied = '0';
      shift.value = issueLogPrefs.lastShift || 'auto';
    }
  }
  setIssueAdvancedDetailsExpanded(Boolean(issueLogPrefs.advancedOpen));
}

window.openAddModal = m => {
  if (!currentUser) return;
  if (!currentUserPermissions.canCreateIssue) return;
  if (isSearchMode) { closeSearch(); }
  closeSubcategorySheet();
  subcategorySheetState = { open: false, statusKey: '', selectedSub: '' };
  currentMachine=m; pendingPhotos=[];
  logCatKey = issueLogPrefs.lastStatusKey || null;
  logCatSub = issueLogPrefs.lastStatusSub || null;
  document.getElementById('issue-note').value='';
  document.getElementById('photo-previews').innerHTML='';
  document.getElementById('modal-machine-name').textContent=m;
  document.getElementById('log-photo-source-row')?.classList.remove('visible');
  applyIssueLogDefaults();
  renderIssueQuickPhrases();
  setSubmitting(false);
  renderLogCatButtons();
  renderLogSubChips();
  updateLogCatPill();
  document.getElementById('log-cat-selected').classList.toggle('visible', Boolean(logCatKey));
  document.getElementById('add-modal').classList.add('visible');
  requestAnimationFrame(() => document.getElementById('issue-note')?.focus());
};

// ── LOG ISSUE CATEGORY PICKER ──
function renderLogCatButtons() {
  const row = document.getElementById('log-cat-all-row'); if (!row) return;
  row.innerHTML = '';
  const ordered = getAlphabetizedStatusKeys();
  ordered.forEach(key => {
    const st = getStatusDef(key);
    const btn = document.createElement('button'); btn.className = 'log-cat-btn'; btn.dataset.key = key;
    const col = getStatusColor(key);
    btn.style.color = col;
    if (logCatKey === key) {
      btn.classList.add('selected');
      btn.style.background = alphaColor(col, 0.13);
    }
    if (isSearchMode) {
      if (addSearchActiveSub && getSubCats(addSearchActiveSub).includes(key)) {
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.classList.add('search-match');
      } else {
        btn.style.opacity = '0.5';
        btn.style.pointerEvents = 'none';
      }
    }
    btn.innerHTML = `<span class="log-cat-icon">${st.icon}</span><span class="log-cat-label">${getStatusLabel(key, 'short')}</span>`;
    addTapListener(btn, ()=>logCatSelectStatus(key));
    row.appendChild(btn);
  });

  // Search button (always last)
  const searchBtn = document.createElement('button');
  searchBtn.className = 'log-cat-btn' + (isSearchMode ? ' selected' : '');
  searchBtn.dataset.key = '__search__';
  const searchCol = 'var(--color-text-muted, var(--text2))';
  searchBtn.style.color = searchCol;
  if (isSearchMode) {
    searchBtn.style.background = alphaColor(searchCol, 0.13);
  }
  searchBtn.innerHTML = `<span class="log-cat-icon">🔍</span><span class="log-cat-label">Search</span>`;
  addTapListener(searchBtn, () => openSearch(searchApplyAddModal, null));
  row.appendChild(searchBtn);
}

function renderLogSubChips() {
  const row = document.getElementById('log-sub-row'); if (!row) return;
  if (isSearchMode) {
    renderSharedSearchContent(
      document.getElementById('search-bar-row'),
      row,
      handleSearchSubPick,
      addSearchActiveSub
    );
    return;
  }
  row.innerHTML = '';
  if (!logCatKey) {
    row.className = 'log-sub-row';
    return;
  }
  const subs = getStatusSubs(logCatKey);
  if (!subs.length) {
    row.className = 'log-sub-row';
    return;
  }
  
  row.className = 'subcategory-grid visible';
  row.style.marginTop = '4px';
  row.style.marginBottom = '8px';
  applyColumnMajorGridLayout(row, subs.length, 2);
  
  const activeColor = getStatusColor(logCatKey);
  
  subs.forEach(sub => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'subcategory-item' + (logCatSub === sub ? ' selected' : '');
    item.innerHTML = `<span class="subcategory-item-label">${esc(sub)}</span><span class="subcategory-item-check">✓</span>`;
    item.style.borderColor = alphaColor(activeColor, 0.32);
    item.style.color = activeColor;
    item.style.background = logCatSub === sub ? alphaColor(activeColor, 0.12) : 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)';
    addTapListener(item, () => {
      logCatSub = logCatSub === sub ? '' : sub;
      issueLogPrefs.lastStatusSub = logCatSub;
      saveIssueLogPrefs();
      renderLogSubChips();
      updateLogCatPill();
      scrollAddModalToBottom();
    });
    row.appendChild(item);
  });
}

// ── SEARCH MODE (reverse subcategory lookup) ──
// Shared by the add-issue modal and the swipe status panel.
// Each surface passes its own callbacks and container references.

let searchFilterText = '';
let addSearchActiveSub = '';

// Surface-specific hooks — set by openSearch below
let searchApplySelection = null;  // (catKey, sub) => { ... }
let searchExitFn = null;          // () => { ... }

function openSearch(applySelection, exitFn) {
  if (isSearchMode) { closeSearch(); return; }
  searchApplySelection = applySelection;
  searchExitFn = exitFn;
  isSearchMode = true;
  searchFilterText = '';
  addSearchActiveSub = '';
  logCatKey = null;
  logCatSub = null;
  renderLogCatButtons();
  renderSharedSearchContent(
    document.getElementById('search-bar-row'),
    document.getElementById('log-sub-row'),
    handleSearchSubPick,
    addSearchActiveSub
  );
  updateLogCatPill();
  closeSubcategorySheet();
}

function closeSearch() {
  if (!isSearchMode) return;
  isSearchMode = false;
  searchFilterText = '';
  addSearchActiveSub = '';
  searchApplySelection = null;
  searchExitFn = null;
  document.getElementById('search-bar-row')?.classList.remove('visible');
  renderLogCatButtons();
  renderLogSubChips();
  updateLogCatPill();
}

function renderSharedSearchContent(barContainer, gridContainer, onSubPick, activeSub = '') {
  if (!barContainer || !gridContainer) return;
  const subPick = onSubPick || handleSearchSubPick;
  const selectedSub = String(activeSub || '');

  // Search input
  if (barContainer.classList?.contains('search-bar-row')) {
    barContainer.classList.add('visible');
  }
  let input = barContainer.querySelector?.('.search-input');
  if (!input) {
    barContainer.innerHTML = '';
    input = document.createElement('input');
    input.type = 'text';
    input.className = 'search-input';
    input.placeholder = 'Find subcategory…';
    input.value = searchFilterText;
    input.setAttribute('autocomplete', 'off');
    input.addEventListener('input', () => {
      searchFilterText = input.value;
      renderSharedSearchResults(gridContainer, subPick, selectedSub);
    });
    barContainer.appendChild(input);
    requestAnimationFrame(() => input.focus());
  } else if (document.activeElement !== input) {
    input.value = searchFilterText;
  }

  renderSharedSearchResults(gridContainer, subPick, selectedSub);
}

function renderSharedSearchResults(gridContainer, onSubPick, selectedSub = '') {
  if (!gridContainer) return;
  const subPick = onSubPick || handleSearchSubPick;
  const filter = searchFilterText.toLowerCase();
  const allSubs = getAllSubs();
  const filtered = filter ? allSubs.filter(s => s.toLowerCase().includes(filter)) : allSubs;

  // Subcategory grid
  gridContainer.innerHTML = '';
  if (gridContainer.id === 'log-sub-row') {
    gridContainer.className = 'log-sub-row visible search-mode';
    gridContainer.style.marginTop = '4px';
    gridContainer.style.marginBottom = '8px';
  }

  if (!filtered.length) {
    const msg = document.createElement('div');
    if (gridContainer.id === 'log-sub-row') msg.style.gridColumn = '1 / -1';
    msg.className = 'search-no-match';
    msg.textContent = allSubs.length ? 'No subcategories match "' + searchFilterText + '"' : 'No subcategories are configured.';
    gridContainer.appendChild(msg);
    return;
  }

  // Use grid layout for the sub list
  gridContainer.style.display = 'grid';
  gridContainer.style.gridTemplateColumns = '1fr 1fr';
  gridContainer.style.gap = '6px';

  filtered.forEach(sub => {
    const cats = getSubCats(sub);
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'search-mode-item' + (sub === selectedSub ? ' selected' : '');
    item.innerHTML = `<span class="search-mode-item-label">${esc(sub)}</span><span class="search-mode-count">${cats.length}</span>`;
    item.dataset.sub = sub;
    addTapListener(item, evt => {
      evt?.stopPropagation?.();
      subPick(sub);
    });
    gridContainer.appendChild(item);
  });

  const searchInput = gridContainer.parentElement?.querySelector?.('.search-input');
  if (gridContainer.id !== 'log-sub-row' && searchInput) searchInput.style.marginBottom = '8px';
}

// Add-issue modal callbacks
function searchApplyAddModal(key, sub) {
  logCatKey = key;
  logCatSub = sub;
  issueLogPrefs.lastStatusKey = key;
  issueLogPrefs.lastStatusSub = sub;
  saveIssueLogPrefs();
  closeSearch();
}

function handleSearchSubPick(sub) {
  const cats = getSubCats(sub);
  if (!cats.length) return;
  addSearchActiveSub = sub;
  renderLogCatButtons();
  if (addSearchActiveSub) {
    // Re-render with updated activeSub
    const barContainer = document.getElementById('search-bar-row');
    const gridContainer = document.getElementById('log-sub-row');
    renderSharedSearchContent(barContainer, gridContainer, handleSearchSubPick, addSearchActiveSub);
  }
}

function renderSubcategorySheet(statusKey = subcategorySheetState.statusKey) {
  const parentRow = document.getElementById('subcategory-parent-row');
  const grid = document.getElementById('subcategory-grid');
  const title = document.getElementById('subcategory-sheet-title');
  const subtitle = document.getElementById('subcategory-sheet-subtitle');
  const applyBtn = document.getElementById('subcategory-sheet-apply');
  const skipBtn = document.getElementById('subcategory-sheet-skip');
  if (!parentRow || !grid) return;

  const alphabetizedKeys = getAlphabetizedStatusKeys();
  const activeKey = statusKey || alphabetizedKeys.find(key => getStatusSubs(key).length) || 'open';
  const subs = getStatusSubs(activeKey);
  const activeColor = getStatusColor(activeKey);

  if (title) title.textContent = `${getStatusLabel(activeKey, 'short')} subcategories`;
  if (subtitle) subtitle.textContent = subs.length ? 'Pick the closest match to log faster.' : 'No subcategories are configured for this status.';

  parentRow.innerHTML = '';
  alphabetizedKeys.forEach(key => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'subcategory-parent-pill' + (key === activeKey ? ' selected' : '');
    const st = getStatusDef(key);
    pill.textContent = st.icon;
    pill.title = getStatusLabel(key, 'short');
    const chipColor = getStatusColor(key);
    pill.style.color = chipColor;
    if (key === activeKey) {
      pill.style.borderColor = alphaColor(chipColor, 0.4);
      pill.style.background = alphaColor(chipColor, 0.1);
    } else {
      pill.style.borderColor = alphaColor(chipColor, 0.15);
      pill.style.background = 'transparent';
    }
    addTapListener(pill, () => {
      subcategorySheetState.statusKey = key;
      subcategorySheetState.selectedSub = '';
      logCatSub = '';
      renderSubcategorySheet(key);
    });
    parentRow.appendChild(pill);
  });

  grid.innerHTML = '';
  if (!subs.length) {
    grid.style.display = 'grid';
    grid.style.gridAutoFlow = '';
    grid.style.gridTemplateColumns = '';
    grid.style.gridTemplateRows = '';
    grid.style.gridAutoColumns = '';
    const empty = document.createElement('div');
    empty.className = 'subcategory-empty';
    empty.textContent = 'This status has no subcategories. Use no subcategory to continue.';
    grid.appendChild(empty);
  } else {
    applyColumnMajorGridLayout(grid, subs.length, 2);
    subs.forEach(sub => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'subcategory-item' + (subcategorySheetState.selectedSub === sub ? ' selected' : '');
      item.innerHTML = `<span class="subcategory-item-label">${esc(sub)}</span><span class="subcategory-item-check">✓</span>`;
      item.style.borderColor = alphaColor(activeColor, 0.32);
      item.style.color = activeColor;
      item.style.background = subcategorySheetState.selectedSub === sub ? alphaColor(activeColor, 0.12) : 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)';
      addTapListener(item, () => {
        subcategorySheetState.selectedSub = sub;
        logCatSub = sub;
        renderSubcategorySheet(activeKey);
        updateLogCatPill();
      });
      grid.appendChild(item);
    });
  }

  if (applyBtn) applyBtn.disabled = !subcategorySheetState.selectedSub;
  if (skipBtn) {
    skipBtn.textContent = subs.length ? 'Use no subcategory' : 'Continue';
    skipBtn.onclick = () => confirmSubcategorySheet(true);
  }
  if (applyBtn) applyBtn.onclick = () => confirmSubcategorySheet(false);
}

function openSubcategorySheet(statusKey) {
  const subs = getStatusSubs(statusKey);
  if (!subs.length) return;
  subcategorySheetState.open = true;
  subcategorySheetState.statusKey = statusKey;
  subcategorySheetState.selectedSub = subs.includes(logCatSub) ? logCatSub : '';
  renderSubcategorySheet(statusKey);
  document.getElementById('subcategory-sheet-overlay')?.classList.add('visible');
}

function closeSubcategorySheet() {
  subcategorySheetState.open = false;
  document.getElementById('subcategory-sheet-overlay')?.classList.remove('visible');
}

function confirmSubcategorySheet(useNoSub = false) {
  const activeKey = subcategorySheetState.statusKey || logCatKey;
  if (!activeKey) return;
  logCatKey = activeKey;
  logCatSub = useNoSub ? '' : subcategorySheetState.selectedSub;
  issueLogPrefs.lastStatusKey = logCatKey || '';
  issueLogPrefs.lastStatusSub = logCatSub || '';
  saveIssueLogPrefs();
  renderLogCatButtons();
  renderLogSubChips();
  updateLogCatPill();
  closeSubcategorySheet();
}

function updateLogCatPill() {
  const sel = document.getElementById('log-cat-selected');
  const pill = document.getElementById('log-cat-pill');
  if (!sel||!pill) return;
  if (isSearchMode) {
    sel.classList.add('visible');
    pill.textContent = '🔍 Searching…';
    pill.style.color = 'var(--color-text-muted, var(--text2))'; pill.style.borderColor = 'var(--color-border, var(--border))'; pill.style.background = 'transparent';
    updateAddModalIssueLanguage();
    return;
  }
  if (!logCatKey) {
    sel.classList.remove('visible');
    updateAddModalIssueLanguage();
    return;
  }
  const st = getStatusDef(logCatKey);
  const col = getStatusColor(logCatKey);
  sel.classList.add('visible');
  pill.textContent = st.icon+' '+getStatusLabel(logCatKey, 'short')+(logCatSub?' › '+logCatSub:'');
  pill.style.color=col; pill.style.borderColor=alphaColor(col,0.53); pill.style.background=alphaColor(col,0.08);
  updateAddModalIssueLanguage();
}

function updateAddModalIssueLanguage() {
  const isAttention = logCatKey === 'attention';
  const titleAction = document.getElementById('add-modal-title-action');
  const noteLabel = document.getElementById('issue-note-label');
  const noteField = document.getElementById('issue-note');
  if (titleAction) titleAction.textContent = isAttention ? 'Log Attention' : 'Log Issue';
  if (noteLabel) noteLabel.textContent = isAttention ? 'What needs attention?' : 'What happened?';
  if (noteField) {
    noteField.placeholder = isAttention
      ? 'Example: Watch for drip near guard; check next run'
      : 'Example: Hydraulic leak at press startup';
  }
  const submit = document.getElementById('submit-btn');
  if (submit && !submit.disabled) submit.innerHTML = isAttention ? '◇ Log Attention' : '⚠ Log Issue';
}

function scrollAddModalToBottom() {
  const modal = document.querySelector('#add-modal .modal');
  if (!modal) return;
  requestAnimationFrame(() => modal.scrollTo({ top: modal.scrollHeight, behavior: 'smooth' }));
}

function logCatSelectStatus(key) {
  if (isSearchMode) {
    if (searchApplySelection) searchApplySelection(key, addSearchActiveSub);
    return;
  }
  const prevKey = logCatKey;
  const subs = getStatusSubs(key);
  logCatKey = key;
  logCatSub = prevKey === key && subs.includes(logCatSub) ? logCatSub : '';
  
  issueLogPrefs.lastStatusKey = key;
  issueLogPrefs.lastStatusSub = logCatSub;
  saveIssueLogPrefs();

  renderLogCatButtons();
  renderLogSubChips();
  updateLogCatPill();
  closeSubcategorySheet();
  scrollAddModalToBottom();
}

document.getElementById('log-cat-clear')?.addEventListener('touchend', e=>{
  e.preventDefault();
  if (isSearchMode) { closeSearch(); return; }
  closeSubcategorySheet();
  logCatKey=null;logCatSub=null;
  issueLogPrefs.lastStatusKey = '';
  issueLogPrefs.lastStatusSub = '';
  saveIssueLogPrefs();
  renderLogCatButtons();renderLogSubChips();updateLogCatPill();
},{passive:false});
document.getElementById('log-cat-clear')?.addEventListener('click', ()=>{
  if (isSearchMode) { closeSearch(); return; }
  closeSubcategorySheet();
  logCatKey=null;logCatSub=null;
  issueLogPrefs.lastStatusKey = '';
  issueLogPrefs.lastStatusSub = '';
  saveIssueLogPrefs();
  renderLogCatButtons();renderLogSubChips();updateLogCatPill();
});
document.getElementById('log-cat-selected')?.addEventListener('click', e => {
  if (e.target.closest?.('#log-cat-clear')) return;
  // Disabled: Subcategories now render inline below the category picker.
});

window.closeModal = () => {
  if (isSearchMode) { closeSearch(); }
  syncIssueLogPrefsFromModal();
  document.getElementById('add-modal').classList.remove('visible');
  document.getElementById('log-photo-source-row')?.classList.remove('visible');
  closeSubcategorySheet();
  pendingPhotos=[];
  currentMachine=null;
  issueLogPrefs.lastStatusKey = logCatKey || issueLogPrefs.lastStatusKey || '';
  issueLogPrefs.lastStatusSub = logCatSub || issueLogPrefs.lastStatusSub || '';
  saveIssueLogPrefs();
  logCatKey=null;
  logCatSub=null;
};

window.resetIssueDateTime = function() {
  const {dateStr,timeStr} = toLocalDTInputs(new Date());
  document.getElementById('issue-date').value=dateStr;
  document.getElementById('issue-time-input').value=timeStr;
  const shift = document.getElementById('issue-shift');
  if (shift && shift.dataset.autoApplied === '1') {
    shift.value = getShiftForTime(new Date(), getShiftSchedule(currentPlantId));
  }
};

function toLocalDTInputs(d) {
  const pad = n=>String(n).padStart(2,'0');
  return { dateStr: d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()), timeStr: pad(d.getHours())+':'+pad(d.getMinutes()) };
}
function getIssueDateFromInputs(dateId, timeId) {
  const dateStr = document.getElementById(dateId).value;
  const timeStr = document.getElementById(timeId).value || '00:00';
  return dateStr ? new Date(dateStr+'T'+timeStr+':00') : new Date();
}

function parseTimerMinutes(rawValue) {
  const val = Number(rawValue || 0);
  if (!Number.isFinite(val) || val <= 0) return 0;
  return Math.round(val * 60) / 60;
}

function buildIssueTimer(minutes, baseDate = new Date(), existingTimer = null) {
  const m = parseTimerMinutes(minutes);
  if (!m) return null;
  const startedAtMs = Number(existingTimer?.startedAtMs || 0);
  const startMs = Number.isFinite(startedAtMs) && startedAtMs > 0
    ? startedAtMs
    : (baseDate instanceof Date ? baseDate.getTime() : Date.now());
  const actor = currentActor();
  return {
    minutes: m,
    startedAtMs: startMs,
    dueAtMs: startMs + m * 60 * 1000,
    enabled: true,
    notificationStatus: 'pending',
    notificationRequestedAtMs: Date.now(),
    notificationRequestedBy: actor,
    notificationOwnerUid: actor?.uid || '',
    notificationDelivery: null
  };
}

const issueReminders = initIssueReminders({
  getIssues: () => issues,
  parseTimerMinutes,
  showGameToast,
  renderIssues,
  updateDoc,
  addDoc,
  plantDoc,
  issueEventsCol,
  serverTimestamp,
  currentActor,
  ensurePushEnabled: () => registerFcmToken({ requestPermission: true })
});

function clearIssueReminder(issueId) {
  return issueReminders.clear(issueId);
}

function setIssueReminder(issueId, minutes) {
  return issueReminders.set(issueId, minutes);
}

function getIssueReminderState(issueId, nowMs = Date.now()) {
  return issueReminders.state(issueId, nowMs);
}

function getIssueReminderMinutes(issueId) {
  return issueReminders.getReminderMinutes(issueId);
}

function formatReminderClock(state) {
  return issueReminders.formatClock(state);
}

function closeIssueReminderModal() {
  return issueReminders.closeModal();
}

function maybeNotifyIssueReminders(issueList = issues) {
  return issueReminders.maybeNotify(issueList);
}

function refreshReminderClocksInDom() {
  return issueReminders.refreshClocksInDom();
}

window.openIssueReminderModal = issueReminders.openModal;
window.closeIssueReminderModal = closeIssueReminderModal;
window.setIssueReminderFromModal = issueReminders.setFromModal;
window.setIssueReminderFromModalCustom = issueReminders.setFromModalCustom;
window.clearIssueReminderFromModal = issueReminders.clearFromModal;
window.setIssueReminderFromCard = issueReminders.setFromCard;
window.setIssueReminderQuick = issueReminders.setQuick;
window.clearIssueReminderFromCard = issueReminders.clearFromCard;

document.getElementById('subcategory-sheet-overlay')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeSubcategorySheet();
});
document.getElementById('subcategory-sheet-close')?.addEventListener('click', () => closeSubcategorySheet());

document.getElementById('issue-urgent')?.addEventListener('change', () => {
  issueLogPrefs.urgent = false;
  saveIssueLogPrefs();
});
document.getElementById('issue-timer-minutes')?.addEventListener('change', () => {
  issueLogPrefs.timerMinutes = String(document.getElementById('issue-timer-minutes')?.value || '');
  saveIssueLogPrefs();
});
document.getElementById('issue-shift')?.addEventListener('change', () => {
  issueLogPrefs.lastShift = String(document.getElementById('issue-shift')?.value || 'auto');
  const shift = document.getElementById('issue-shift');
  if (shift) shift.dataset.autoApplied = '0';
  saveIssueLogPrefs();
});
document.getElementById('issue-advanced-toggle')?.addEventListener('click', () => {
  issueLogPrefs.advancedOpen = issueAdvancedExpanded;
  saveIssueLogPrefs();
});
document.getElementById('log-photo-btn')?.addEventListener('click', () => openIssuePhotoSourceMenu());
document.getElementById('log-camera-btn')?.addEventListener('touchend', e=>{e.preventDefault();openIssuePhotoSourceMenu(false);document.getElementById('log-camera-input').click();},{passive:false});
document.getElementById('log-camera-btn')?.addEventListener('click', ()=>{openIssuePhotoSourceMenu(false);document.getElementById('log-camera-input').click();});
document.getElementById('log-library-btn')?.addEventListener('touchend', e=>{e.preventDefault();openIssuePhotoSourceMenu(false);document.getElementById('log-library-input').click();},{passive:false});
document.getElementById('log-library-btn')?.addEventListener('click', ()=>{openIssuePhotoSourceMenu(false);document.getElementById('log-library-input').click();});

// photos - add modal
document.getElementById('log-camera-input').addEventListener('change', function(){ handleFiles(this.files, pendingPhotos, 'photo-previews'); this.value=''; });
document.getElementById('log-library-input').addEventListener('change', function(){ handleFiles(this.files, pendingPhotos, 'photo-previews'); this.value=''; });

// photos - edit modal
document.getElementById('edit-photo-input').addEventListener('change', function(){ handleFiles(this.files, editPhotos, 'edit-photo-previews'); });
document.getElementById('edit-status-camera-btn')?.addEventListener('click', () => document.getElementById('edit-status-camera-input')?.click());
document.getElementById('edit-status-library-btn')?.addEventListener('click', () => document.getElementById('edit-status-library-input')?.click());
document.getElementById('edit-status-camera-input')?.addEventListener('change', function(){ handleFiles(this.files, editStatusPhotos, 'edit-status-photo-previews'); this.value=''; });
document.getElementById('edit-status-library-input')?.addEventListener('change', function(){ handleFiles(this.files, editStatusPhotos, 'edit-status-photo-previews'); this.value=''; });
const edz = document.getElementById('edit-drop-zone');
edz.addEventListener('dragover', e=>{e.preventDefault();edz.classList.add('drag-over');});
edz.addEventListener('dragleave', ()=>edz.classList.remove('drag-over'));
edz.addEventListener('drop', e=>{e.preventDefault();edz.classList.remove('drag-over');handleFiles(e.dataTransfer.files,editPhotos,'edit-photo-previews');});

async function handleFiles(files, arr, previewId) {
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) continue;
    const dataUrl = await resizeImage(file);
    arr.push({ name: file.name, dataUrl });
  }
  renderPreviews(arr, previewId);
}

function renderPreviews(arr, previewId) {
  const c = document.getElementById(previewId); c.innerHTML='';
  arr.forEach((p,i) => {
    const wrap=document.createElement('div'); wrap.className='photo-preview-item';
    const img=document.createElement('img'); img.className='photo-preview-img'; img.src=p.dataUrl || p.downloadURL || '';
    const rm=document.createElement('button'); rm.className='photo-remove'; rm.textContent='✕';
    rm.onclick=()=>{ arr.splice(i,1); renderPreviews(arr,previewId); };
    wrap.appendChild(img); wrap.appendChild(rm); c.appendChild(wrap);
  });
}

function setSubmitting(on) {
  document.getElementById('submit-btn').disabled=on;
  document.getElementById('cancel-btn').disabled=on;
  document.getElementById('submit-btn').innerHTML=on
    ? '<span class="spinner"></span> Saving…'
    : (logCatKey === 'attention' ? '◇ Log Attention' : '⚠ Log Issue');
}

// ── SUBMIT NEW ──
window.submitIssue = async () => {
  if (!currentUserPermissions.canCreateIssue) return;
  if (!currentMachine) {
    showGameToast('⚠️ No press selected. Please select a press first.');
    return;
  }
  setSubmitting(true);
  try {
    const d = getIssueDateFromInputs('issue-date','issue-time-input');
    const initialStatus = logCatKey || 'open';
    const initialSubStatus = logCatSub || '';
    const note = document.getElementById('issue-note').value.trim() || 'No Description Provided';
    const initialWorkflowId = createWorkflowId(initialStatus);
    const shiftSel = document.getElementById('issue-shift').value;
    const shift = shiftSel === 'auto' ? getShiftForTime(d, getShiftSchedule(currentPlantId)) : shiftSel;
    const timerMinutes = parseTimerMinutes(document.getElementById('issue-timer-minutes')?.value);
    const isUrgent = Boolean(document.getElementById('issue-urgent')?.checked);
    const issueRef = doc(plantCol('issues'));
    const actor = currentActor();
    const draft = {
      plantId: currentPlantId,
      machine: currentMachine,
      note,
      dateTime: fmtDate(d),
      statusDateTime: fmtDate(d),
      dateKey: localDateStr(d),
      timestamp: d.getTime(),
      pressId: toPressId(currentMachine),
      rowId: toRowId(findRowNameForMachine(currentMachine)),
      shift,
      timer: buildIssueTimer(timerMinutes, d),
      userId: currentUser.uid,
      userName: currentUser.displayName||currentUser.email,
      actor,
      initialStatus,
      initialSubStatus,
      initialWorkflowId,
      isUrgent,
      createdAtIso: new Date().toISOString()
    };
    const localPhotos = pendingPhotos.map(p => ({ ...p }));
    if (shouldUseSqlStagingReads(currentPlantId)) {
      if (guardOfflinePhotos(localPhotos, 'Issue photos')) {
        setSubmitting(false);
        return;
      }
      if (!syncState.online) {
        setSyncStatus('err', 'D1 issue logging currently requires connection.');
        setSubmitting(false);
        return;
      }
      const uploadedPhotos = await uploadIssuePhotosToStorage(issueRef.id, localPhotos);
      const createdIssue = buildLocalIssuePayloadFromDraft(issueRef.id, draft, uploadedPhotos);
      createdIssue.id = issueRef.id;
      createdIssue.photos = uploadedPhotos;
      const payload = await dataApi.createIssue(currentPlantId, {
        issueId: issueRef.id,
        issue: createdIssue,
        attachments: sqlAttachmentPayloads(uploadedPhotos),
        replaceAttachments: true,
        permissionName: 'canCreateIssue',
        events: [
          sqlEventPayload('issue_created', { machineCode: currentMachine, note, initialStatusKey: initialStatus, initialSubStatusKey: initialSubStatus, urgent: isUrgent }),
          sqlEventPayload('status_changed', { fromStatusKey: null, fromSubStatusKey: null, toStatusKey: initialStatus, toSubStatusKey: initialSubStatus, note: '' })
        ]
      });
      attachmentPhotoCache.set(issueRef.id, uploadedPhotos);
      issuesById.set(issueRef.id, payload?.issue ? normalizeSqlIssueForApp(payload.issue) : { ...createdIssue, id: issueRef.id });
      rebuildIssuesArrayFromMap();
      refreshVisibleData();
      issueLogPrefs.lastStatusKey = initialStatus;
      issueLogPrefs.lastStatusSub = initialSubStatus;
      issueLogPrefs.timerMinutes = String(document.getElementById('issue-timer-minutes')?.value || '');
      issueLogPrefs.urgent = false;
      saveIssueLogPrefs();
      if (timerMinutes > 0) setIssueReminder(issueRef.id, timerMinutes);
      completeDemoGuideStep('log');
      closeModal();
      showGameToast(`Logged Press ${currentMachine}`);
      queueRoleFeedAlert({ id: issueRef.id, machine: currentMachine }, { statusKey: initialStatus, subStatus: initialSubStatus, note, workflowId: initialWorkflowId }).catch(e => console.warn('role alert queue failed', e));
      if (uploadedPhotos.length > 0) awardGamification('photo_attached', { issueId: issueRef.id, dedupeSuffix: 'photo', tags: ['photo:attached'] }).catch(e => console.warn('gamification photo award failed', e));
      awardGamification('issue_created_complete', { issueId: issueRef.id, dedupeSuffix: 'issue-created', tags: ['issue:create', `status:${initialStatus || 'open'}`] }).catch(e => console.warn('gamification issue-created award failed', e));
      if (requiresSerialNumber(initialStatus, initialSubStatus)) {
        setTimeout(() => openSerialModal(issueRef.id, initialStatus, initialSubStatus, fmtDate(d)), 50);
      }
      return;
    }
    const outboxItem = {
      id: issueRef.id,
      plantId: currentPlantId,
      userId: currentUser.uid,
      machine: currentMachine,
      initialStatus,
      status: 'pending',
      draft,
      localPhotos,
      events: [
        {
          type: 'issue_created',
          payload: { machineCode: currentMachine, note, initialStatusKey: initialStatus, initialSubStatusKey: initialSubStatus, urgent: isUrgent }
        },
        {
          type: 'status_changed',
          payload: { fromStatusKey: null, fromSubStatusKey: null, toStatusKey: initialStatus, toSubStatusKey: initialSubStatus, note: '' }
        }
      ],
      roleAlert: { statusKey: initialStatus, subStatus: initialSubStatus, note, workflowId: initialWorkflowId },
      createdAtMs: Date.now(),
      updatedAt: new Date().toISOString()
    };
    await saveLocalIssueOutboxItem(outboxItem);
    issueLogPrefs.lastStatusKey = initialStatus;
    issueLogPrefs.lastStatusSub = initialSubStatus;
    issueLogPrefs.timerMinutes = String(document.getElementById('issue-timer-minutes')?.value || '');
    issueLogPrefs.urgent = false;
    saveIssueLogPrefs();
    if (timerMinutes > 0) setIssueReminder(issueRef.id, timerMinutes);
    attachmentPhotoCache.set(issueRef.id, localPhotos);
    issuesById.set(issueRef.id, localIssueForOutboxItem(outboxItem));
    rebuildIssuesArrayFromMap();
    refreshVisibleData();
    setSyncStatus('syncing', 'Syncing - local issue pending');
    completeDemoGuideStep('log');
    closeModal();
    showGameToast(syncState.online ? `Logged Press ${currentMachine} - syncing` : `Saved locally for Press ${currentMachine}`);
    scheduleIssueOutboxFlush();
    if (requiresSerialNumber(initialStatus, initialSubStatus)) {
      setTimeout(() => {
        openSerialModal(issueRef.id, initialStatus, initialSubStatus, fmtDate(d));
        if (!issues.find(i => i.id === issueRef.id)) {
          document.getElementById('serial-modal-machine').textContent = currentMachine;
        }
      }, 50);
    }
  } catch(e) {
    setSyncStatus('err','Error saving locally: '+e.message);
    setSubmitting(false);
  } finally {
    if (document.getElementById('add-modal')?.classList.contains('visible')) setSubmitting(false);
  }
};

// ── EDIT MODAL ──
window.openEditModal = async id => {
  if (!currentUserPermissions.canEditIssue) return;
  const issue = issues.find(i=>i.id===id);
  if (!issue) return;
  let photoList = issue.photos || [];
  if (photoList.length === 0 && Number(issue.photoCount || 0) > 0) {
    photoList = await fetchAttachmentPhotos(id);
    issue.photos = photoList;
  }
  editTargetId = id;
  editPhotos = (photoList||[]).map(p=>({name:p.name,dataUrl:p.dataUrl,storagePath:p.storagePath||'',storageBucket:p.storageBucket||'',contentType:p.contentType||'',sizeBytes:Number(p.sizeBytes||0)}));
  document.getElementById('edit-machine-name').textContent = issue.machine;
  document.getElementById('edit-note').value = issue.note||'';
  // Parse existing date back into inputs
  try {
    const d = new Date(issue.timestamp);
    const {dateStr,timeStr} = toLocalDTInputs(d);
    document.getElementById('edit-date').value = dateStr;
    document.getElementById('edit-time-input').value = timeStr;
  } catch(e) {}
  renderPreviews(editPhotos,'edit-photo-previews');
  document.getElementById('edit-photo-input').value='';
  document.getElementById('edit-shift').value = issue.shift || 'auto';
  document.getElementById('edit-timer-minutes').value = String(getIssueReminderMinutes(id) || '');
  const btn = document.getElementById('edit-submit-btn');
  btn.disabled=false; btn.innerHTML='💾 Save Changes';
  document.getElementById('edit-modal').classList.add('visible');
};
window.closeEditModal = () => { document.getElementById('edit-modal').classList.remove('visible'); editTargetId=null; editPhotos=[]; };

window.saveEdit = async () => {
  const note = document.getElementById('edit-note').value.trim();
  if (!note) { document.getElementById('edit-note').focus(); return; }
  const btn = document.getElementById('edit-submit-btn');
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Saving…';
  try {
    if (guardOfflinePhotos(editPhotos, 'Issue photos')) {
      btn.disabled=false; btn.innerHTML='💾 Save Changes';
      return;
    }
    const d = getIssueDateFromInputs('edit-date','edit-time-input');
    const issue = issues.find(i=>i.id===editTargetId);
    const last = currentStatus(issue || {});
    const shiftSel = document.getElementById('edit-shift').value;
    const shift = shiftSel === 'auto' ? getShiftForTime(d, getShiftSchedule(currentPlantId)) : shiftSel;
    const timerMinutes = parseTimerMinutes(document.getElementById('edit-timer-minutes')?.value);
    const uploadedPhotos = await uploadIssuePhotosToStorage(editTargetId, editPhotos);
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const issuePatch = {
        note,
        dateTime: fmtDate(d), dateKey: localDateStr(d), timestamp: d.getTime(),
        shift,
        timer: buildIssueTimer(timerMinutes, d, issue?.timer || null),
        photoCount: uploadedPhotos.length,
        editedAt: fmtDate(new Date()), editedBy: currentUser.displayName||currentUser.email,
        ...buildIssueV2CompatLocal({
          machineCode: issue?.machine || currentMachine,
          statusKey: last?.status || currentStatusKey(issue || {}),
          subStatus: last?.subStatus || issue?.subStatus || '',
          statusDateTime: last?.dateTime || issue?.dateTime || fmtDate(new Date()),
          note,
          baseIssue: issue
        })
      };
      const nextIssue = applyIssuePatchLocally(issue, issuePatch);
      nextIssue.id = editTargetId;
      nextIssue.photos = uploadedPhotos;
      await commitSqlIssueWrite(editTargetId, nextIssue, {
        attachments: sqlAttachmentPayloads(uploadedPhotos),
        replaceAttachments: true,
        events: [sqlEventPayload('issue_edited', { fieldsChanged: ['note', 'photos', 'dateTime', 'dateKey', 'timestamp'] })]
      });
      if (timerMinutes > 0) setIssueReminder(editTargetId, timerMinutes);
      else clearIssueReminder(editTargetId);
      attachmentPhotoCache.set(editTargetId, uploadedPhotos);
      if (uploadedPhotos.length > 0) awardGamification('photo_attached', { issueId: editTargetId, dedupeSuffix: 'photo', tags: ['photo:attached'] }).catch(e => console.warn('gamification photo award failed', e));
      closeEditModal();
      return;
    }
    const issuePatch = {
      note,
      dateTime: fmtDate(d), dateKey: localDateStr(d), timestamp: d.getTime(),
      shift,
      timer: buildIssueTimer(timerMinutes, d, issue?.timer || null),
      photoCount: uploadedPhotos.length,
      editedAt: fmtDate(new Date()), editedBy: currentUser.displayName||currentUser.email,
      ...buildIssueV2Compat({
        machineCode: issue?.machine || currentMachine,
        statusKey: last?.status || currentStatusKey(issue || {}),
        subStatus: last?.subStatus || issue?.subStatus || '',
        statusDateTime: last?.dateTime || issue?.dateTime || fmtDate(new Date()),
        note,
        baseIssue: issue
      })
    };
    const batch = writeBatch(db);
    batch.update(plantDoc('issues',editTargetId), issuePatch);
    queueAttachmentDocs(batch, editTargetId, uploadedPhotos);
    queueIssueEvent(batch, editTargetId, 'issue_edited', {
      fieldsChanged: ['note', 'photos', 'dateTime', 'dateKey', 'timestamp']
    });
    await batch.commit();
    if (timerMinutes > 0) setIssueReminder(editTargetId, timerMinutes);
    else clearIssueReminder(editTargetId);
    attachmentPhotoCache.set(editTargetId, uploadedPhotos);
    if (uploadedPhotos.length > 0) awardGamification('photo_attached', { issueId: editTargetId, dedupeSuffix: 'photo', tags: ['photo:attached'] }).catch(e => console.warn('gamification photo award failed', e));
    const editedIssue = { ...(issue || {}), ...issuePatch, id: editTargetId, photos: uploadedPhotos };
    issuesById.set(editTargetId, editedIssue);
    rebuildIssuesArrayFromMap();
    refreshVisibleData();
    if (!syncState.online) setSyncStatus('syncing', 'Syncing - local changes pending');
    closeEditModal();
  } catch(e) {
    setSyncStatus('err','Error saving: '+e.message);
    btn.disabled=false; btn.innerHTML='💾 Save Changes';
  }
};

// ── RESOLVE ──
window.openResolveModal = id => {
  if (!currentUserPermissions.canResolveIssue) return;
  resolveTargetId=id;
  const issue=issues.find(i=>i.id===id);
  document.getElementById('resolve-machine-label').textContent='Press '+issue.machine+' — logged '+issue.dateTime;
  document.getElementById('resolve-note').value='';
  const btn=document.getElementById('resolve-confirm-btn'); btn.disabled=false; btn.innerHTML='Mark Resolved';
  document.getElementById('resolve-modal').classList.add('visible');
};
window.closeResolveModal = () => { document.getElementById('resolve-modal').classList.remove('visible'); resolveTargetId=null; };
window.confirmResolve = async () => {
  const note=document.getElementById('resolve-note').value.trim();
  const btn=document.getElementById('resolve-confirm-btn');
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Saving…';
  try {
    const issue = issues.find(i=>i.id===resolveTargetId);
    const last = currentStatus(issue || {});
    const resolvedAtText = fmtDate(new Date());
    const resolvedWorkflowId = createWorkflowId('resolved');
    const resolvedHistEntry = {
      status: 'resolved', subStatus: '',
      note: note || 'Resolved (no details provided)',
      dateTime: resolvedAtText,
      by: currentUser.displayName || currentUser.email,
      workflowId: resolvedWorkflowId
    };
    const issuePatch = {
      statusHistory: [...getMutableStatusHistory(issue || {}), resolvedHistEntry],
      workflowState: 'finished',
      'workflowStateHistory.finished': { by: currentActor(), at: serverTimestamp() },
      [`workflowStateByEntry.${resolvedWorkflowId}`]: 'finished',
      [`workflowStateByEntryHistory.${resolvedWorkflowId}.finished`]: { by: currentActor(), at: serverTimestamp() },
      secondaryStatuses: [], // clear all secondary tags on resolve
      ...buildIssueV2Compat({
        machineCode: issue?.machine || '',
        statusKey: 'resolved',
        subStatus: '',
        statusDateTime: resolvedAtText,
        note: note || 'Resolved (no details provided)',
        baseIssue: issue
      })
    };
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const nextIssue = applyIssuePatchLocally(issue, {
        ...issuePatch,
        workflowStateHistory: { ...(issue?.workflowStateHistory || {}), finished: { by: currentActor(), at: new Date().toISOString() } },
        workflowStateByEntry: { ...(issue?.workflowStateByEntry || {}), [resolvedWorkflowId]: 'finished' },
        workflowStateByEntryHistory: {
          ...(issue?.workflowStateByEntryHistory || {}),
          [resolvedWorkflowId]: { ...((issue?.workflowStateByEntryHistory || {})[resolvedWorkflowId] || {}), finished: { by: currentActor(), at: new Date().toISOString() } }
        }
      });
      nextIssue.id = resolveTargetId;
      await commitSqlIssueWrite(resolveTargetId, nextIssue, {
        permissionName: 'canResolveIssue',
        events: [
          sqlEventPayload('issue_resolved', { resolutionNote: note || 'Resolved (no details provided)' }),
          sqlEventPayload('status_changed', {
            fromStatusKey: last?.status || currentStatusKey(issue || {}),
            fromSubStatusKey: last?.subStatus || '',
            toStatusKey: 'resolved',
            toSubStatusKey: '',
            note: note || 'Resolved (no details provided)'
          })
        ]
      });
      awardGamification('issue_resolved', { issueId: resolveTargetId, dedupeSuffix: resolvedAtText, tags: ['issue:resolved', 'status:resolved'] }).catch(e => console.warn('gamification resolve award failed', e));
      closeResolveModal();
      return;
    }
    const batch = writeBatch(db);
    batch.update(plantDoc('issues',resolveTargetId), issuePatch);
    queueIssueEvent(batch, resolveTargetId, 'issue_resolved', { resolutionNote: note || 'Resolved (no details provided)' });
    queueIssueEvent(batch, resolveTargetId, 'status_changed', {
      fromStatusKey: last?.status || currentStatusKey(issue || {}),
      fromSubStatusKey: last?.subStatus || '',
      toStatusKey: 'resolved',
      toSubStatusKey: '',
      note: note || 'Resolved (no details provided)'
    });
    await batch.commit();
    if (issue) {
      issuesById.set(resolveTargetId, { ...issue, ...issuePatch, id: resolveTargetId, resolved: true });
      rebuildIssuesArrayFromMap();
      refreshVisibleData();
    }
    if (!syncState.online) setSyncStatus('syncing', 'Syncing - local changes pending');
    awardGamification('issue_resolved', { issueId: resolveTargetId, dedupeSuffix: resolvedAtText, tags: ['issue:resolved', 'status:resolved'] }).catch(e => console.warn('gamification resolve award failed', e));
    closeResolveModal();
  } catch(e) { setSyncStatus('err','Error: '+e.message); btn.disabled=false; btn.innerHTML='Mark Resolved'; }
};

// ── REOPEN ──
window.openReopenModal = id => {
  if (!currentUserPermissions.canResolveIssue) return;
  reopenTargetId=id;
  const issue=issues.find(i=>i.id===id);
  document.getElementById('reopen-machine-label').textContent='Press '+issue.machine;
  document.getElementById('reopen-note').value='';
  const btn=document.getElementById('reopen-confirm-btn'); btn.disabled=false; btn.innerHTML='Re-open Issue';
  document.getElementById('reopen-modal').classList.add('visible');
};
window.closeReopenModal = () => { document.getElementById('reopen-modal').classList.remove('visible'); reopenTargetId=null; };
window.confirmReopen = async () => {
  const note=document.getElementById('reopen-note').value.trim();
  const btn=document.getElementById('reopen-confirm-btn');
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Saving…';
  try {
    const issue=issues.find(i=>i.id===reopenTargetId);
    const last = currentStatus(issue || {});
    const resolveHistory=issue.resolveHistory||[];
    resolveHistory.push({resolveNote:issue.resolveNote,resolveDateTime:issue.resolveDateTime,resolvedBy:issue.resolvedBy||''});
    const reopenStatusKey = last?.status && last.status !== 'resolved' ? last.status : 'open';
    const reopenSubStatus = last?.status && last.status !== 'resolved' ? (last.subStatus || '') : '';
    const reopenDateTime = fmtDate(new Date());
    const reopenWorkflowId = createWorkflowId(reopenStatusKey);
    const statusHistory = getMutableStatusHistory(issue);
    statusHistory.push({ status: reopenStatusKey, subStatus: reopenSubStatus, note: note || '', dateTime: reopenDateTime, by: currentUser.displayName || currentUser.email, workflowId: reopenWorkflowId });
    const issuePatch = {
      reopenNote:note||'',reopenDateTime,
      reopenedBy:currentUser.displayName||currentUser.email,resolveHistory,
      statusHistory,
      workflowState: null,
      [`workflowStateByEntry.${reopenWorkflowId}`]: null,
      ...buildIssueV2Compat({
        machineCode: issue?.machine || '',
        statusKey: reopenStatusKey,
        subStatus: reopenSubStatus,
        statusDateTime: reopenDateTime,
        note: note || '',
        baseIssue: issue,
        forceReopenIncrement: true
      })
    };
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const nextIssue = applyIssuePatchLocally(issue, {
        reopenNote:note||'',reopenDateTime,
        reopenedBy:currentUser.displayName||currentUser.email,resolveHistory,
        statusHistory,
        workflowState: null,
        workflowStateByEntry: { ...(issue?.workflowStateByEntry || {}), [reopenWorkflowId]: null },
        ...buildIssueV2CompatLocal({
          machineCode: issue?.machine || '',
          statusKey: reopenStatusKey,
          subStatus: reopenSubStatus,
          statusDateTime: reopenDateTime,
          note: note || '',
          baseIssue: issue,
          forceReopenIncrement: true
        })
      });
      nextIssue.id = reopenTargetId;
      await commitSqlIssueWrite(reopenTargetId, nextIssue, {
        permissionName: 'canResolveIssue',
        events: [sqlEventPayload('issue_reopened', { reason: note || '' })]
      });
      awardGamification('issue_reopened', { issueId: reopenTargetId, dedupeSuffix: reopenDateTime, tags: ['issue:reopened', `status:${reopenStatusKey}`] }).catch(e => console.warn('gamification reopen award failed', e));
      closeReopenModal();
      return;
    }
    const batch = writeBatch(db);
    batch.update(plantDoc('issues',reopenTargetId), issuePatch);
    queueIssueEvent(batch, reopenTargetId, 'issue_reopened', { reason: note || '' });
    await batch.commit();
    if (issue) {
      issuesById.set(reopenTargetId, { ...issue, ...issuePatch, id: reopenTargetId, resolved: false });
      rebuildIssuesArrayFromMap();
      refreshVisibleData();
    }
    if (!syncState.online) setSyncStatus('syncing', 'Syncing - local changes pending');
    awardGamification('issue_reopened', { issueId: reopenTargetId, dedupeSuffix: reopenDateTime, tags: ['issue:reopened', `status:${reopenStatusKey}`] }).catch(e => console.warn('gamification reopen award failed', e));
    closeReopenModal();
  } catch(e) { setSyncStatus('err','Error: '+e.message); btn.disabled=false; btn.innerHTML='Re-open Issue'; }
};

// ── STATUS HISTORY ──

// Helper: get current status from history
function currentStatus(issue) {
  const statusHistory = issue.statusHistory;
  if (statusHistory && statusHistory.length > 0) return statusHistory[statusHistory.length - 1];
  const evh = issue.eventHistory;
  if (evh && evh.length > 0) return evh[evh.length - 1];
  if (issue.currentStatus?.statusKey) {
    return {
      status: issue.currentStatus.statusKey,
      subStatus: issue.currentStatus.subStatusKey || '',
      note: issue.currentStatus.notePreview || '',
      dateTime: issue.currentStatus.enteredDateTime || '',
      by: issue.currentStatus.enteredBy?.name || ''
    };
  }
  return { status: currentStatusKey(issue), subStatus: '', note:'', dateTime:'', by:'' };
}

function getMutableStatusHistory(issue) {
  if (Array.isArray(issue.statusHistory) && issue.statusHistory.length > 0) {
    return issue.statusHistory.map(entry => ({ ...entry }));
  }
  if (Array.isArray(issue.eventHistory) && issue.eventHistory.length > 0) {
    return issue.eventHistory.map(entry => ({ ...entry }));
  }
  if (issue?.currentStatus?.statusKey || issue?.status || issue?.dateTime) {
    return [{
      status: currentStatusKey(issue),
      subStatus: issue.currentStatus?.subStatusKey || issue.subStatus || '',
      note: issue.currentStatus?.notePreview || '',
      dateTime: issue.currentStatus?.enteredDateTime || issue.dateTime || fmtDate(new Date()),
      by: issue.currentStatus?.enteredBy?.name || issue.userName || ''
    }];
  }
  return [];
}

async function getLatestIssueForStatusMutation(issueId, fallbackIssue) {
  if (shouldUseSqlStagingReads(currentPlantId)) {
    const payload = await requireSqlRead(
      `issue ${issueId}`,
      () => dataApi.getIssue(currentPlantId, issueId),
      `Issue ${issueId} is missing in D1 for plant ${currentPlantId}.`
    );
    if (payload?.issue) return normalizeSqlIssueForApp(payload.issue);
    return fallbackIssue || null;
  }
  try {
    const snap = await getDoc(plantDoc('issues', issueId));
    if (!snap.exists()) return fallbackIssue || null;
    return { ...(fallbackIssue || {}), ...snap.data() };
  } catch (_) {
    return fallbackIssue || null;
  }
}

function buildAddStatusEntryMutation(baseIssue, fallbackIssue, entry, status, subStatus, note) {
  const base = baseIssue || fallbackIssue || {};
  const history = getMutableStatusHistory(base);
  const prevEntry = history[history.length - 1] || null;
  const prevWorkflowIdBeforePush = getEntryWorkflowId(prevEntry);
  if (prevEntry && !prevWorkflowIdBeforePush) {
    prevEntry.workflowId = createWorkflowId(prevEntry.status);
    history[history.length - 1] = prevEntry;
  }
  const prev = currentStatus(base || fallbackIssue || {});
  const prevWorkflowState = base?.workflowState || null;
  const prevWorkflowId = getEntryWorkflowId(prevEntry);
  history.push(entry);
  return {
    prev,
    issuePatch: {
      statusHistory: history,
      ...(status === 'resolved'
        ? {
            workflowState: 'finished',
            'workflowStateHistory.finished': { by: currentActor(), at: serverTimestamp() },
            [`workflowStateByEntry.${entry.workflowId}`]: 'finished',
            [`workflowStateByEntryHistory.${entry.workflowId}.finished`]: { by: currentActor(), at: serverTimestamp() }
          }
        : { workflowState: null }),
      ...(status !== 'resolved' ? { [`workflowStateByEntry.${entry.workflowId}`]: null } : {}),
      ...(status !== 'resolved' && prevWorkflowId && prevWorkflowState
        ? { [`workflowStateByEntry.${prevWorkflowId}`]: prevWorkflowState }
        : {}),
      ...(status !== 'resolved' && prev?.status && prevWorkflowState
        ? { [`workflowStateByStatus.${prev.status}`]: prevWorkflowState }
        : {}),
      ...(status !== 'resolved' ? { [`workflowStateByStatus.${status}`]: null } : {}),
      ...buildIssueV2Compat({
        machineCode: base?.machine || base?.machineCode || fallbackIssue?.machine || '',
        statusKey: status,
        subStatus: subStatus || '',
        statusDateTime: entry.dateTime,
        note: note || '',
        baseIssue: base || fallbackIssue
      })
    }
  };
}

// Add a new status entry to history
window.addStatusEntry = async (id, status, subStatus, note, dateTime) => {
  if (!currentUserPermissions.canEditIssue) return;
  const issue = issues.find(i => i.id === id);
  if (!issue) return;
  const workflowId = createWorkflowId(status);
  const entry = {
    status,
    subStatus: subStatus || '',
    note: note || '',
    dateTime: dateTime || fmtDate(new Date()),
    by: currentUser.displayName || currentUser.email,
    workflowId
  };
  let prev = currentStatus(issue);
  let appliedIssuePatch = null;
  try {
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const mutation = buildAddStatusEntryMutation(issue, issue, entry, status, subStatus, note);
      prev = mutation.prev;
      appliedIssuePatch = {
        ...mutation.issuePatch,
        workflowStateHistory: mutation.issuePatch.workflowState === 'finished'
          ? { ...(issue?.workflowStateHistory || {}), finished: { by: currentActor(), at: new Date().toISOString() } }
          : { ...(issue?.workflowStateHistory || {}) },
        workflowStateByEntry: {
          ...(issue?.workflowStateByEntry || {}),
          [entry.workflowId]: mutation.issuePatch.workflowState === 'finished' ? 'finished' : null
        },
        workflowStateByEntryHistory: mutation.issuePatch.workflowState === 'finished'
          ? {
              ...(issue?.workflowStateByEntryHistory || {}),
              [entry.workflowId]: { ...((issue?.workflowStateByEntryHistory || {})[entry.workflowId] || {}), finished: { by: currentActor(), at: new Date().toISOString() } }
            }
          : { ...(issue?.workflowStateByEntryHistory || {}) }
      };
      const nextIssue = applyIssuePatchLocally(issue, {
        statusHistory: mutation.issuePatch.statusHistory,
        workflowState: mutation.issuePatch.workflowState,
        workflowStateHistory: appliedIssuePatch.workflowStateHistory,
        workflowStateByEntry: appliedIssuePatch.workflowStateByEntry,
        workflowStateByEntryHistory: appliedIssuePatch.workflowStateByEntryHistory,
        ...buildIssueV2CompatLocal({
          machineCode: issue?.machine || issue?.machineCode || '',
          statusKey: status,
          subStatus: subStatus || '',
          statusDateTime: entry.dateTime,
          note: note || '',
          baseIssue: issue
        })
      });
      nextIssue.id = id;
      await commitSqlIssueWrite(id, nextIssue, {
        events: [sqlEventPayload('status_changed', {
          fromStatusKey: prev?.status || currentStatusKey(issue),
          fromSubStatusKey: prev?.subStatus || '',
          toStatusKey: status,
          toSubStatusKey: subStatus || '',
          note: note || ''
        })]
      });
      queueRoleFeedAlert(issue, {
        statusKey: status,
        subStatus: subStatus || '',
        note: note || '',
        workflowId
      }).catch(e => console.warn('role alert queue failed', e));
      issueEventHistoryCache.delete(id);
      awardGamification('status_changed_valid', { issueId: id, dedupeSuffix: entry.dateTime || String(Date.now()), tags: ['status:changed', `status:${status}`] }).catch(e => console.warn('gamification award failed', e));
      if (status === 'resolved') awardGamification('issue_resolved', { issueId: id, dedupeSuffix: 'status-resolved', tags: ['issue:resolved', 'status:resolved'] }).catch(e => console.warn('gamification resolve award failed', e));
      if (status && status !== 'open') completeDemoGuideStep('route');
      return;
    }
    const writeStatusChange = (batch, issuePatch) => {
      batch.update(plantDoc('issues', id), issuePatch);
      queueIssueEvent(batch, id, 'status_changed', {
        fromStatusKey: prev?.status || currentStatusKey(issue),
        fromSubStatusKey: prev?.subStatus || '',
        toStatusKey: status,
        toSubStatusKey: subStatus || '',
        note: note || ''
      });
    };
    const commitOfflineStatusBatch = async () => {
      const mutation = buildAddStatusEntryMutation(issue, issue, entry, status, subStatus, note);
      prev = mutation.prev;
      appliedIssuePatch = mutation.issuePatch;
      const batch = writeBatch(db);
      writeStatusChange(batch, mutation.issuePatch);
      await batch.commit();
    };
    if (syncState.online) {
      try {
        await runTransaction(db, async tx => {
          const ref = plantDoc('issues', id);
          const snap = await tx.get(ref);
          const base = snap.exists() ? { id, ...snap.data() } : issue;
          const mutation = buildAddStatusEntryMutation(base, issue, entry, status, subStatus, note);
          prev = mutation.prev;
          appliedIssuePatch = mutation.issuePatch;
          tx.update(ref, mutation.issuePatch);
        });
        await addDoc(issueEventsCol(id), {
          type: 'status_changed',
          eventAt: serverTimestamp(),
          actor: currentActor(),
          payload: {
            fromStatusKey: prev?.status || currentStatusKey(issue),
            fromSubStatusKey: prev?.subStatus || '',
            toStatusKey: status,
            toSubStatusKey: subStatus || '',
            note: note || ''
          },
          schemaVersion: 2
        });
      } catch (e) {
        if (!isOfflineLikeError(e)) throw e;
        refreshSyncState({ status: 'offline', online: false, manualText: 'Offline - showing cached data' });
        await commitOfflineStatusBatch();
      }
    } else {
      await commitOfflineStatusBatch();
    }
    if (appliedIssuePatch) {
      issuesById.set(id, { ...issue, ...appliedIssuePatch, id });
      rebuildIssuesArrayFromMap();
      refreshVisibleData();
      if (!syncState.online) setSyncStatus('syncing', 'Syncing - local changes pending');
    }
    queueRoleFeedAlert(issue, {
      statusKey: status,
      subStatus: subStatus || '',
      note: note || '',
      workflowId
    }).catch(e => console.warn('role alert queue failed', e));
    issueEventHistoryCache.delete(id);
    awardGamification('status_changed_valid', { issueId: id, dedupeSuffix: entry.dateTime || String(Date.now()), tags: ['status:changed', `status:${status}`] }).catch(e => console.warn('gamification award failed', e));
    if (status === 'resolved') awardGamification('issue_resolved', { issueId: id, dedupeSuffix: 'status-resolved', tags: ['issue:resolved', 'status:resolved'] }).catch(e => console.warn('gamification resolve award failed', e));
    if (status && status !== 'open') completeDemoGuideStep('route');
  } catch(e) { setSyncStatus('err','Error: '+e.message); }
};

// Update an existing history entry
window.updateStatusEntry = async (id, idx, status, subStatus, note, dateTime, photos = null) => {
  const issue = issues.find(i=>i.id===id);
  if (!issue) return;
  const latestIssue = await getLatestIssueForStatusMutation(id, issue);
  const history = getMutableStatusHistory(latestIssue || issue);
  // idx beyond real history means editing a synthetic current-status entry — materialize it first
  if (idx >= history.length) {
    history.push({
      status: currentStatusKey(latestIssue || issue),
      subStatus: (latestIssue || issue).currentStatus?.subStatusKey || '',
      note: (latestIssue || issue).currentStatus?.notePreview || '',
      dateTime: (latestIssue || issue).currentStatus?.enteredDateTime || '',
      by: (latestIssue || issue).currentStatus?.enteredBy?.name || ''
    });
    idx = history.length - 1;
  }
  if (!history[idx]) return;
  const prev = currentStatus(latestIssue || issue);
  history[idx] = { ...history[idx], status, subStatus: subStatus||'', note: note||'' };
  if (dateTime) history[idx].dateTime = dateTime;
  if (Array.isArray(photos)) history[idx].photos = photos;
  // Recalculate current status from last entry
  const last = history[history.length - 1];
  try {
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const nextIssue = applyIssuePatchLocally(latestIssue || issue, {
        statusHistory: history,
        ...(Array.isArray(photos) ? { photos: issue.photos || [] } : {}),
        ...buildIssueV2CompatLocal({
          machineCode: issue.machine || issue.machineCode || '',
          statusKey: last.status || 'open',
          subStatus: last.subStatus || '',
          statusDateTime: last.dateTime || fmtDate(new Date()),
          note: last.note || '',
          baseIssue: latestIssue || issue
        })
      });
      nextIssue.id = id;
      if ((prev?.status || 'open') !== (last.status || 'open') || (prev?.subStatus || '') !== (last.subStatus || '')) {
        await commitSqlIssueWrite(id, nextIssue, {
          events: [sqlEventPayload('status_changed', {
            fromStatusKey: prev?.status || currentStatusKey(latestIssue || issue),
            fromSubStatusKey: prev?.subStatus || '',
            toStatusKey: last.status || 'open',
            toSubStatusKey: last.subStatus || '',
            note: last.note || ''
          })]
        });
      } else {
        await commitSqlIssueWrite(id, nextIssue);
      }
      issueEventHistoryCache.delete(id);
      return;
    }
    const issuePatch = {
      statusHistory: history,
      ...buildIssueV2Compat({
        machineCode: issue.machine || issue.machineCode || '',
        statusKey: last.status || 'open',
        subStatus: last.subStatus || '',
        statusDateTime: last.dateTime || fmtDate(new Date()),
        note: last.note || '',
        baseIssue: latestIssue || issue
      })
    };
    const batch = writeBatch(db);
    batch.update(plantDoc('issues',id), issuePatch);
    if ((prev?.status || 'open') !== (last.status || 'open') || (prev?.subStatus || '') !== (last.subStatus || '')) {
      queueIssueEvent(batch, id, 'status_changed', {
        fromStatusKey: prev?.status || currentStatusKey(latestIssue || issue),
        fromSubStatusKey: prev?.subStatus || '',
        toStatusKey: last.status || 'open',
        toSubStatusKey: last.subStatus || '',
        note: last.note || ''
      });
    }
    await batch.commit();
    issueEventHistoryCache.delete(id);
    issuesById.set(id, { ...(latestIssue || issue), ...issuePatch, id });
    rebuildIssuesArrayFromMap();
    refreshVisibleData();
    if (!syncState.online) setSyncStatus('syncing', 'Syncing - local changes pending');
  } catch(e) { setSyncStatus('err','Error: '+e.message); }
};

// Remove a history entry (cannot remove the only entry)
window.removeStatusEntry = async (id, idx) => {
  const issue = issues.find(i=>i.id===id);
  if (!issue) return;
  const latestIssue = await getLatestIssueForStatusMutation(id, issue);
  const history = getMutableStatusHistory(latestIssue || issue);
  const prev = currentStatus(latestIssue || issue);
  if (history.length <= 1) return;
  history.splice(idx, 1);
  const last = history[history.length - 1];
  try {
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const nextIssue = applyIssuePatchLocally(latestIssue || issue, {
        statusHistory: history,
        ...buildIssueV2CompatLocal({
          machineCode: issue.machine || issue.machineCode || '',
          statusKey: last.status || 'open',
          subStatus: last.subStatus || '',
          statusDateTime: last.dateTime || fmtDate(new Date()),
          note: last.note || '',
          baseIssue: latestIssue || issue
        })
      });
      nextIssue.id = id;
      if ((prev?.status || 'open') !== (last.status || 'open') || (prev?.subStatus || '') !== (last.subStatus || '')) {
        await commitSqlIssueWrite(id, nextIssue, {
          events: [sqlEventPayload('status_changed', {
            fromStatusKey: prev?.status || currentStatusKey(latestIssue || issue),
            fromSubStatusKey: prev?.subStatus || '',
            toStatusKey: last.status || 'open',
            toSubStatusKey: last.subStatus || '',
            note: 'Timeline entry removed'
          })]
        });
      } else {
        await commitSqlIssueWrite(id, nextIssue);
      }
      issueEventHistoryCache.delete(id);
      return;
    }
    const issuePatch = {
      statusHistory: history,
      ...buildIssueV2Compat({
        machineCode: issue.machine || issue.machineCode || '',
        statusKey: last.status || 'open',
        subStatus: last.subStatus || '',
        statusDateTime: last.dateTime || fmtDate(new Date()),
        note: last.note || '',
        baseIssue: latestIssue || issue
      })
    };
    const batch = writeBatch(db);
    batch.update(plantDoc('issues',id), issuePatch);
    if ((prev?.status || 'open') !== (last.status || 'open') || (prev?.subStatus || '') !== (last.subStatus || '')) {
      queueIssueEvent(batch, id, 'status_changed', {
        fromStatusKey: prev?.status || currentStatusKey(latestIssue || issue),
        fromSubStatusKey: prev?.subStatus || '',
        toStatusKey: last.status || 'open',
        toSubStatusKey: last.subStatus || '',
        note: 'Timeline entry removed'
      });
    }
    await batch.commit();
    issueEventHistoryCache.delete(id);
  } catch(e) { setSyncStatus('err','Error: '+e.message); }
};

// Promote a historical status entry to be the current status.
window.setStatusCurrentFromHistory = async (id, idx) => {
  if (!currentUserPermissions.canEditIssue) return;
  const issue = issues.find(i => i.id === id);
  if (!issue) return;
  const history = getMutableStatusHistory(issue);
  const source = history[idx];
  if (!source || !source.status) return;
  const prev = currentStatus(issue);
  const workflowId = createWorkflowId(source.status);
  const nextEntry = {
    status: source.status,
    subStatus: source.subStatus || '',
    note: source.note || '',
    dateTime: fmtDate(new Date()),
    by: currentUser.displayName || currentUser.email,
    workflowId
  };
  history.push(nextEntry);
  try {
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const nextIssue = applyIssuePatchLocally(issue, {
        statusHistory: history,
        workflowState: nextEntry.status !== 'resolved' ? 'called' : 'finished',
        workflowStateHistory: {
          ...(issue?.workflowStateHistory || {}),
          [nextEntry.status !== 'resolved' ? 'called' : 'finished']: { by: currentActor(), at: new Date().toISOString() }
        },
        workflowStateByStatus: { ...(issue?.workflowStateByStatus || {}), [nextEntry.status]: 'called' },
        workflowStateByEntry: { ...(issue?.workflowStateByEntry || {}), [workflowId]: 'called' },
        workflowStateByEntryHistory: {
          ...(issue?.workflowStateByEntryHistory || {}),
          [workflowId]: { ...((issue?.workflowStateByEntryHistory || {})[workflowId] || {}), called: { by: currentActor(), at: new Date().toISOString() } }
        },
        ...buildIssueV2CompatLocal({
          machineCode: issue.machine || issue.machineCode || '',
          statusKey: nextEntry.status,
          subStatus: nextEntry.subStatus,
          statusDateTime: nextEntry.dateTime,
          note: nextEntry.note,
          baseIssue: issue,
          forceReopenIncrement: nextEntry.status !== 'resolved'
        })
      });
      nextIssue.id = id;
      await commitSqlIssueWrite(id, nextIssue, {
        events: [sqlEventPayload('status_changed', {
          fromStatusKey: prev?.status || currentStatusKey(issue),
          fromSubStatusKey: prev?.subStatus || '',
          toStatusKey: nextEntry.status,
          toSubStatusKey: nextEntry.subStatus || '',
          note: 'Set current from history'
        })]
      });
      issueEventHistoryCache.delete(id);
      await awardGamification('status_changed_valid', { issueId: id, dedupeSuffix: `set-current-${Date.now()}`, tags: ['status:changed', `status:${nextEntry.status}`] });
      return;
    }
    const patch = {
      statusHistory: history,
      [`workflowStateByStatus.${nextEntry.status}`]: 'called',
      [`workflowStateByEntry.${workflowId}`]: 'called',
      [`workflowStateByEntryHistory.${workflowId}.called`]: { by: currentActor(), at: serverTimestamp() },
      ...buildIssueV2Compat({
        machineCode: issue.machine || issue.machineCode || '',
        statusKey: nextEntry.status,
        subStatus: nextEntry.subStatus,
        statusDateTime: nextEntry.dateTime,
        note: nextEntry.note,
        baseIssue: issue,
        forceReopenIncrement: nextEntry.status !== 'resolved'
      })
    };
    if (nextEntry.status !== 'resolved') {
      patch.workflowState = 'called';
      patch['workflowStateHistory.called'] = { by: currentActor(), at: serverTimestamp() };
    } else {
      patch.workflowState = 'finished';
      patch['workflowStateHistory.finished'] = { by: currentActor(), at: serverTimestamp() };
    }
    const batch = writeBatch(db);
    batch.update(plantDoc('issues', id), patch);
    queueIssueEvent(batch, id, 'status_changed', {
      fromStatusKey: prev?.status || currentStatusKey(issue),
      fromSubStatusKey: prev?.subStatus || '',
      toStatusKey: nextEntry.status,
      toSubStatusKey: nextEntry.subStatus || '',
      note: 'Set current from history'
    });
    await batch.commit();
    issueEventHistoryCache.delete(id);
    await awardGamification('status_changed_valid', { issueId: id, dedupeSuffix: `set-current-${Date.now()}`, tags: ['status:changed', `status:${nextEntry.status}`] });
  } catch (e) {
    setSyncStatus('err','Error: '+e.message);
  }
};

// State for pending new entry per issue
const pendingEntry = {};
window.setPendingStatus = (id, key, val) => {
  if (!pendingEntry[id]) pendingEntry[id] = {};
  pendingEntry[id][key] = val;
  // Only re-render when status changes (to update sub-status options) — NOT for note keystrokes
  if (key === 'status') renderIssues();
};
window.commitAddEntry = async (id) => {
  const p = pendingEntry[id] || {};
  if (!p.status) return;
  // Read note, sub, and date/time directly from DOM
  const noteEl = document.getElementById('pending-note-' + id);
  const subEl  = document.getElementById('pending-sub-'  + id);
  const dateEl = document.getElementById('pending-date-' + id);
  const timeEl = document.getElementById('pending-time-' + id);
  const note = noteEl ? noteEl.value.trim() : (p.note || '');
  const sub  = subEl  ? subEl.value         : (p.subStatus || '');
  let dt = null;
  if (dateEl?.value) {
    const tVal = timeEl?.value || '00:00';
    dt = fmtDate(new Date(dateEl.value + 'T' + tVal + ':00'));
  }
  // Check if serial number is required
  if (requiresSerialNumber(p.status, sub)) {
    openSerialModal(id, p.status, sub, dt);
    delete pendingEntry[id];
    renderIssues();
    return;
  }
  await addStatusEntry(id, p.status, sub, note, dt);
  delete pendingEntry[id];
  renderIssues();
};
window.cancelAddEntry = (id) => { delete pendingEntry[id]; renderIssues(); };

// Edit state per entry
let editingStatusEntry = null;
let editStatusPhotos = [];
window.startEditEntry = (id, idx) => {
  const issue = issues.find(i => i.id === id);
  if (!issue) return;
  const history = getMutableStatusHistory(issue);
  // idx may point beyond the real history when clicking Edit on a synthetic current-status entry
  const entry = history[idx] || (idx >= history.length ? {
    status: currentStatusKey(issue),
    subStatus: issue.currentStatus?.subStatusKey || '',
    note: issue.currentStatus?.notePreview || '',
    dateTime: issue.currentStatus?.enteredDateTime || '',
    by: issue.currentStatus?.enteredBy?.name || ''
  } : null);
  if (!entry) return;
  
  editingStatusEntry = { issueId: id, entryIndex: idx };
  
  // Populate modal
  const statusSelect = document.getElementById('edit-status-select');
  statusSelect.innerHTML = getAlphabetizedStatusKeys().map(k => {
    const v = STATUSES[k];
    return `<option value="${k}" ${k === entry.status ? 'selected' : ''}>${v.icon} ${v.label}</option>`;
  }).join('');
  
  // Handle sub-status
  updateEditStatusSubOptions();
  statusSelect.onchange = updateEditStatusSubOptions;
  
  const subSelect = document.getElementById('edit-status-sub');
  if (subSelect && entry.subStatus) {
    subSelect.value = entry.subStatus;
  }
  
  document.getElementById('edit-status-note').value = entry.note || '';
  editStatusPhotos = Array.isArray(entry.photos) ? entry.photos.map(p => ({ ...p })) : [];
  renderPreviews(editStatusPhotos, 'edit-status-photo-previews');
  
  // Parse date/time
  if (entry.dateTime) {
    try {
      const d = new Date(entry.dateTime);
      const dt = toLocalDTInputs(d);
      document.getElementById('edit-status-date').value = dt.dateStr;
      document.getElementById('edit-status-time').value = dt.timeStr;
    } catch(e) {}
  }
  
  document.getElementById('edit-status-modal').classList.add('visible');
};

function updateEditStatusSubOptions() {
  const statusSelect = document.getElementById('edit-status-select');
  const selectedStatus = statusSelect.value;
  const subs = getStatusSubs(selectedStatus);
  const subWrap = document.getElementById('edit-status-sub-wrap');
  
  if (subs.length > 0) {
    subWrap.innerHTML = `
      <label>Sub-status (optional)</label>
      <select id="edit-status-sub" style="width:100%;background:var(--color-surface-raised, var(--bg3));border:1px solid var(--color-border, var(--border));border-radius:8px;padding:9px 11px;color:var(--color-text, var(--text));font-family:'Nunito',sans-serif;font-size:13px;margin-bottom:14px;">
        <option value="">None</option>
        ${subs.map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
    `;
  } else {
    subWrap.innerHTML = '';
  }
}

window.closeEditStatusModal = () => {
  document.getElementById('edit-status-modal').classList.remove('visible');
  editingStatusEntry = null;
  editStatusPhotos = [];
  renderPreviews(editStatusPhotos, 'edit-status-photo-previews');
};

window.saveEditStatusEntry = async () => {
  if (!editingStatusEntry) return;
  const { issueId, entryIndex } = editingStatusEntry;
  
  const status = document.getElementById('edit-status-select').value;
  const subSelect = document.getElementById('edit-status-sub');
  const subStatus = subSelect ? subSelect.value : '';
  const note = document.getElementById('edit-status-note').value;
  const dateStr = document.getElementById('edit-status-date').value;
  const timeStr = document.getElementById('edit-status-time').value;
  
  let dateTime = null;
  if (dateStr) {
    const tVal = timeStr || '00:00';
    dateTime = fmtDate(new Date(dateStr + 'T' + tVal + ':00'));
  }
  
  const newStatusPhotos = editStatusPhotos.filter(p => p.dataUrl);
  if (guardOfflinePhotos(newStatusPhotos, 'Status photos')) return;
  const existingStatusPhotos = editStatusPhotos.filter(p => !p.dataUrl);
  const uploadedStatusPhotos = newStatusPhotos.length ? await uploadIssuePhotosToStorage(issueId, newStatusPhotos) : [];
  const mergedStatusPhotos = [...existingStatusPhotos, ...uploadedStatusPhotos].map(p => ({
    name: p.name || '',
    storagePath: p.storagePath || '',
    dataUrl: p.dataUrl || p.downloadURL || '',
    contentType: p.contentType || 'image/jpeg',
    sizeBytes: Number(p.sizeBytes || p.size || 0),
    storageBucket: p.storageBucket || ''
  }));
  await updateStatusEntry(issueId, entryIndex, status, subStatus, note, dateTime, mergedStatusPhotos);
  closeEditStatusModal();
};

window.cancelEditEntry = (id, idx) => { /* no longer needed - using modal */ };
window.commitEditEntry = async (id, idx) => {
  const selEl = document.getElementById('tl-edit-sel-'+id+'-'+idx);
  const subEl = document.getElementById('tl-edit-sub-'+id+'-'+idx);
  const noteEl = document.getElementById('tl-edit-note-'+id+'-'+idx);
  const dateEl = document.getElementById('tl-edit-date-'+id+'-'+idx);
  const timeEl = document.getElementById('tl-edit-time-'+id+'-'+idx);
  if (!selEl) return;
  const status = selEl.value;
  const subStatus = subEl ? subEl.value : '';
  let dt = null;
  if (dateEl?.value) {
    const tVal = timeEl?.value || '00:00';
    dt = fmtDate(new Date(dateEl.value + 'T' + tVal + ':00'));
  }
  await updateStatusEntry(id, idx, status, subStatus, noteEl?.value||'', dt);
  delete editingEntry[id+'_'+idx];
  renderIssues();
};

// Legacy compat shims (kept so old Firestore docs still work)
window.setIssueStatus = async (id, status, sub) => { await addStatusEntry(id, status, sub||'', ''); };
window.clearIssueStatus = async id => { await addStatusEntry(id, 'open', '', 'Cleared status'); };
window.toggleSubStatus = async (id, status) => { await addStatusEntry(id, status, '', ''); };
window.setSubStatus = async (id, sub) => {
  const issue = issues.find(i=>i.id===id);
  if (!issue) return;
  const prev = currentStatus(issue);
  const history = getMutableStatusHistory(issue);
  if (history.length > 0) { history[history.length-1].subStatus = sub; }
  const last = history[history.length - 1] || { status: currentStatusKey(issue), subStatus: sub, note: '' };
  try {
    const issuePatch = {
      statusHistory: history,
      ...buildIssueV2Compat({
        machineCode: issue.machine || issue.machineCode || '',
        statusKey: last.status || 'open',
        subStatus: sub || '',
        statusDateTime: last.dateTime || fmtDate(new Date()),
        note: last.note || '',
        baseIssue: issue
      })
    };
    const batch = writeBatch(db);
    batch.update(plantDoc('issues',id), issuePatch);
    if ((prev?.subStatus || '') !== (sub || '')) {
      queueIssueEvent(batch, id, 'status_changed', {
        fromStatusKey: prev?.status || currentStatusKey(issue),
        fromSubStatusKey: prev?.subStatus || '',
        toStatusKey: last.status || prev?.status || 'open',
        toSubStatusKey: sub || '',
        note: last.note || ''
      });
    }
    await batch.commit();
    issuesById.set(id, { ...issue, ...issuePatch, id });
    rebuildIssuesArrayFromMap();
    refreshVisibleData();
    if (!syncState.online) setSyncStatus('syncing', 'Syncing - local changes pending');
    awardGamification('status_changed_valid', { issueId: id, dedupeSuffix: 'set-sub', tags: ['status:changed', `status:${last.status || 'open'}`, `sub:${sub || ''}`] }).catch(e => console.warn('gamification sub-status award failed', e));
  }
  catch(e) { setSyncStatus('err','Error updating: '+e.message); }
};

// ── WORKFLOW STATE ──
window.setWorkflowState = async (id, state) => {
  if (!WORKFLOW_STATES.includes(state)) return;
  const actor = currentActor();
  const issue = issues.find(i => i.id === id);
  if (issue && (issue.workflowState || 'called') === state) return;
  try {
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const nextIssue = applyIssuePatchLocally(issue, {
        workflowState: state,
        workflowStateHistory: { ...(issue?.workflowStateHistory || {}), [state]: { by: actor, at: new Date().toISOString() } },
        updatedAt: new Date().toISOString(),
        updatedBy: actor
      });
      nextIssue.id = id;
      await commitSqlIssueWrite(id, nextIssue);
      completeDemoGuideStep('workflow');
      return;
    }
    await updateDoc(plantDoc('issues', id), {
      workflowState: state,
      [`workflowStateHistory.${state}`]: { by: actor, at: serverTimestamp() },
      updatedAt: serverTimestamp(),
      updatedBy: actor
    });
    completeDemoGuideStep('workflow');
  } catch(e) {
    setSyncStatus('err', 'Error updating workflow: ' + e.message);
  }
};

async function setWorkflowStateForEntryLocator(issueId, state, locateEntry) {
  if (!WORKFLOW_STATES.includes(state)) return '';
  const actor = currentActor();
  const issue = issues.find(i => i.id === issueId);
  let updatedWorkflowId = '';
  let didWrite = false;
  try {
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const base = issue;
      if (!base) return '';
      const history = getMutableStatusHistory(base);
      let entryIndex = locateEntry(history, base);
      if (entryIndex < 0) return '';
      if (!history[entryIndex]) {
        const current = currentStatus(base);
        history[entryIndex] = {
          status: current?.status || currentStatusKey(base),
          subStatus: current?.subStatus || '',
          note: current?.note || '',
          dateTime: current?.dateTime || base?.dateTime || fmtDate(new Date()),
          by: current?.by || base?.userName || ''
        };
      }
      const entry = { ...history[entryIndex] };
      let workflowId = getEntryWorkflowId(entry);
      if (!workflowId) {
        workflowId = createWorkflowId(entry.status);
        entry.workflowId = workflowId;
        history[entryIndex] = entry;
      }
      const isCurrentEntry = isCurrentWorkflowEntry(entryIndex, history.length, entry, base);
      const patch = {
        statusHistory: history,
        workflowStateByEntry: { ...(base?.workflowStateByEntry || {}), [workflowId]: state },
        workflowStateByEntryHistory: {
          ...(base?.workflowStateByEntryHistory || {}),
          [workflowId]: { ...((base?.workflowStateByEntryHistory || {})[workflowId] || {}), [state]: { by: actor, at: new Date().toISOString() } }
        },
        updatedAt: new Date().toISOString(),
        updatedBy: actor
      };
      if (isCurrentEntry) {
        patch.workflowState = state;
        patch.workflowStateHistory = { ...(base?.workflowStateHistory || {}), [state]: { by: actor, at: new Date().toISOString() } };
        if (entry.status) {
          patch.workflowStateByStatus = { ...(base?.workflowStateByStatus || {}), [entry.status]: state };
          patch.workflowStateByStatusHistory = {
            ...(base?.workflowStateByStatusHistory || {}),
            [entry.status]: { ...((base?.workflowStateByStatusHistory || {})[entry.status] || {}), [state]: { by: actor, at: new Date().toISOString() } }
          };
        }
      }
      const nextIssue = applyIssuePatchLocally(base, patch);
      nextIssue.id = issueId;
      await commitSqlIssueWrite(issueId, nextIssue);
      updatedWorkflowId = workflowId;
      didWrite = true;
    } else {
    await runTransaction(db, async tx => {
      const ref = plantDoc('issues', issueId);
      const snap = await tx.get(ref);
      const base = snap.exists() ? { ...(issue || {}), ...snap.data() } : issue;
      if (!base) return;
      const history = getMutableStatusHistory(base);
      let entryIndex = locateEntry(history, base);
      if (entryIndex < 0) return;
      if (!history[entryIndex]) {
        const current = currentStatus(base);
        history[entryIndex] = {
          status: current?.status || currentStatusKey(base),
          subStatus: current?.subStatus || '',
          note: current?.note || '',
          dateTime: current?.dateTime || base?.dateTime || fmtDate(new Date()),
          by: current?.by || base?.userName || ''
        };
      }
      const entry = { ...history[entryIndex] };
      let workflowId = getEntryWorkflowId(entry);
      const needsWorkflowId = !workflowId;
      if (!workflowId) {
        workflowId = createWorkflowId(entry.status);
        entry.workflowId = workflowId;
        history[entryIndex] = entry;
      }
      const isCurrentEntry = isCurrentWorkflowEntry(entryIndex, history.length, entry, base);
      const current = getWorkflowStateForEntry(base, entry, isCurrentEntry);
      if (current === state && !needsWorkflowId) {
        updatedWorkflowId = workflowId;
        return;
      }
      const patch = {
        statusHistory: history,
        [`workflowStateByEntry.${workflowId}`]: state,
        [`workflowStateByEntryHistory.${workflowId}.${state}`]: { by: actor, at: serverTimestamp() },
        updatedAt: serverTimestamp(),
        updatedBy: actor
      };
      if (isCurrentEntry) {
        patch.workflowState = state;
        patch[`workflowStateHistory.${state}`] = { by: actor, at: serverTimestamp() };
        if (entry.status) {
          patch[`workflowStateByStatus.${entry.status}`] = state;
          patch[`workflowStateByStatusHistory.${entry.status}.${state}`] = { by: actor, at: serverTimestamp() };
        }
      }
      tx.update(ref, patch);
      updatedWorkflowId = workflowId;
      didWrite = true;
    });
    }
    if (didWrite && updatedWorkflowId) {
      await awardGamification('workflow_step_advance', { issueId, dedupeSuffix: `${updatedWorkflowId}:${state}`, tags: ['workflow:advance', `workflow:${state}`] });
      completeDemoGuideStep('workflow');
    }
  } catch (e) {
    setSyncStatus('err', 'Error updating workflow: ' + e.message);
  }
  return updatedWorkflowId;
}

window.setWorkflowStateForEntry = async (issueId, entryIndex, state) => {
  const idx = Number(entryIndex);
  if (!Number.isInteger(idx) || idx < 0) return '';
  return setWorkflowStateForEntryLocator(issueId, state, history => idx <= history.length ? idx : -1);
};

window.setWorkflowStateForWorkflowId = async (issueId, workflowId, state) => {
  const normalizedWorkflowId = normalizeWorkflowId(workflowId);
  if (!normalizedWorkflowId) return '';
  return setWorkflowStateForEntryLocator(issueId, state, history =>
    history.findIndex(entry => getEntryWorkflowId(entry) === normalizedWorkflowId)
  );
};

window.setWorkflowStateForStatus = async (issueId, statusKey, state) => {
  if (!WORKFLOW_STATES.includes(state)) return;
  const actor = currentActor();
  const issue = issues.find(i => i.id === issueId);
  const primaryKey = issue ? currentStatusKey(issue) : null;
  const current = (statusKey === primaryKey)
    ? (issue?.workflowState || null)
    : (issue?.workflowStateByStatus?.[statusKey] || null);
  if (current === state) return;
  try {
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const nextIssue = applyIssuePatchLocally(issue, {
        workflowStateByStatus: { ...(issue?.workflowStateByStatus || {}), [statusKey]: state },
        workflowStateByStatusHistory: {
          ...(issue?.workflowStateByStatusHistory || {}),
          [statusKey]: { ...((issue?.workflowStateByStatusHistory || {})[statusKey] || {}), [state]: { by: actor, at: new Date().toISOString() } }
        },
        ...(statusKey === primaryKey ? {
          workflowState: state,
          workflowStateHistory: { ...(issue?.workflowStateHistory || {}), [state]: { by: actor, at: new Date().toISOString() } }
        } : {}),
        updatedAt: new Date().toISOString(),
        updatedBy: actor
      });
      nextIssue.id = issueId;
      await commitSqlIssueWrite(issueId, nextIssue);
      await awardGamification('workflow_step_advance', { issueId, dedupeSuffix: `${statusKey}:${state}`, tags: ['workflow:advance', `workflow:${state}`] });
      completeDemoGuideStep('workflow');
      return;
    }
    const patch = {
      [`workflowStateByStatus.${statusKey}`]: state,
      [`workflowStateByStatusHistory.${statusKey}.${state}`]: { by: actor, at: serverTimestamp() },
      updatedAt: serverTimestamp(),
      updatedBy: actor
    };
    if (statusKey === primaryKey) {
      patch.workflowState = state;
      patch[`workflowStateHistory.${state}`] = { by: actor, at: serverTimestamp() };
    }
    await updateDoc(plantDoc('issues', issueId), patch);
    await awardGamification('workflow_step_advance', { issueId, dedupeSuffix: `${statusKey}:${state}`, tags: ['workflow:advance', `workflow:${state}`] });
    completeDemoGuideStep('workflow');
  } catch(e) {
    setSyncStatus('err', 'Error updating workflow: ' + e.message);
  }
};

function formatWorkflowActor(actor) {
  const full = String(actor?.name || '').trim();
  if (!full) return '';
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return `by ${full}`;
  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() || '';
  return `by ${first} ${lastInitial}.`;
}

window.cycleWorkflowStateForStatus = async (issueId, statusKey) => {
  const issue = issues.find(i => i.id === issueId);
  if (!issue) return;
  const primaryKey = currentStatusKey(issue);
  const current = statusKey === primaryKey
    ? (issue.workflowState || null)
    : (issue.workflowStateByStatus?.[statusKey] || null);
  const currentIdx = WORKFLOW_STATES.indexOf(current);
  const next = currentIdx < 0 ? 'called' : WORKFLOW_STATES[(currentIdx + 1) % WORKFLOW_STATES.length];
  await setWorkflowStateForStatus(issueId, statusKey, next);
};

window.cycleWorkflowStateForEntry = async (issueId, entryIndex) => {
  const issue = issues.find(i => i.id === issueId);
  if (!issue) return;
  const history = getMutableStatusHistory(issue);
  const idx = Number(entryIndex);
  const entry = history[idx];
  if (!entry) return;
  const isCurrentEntry = isCurrentWorkflowEntry(idx, history.length, entry, issue);
  const matchingStatusCount = history.filter(item => String(item?.status || '') === String(entry.status || '')).length;
  const current = !getEntryWorkflowId(entry) && !isCurrentEntry && matchingStatusCount > 1
    ? null
    : getWorkflowStateForEntry(issue, entry, isCurrentEntry);
  const currentIdx = WORKFLOW_STATES.indexOf(current);
  const next = currentIdx < 0 ? 'called' : WORKFLOW_STATES[(currentIdx + 1) % WORKFLOW_STATES.length];
  await setWorkflowStateForEntry(issueId, idx, next);
};

window.cycleWorkflowState = async (id) => {
  const issue = issues.find(i => i.id === id);
  if (!issue) return;
  const currentState = issue.workflowState || 'called';
  const currentIndex = WORKFLOW_STATES.indexOf(currentState);
  const nextIndex = (currentIndex + 1) % WORKFLOW_STATES.length;
  const nextState = WORKFLOW_STATES[nextIndex];
  
  try {
    await updateDoc(plantDoc('issues', id), { workflowState: nextState });
    await awardGamification('workflow_step_advance', { issueId: id, dedupeSuffix: `${currentState}->${nextState}`, tags: ['workflow:advance', `workflow:${nextState}`] });
    completeDemoGuideStep('workflow');
  } catch(e) {
    setSyncStatus('err', 'Error updating workflow: ' + e.message);
  }
};

// Dismiss the prompt arrow then set the workflow state
window.handleWfStepClick = (evt, issueId, entryIndex, state) => {
  evt.stopPropagation();
  const arrow = document.getElementById(`wf-arrow-${issueId}`);
  if (arrow) {
    arrow.classList.add('wf-arrow-dismissed');
    setTimeout(() => arrow.remove(), 380);
  }
  setWorkflowStateForEntry(issueId, Number(entryIndex), state);
};

// ── PRIORITY TOGGLE ──
window.togglePriority = async (id) => {
  const issue = issues.find(i => i.id === id);
  if (!issue) return;
  try {
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const nextIssue = applyIssuePatchLocally(issue, { highPriority: !issue.highPriority, priority: !issue.highPriority ? 'critical' : issue.priority });
      nextIssue.id = id;
      await commitSqlIssueWrite(id, nextIssue);
      return;
    }
    await updateDoc(plantDoc('issues', id), { highPriority: !issue.highPriority });
  } catch(e) {
    setSyncStatus('err', 'Error updating priority: ' + e.message);
  }
};

async function _issueShareFiles(issue, maxFiles = 3) {
  const photos = Array.isArray(issue?.photos) ? issue.photos.filter(Boolean).slice(0, maxFiles) : [];
  const files = [];
  for (let idx = 0; idx < photos.length; idx++) {
    const photo = photos[idx];
    const source = photo?.dataUrl || photo?.url || '';
    if (!source) continue;
    try {
      const res = await fetch(source);
      const blob = await res.blob();
      const extFromType = blob.type === 'image/png' ? 'png' : 'jpg';
      const fileName = photo?.name || `issue-photo-${idx + 1}.${extFromType}`;
      files.push(new File([blob], fileName, { type: blob.type || 'image/jpeg' }));
    } catch (_) {
      // Ignore individual photo conversion failures and continue with remaining images.
    }
  }
  return files;
}

async function _tryNativeIssueShare(issue, messageWithLink) {
  if (!navigator?.share) return false;
  const files = await _issueShareFiles(issue);
  const title = `Issue ${issue?.machine || issue?.id || ''}`.trim();
  const payload = { title, text: messageWithLink };
  if (files.length && navigator?.canShare?.({ files })) payload.files = files;
  try {
    await navigator.share(payload);
    return true;
  } catch (err) {
    // User cancellation isn't an app error; just continue into text-app fallback.
    const aborted = err?.name === 'AbortError';
    if (!aborted) console.warn('Native share failed, falling back to sms: URI.', err);
    return false;
  }
}

async function _issueMmsAttachments(issue, maxFiles = 3) {
  let photoList = Array.isArray(issue?.photos) ? issue.photos.filter(Boolean) : [];
  if (!photoList.length && Number(issue?.photoCount || 0) > 0 && issue?.id) {
    try {
      const hydrated = await fetchAttachmentPhotos(issue.id);
      if (Array.isArray(hydrated) && hydrated.length) {
        photoList = hydrated.filter(Boolean);
        issue.photos = photoList;
      }
    } catch (_) {
      // Keep going; we'll send text-only if attachments cannot be hydrated.
    }
  }
  const photos = photoList.slice(0, maxFiles);
  const attachments = [];
  for (let idx = 0; idx < photos.length; idx++) {
    const photo = photos[idx];
    const source = photo?.dataUrl || photo?.url || '';
    if (!source) continue;
    try {
      if (String(source).startsWith('data:')) {
      attachments.push({
        name: photo?.name || `issue-photo-${idx + 1}.jpg`,
        type: String(source).slice(5, String(source).indexOf(';')) || 'image/jpeg',
          dataUrl: source,
          url: photo?.url || ''
        });
        continue;
      }
      const res = await fetch(source);
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      if (!dataUrl) continue;
      attachments.push({
        name: photo?.name || `issue-photo-${idx + 1}.${blob.type === 'image/png' ? 'png' : 'jpg'}`,
        type: blob.type || 'image/jpeg',
        dataUrl,
        url: source
      });
    } catch (_) {
      // Skip photos that fail to fetch/convert so send can still proceed.
    }
  }
  return attachments;
}

const SMS_COMPOSER_STATE = {
  issueId: null,
  issue: null,
  messageWithLink: '',
  recipientOptions: [],
  selectedRecipientPhones: new Set()
};

function _smsSanitizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function _smsNormalizeE164(value) {
  const cleaned = _smsSanitizePhone(value);
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) return cleaned;
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (!digitsOnly) return '';
  if (digitsOnly.length === 10) return `+1${digitsOnly}`;
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) return `+${digitsOnly}`;
  return `+${digitsOnly}`;
}

function _smsRecipientKey(value) {
  return _smsNormalizeE164(value) || _smsSanitizePhone(value);
}

function _smsExtractPhones(member) {
  const candidates = [
    member?.phone,
    member?.phoneNumber,
    member?.mobile,
    member?.mobilePhone,
    member?.smsPhone,
    member?.profile?.phone,
    member?.profile?.phoneNumber
  ];
  return candidates
    .map(_smsSanitizePhone)
    .filter(Boolean);
}

async function _smsRecipientOptions() {
  if (!currentPlantId) return [];
  try {
    const membersSnap = await getDocs(collection(db, 'plants', currentPlantId, 'members'));
    return membersSnap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(m => m.isActive !== false)
      .map(m => {
        const phones = _smsExtractPhones(m);
        return {
          uid: m.uid || '',
          name: m.displayName || m.name || m.email || 'Unknown',
          phone: phones[0] || ''
        };
      })
      .filter(m => m.phone)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  } catch (err) {
    console.warn('Unable to load text recipients from members.', err);
    return [];
  }
}

function _renderSmsRecipientPicker() {
  const wrap = document.getElementById('sms-recipient-picker');
  if (!wrap) return;
  if (!SMS_COMPOSER_STATE.recipientOptions.length) {
    wrap.innerHTML = '<div class="sms-recipient-empty">No saved member phone numbers found. Enter numbers manually below.</div>';
    return;
  }
  wrap.innerHTML = SMS_COMPOSER_STATE.recipientOptions.map((r, idx) => `
    <label class="sms-recipient-row">
      <input type="checkbox" data-sms-recipient="${idx}" ${SMS_COMPOSER_STATE.selectedRecipientPhones.has(_smsRecipientKey(r.phone)) ? 'checked' : ''}>
      <span>${esc(r.name)}</span>
      <span class="sms-recipient-phone">${esc(r.phone)}</span>
    </label>
  `).join('');
  wrap.querySelectorAll('[data-sms-recipient]').forEach(el => {
    el.addEventListener('change', () => {
      const idx = Number(el.getAttribute('data-sms-recipient'));
      const phone = SMS_COMPOSER_STATE.recipientOptions[idx]?.phone || '';
      const key = _smsRecipientKey(phone);
      if (!key) return;
      if (el.checked) SMS_COMPOSER_STATE.selectedRecipientPhones.add(key);
      else SMS_COMPOSER_STATE.selectedRecipientPhones.delete(key);
    });
  });
}

window.addManualSmsRecipients = () => {
  const manualInput = document.getElementById('sms-manual-phone');
  const raw = String(manualInput?.value || '');
  const numbers = raw
    .split(/[,\n;]/)
    .map(_smsNormalizeE164)
    .filter(Boolean);

  if (!numbers.length) {
    alert('Enter at least one valid phone number to add.');
    return;
  }

  const existingByKey = new Set(SMS_COMPOSER_STATE.recipientOptions.map(r => _smsRecipientKey(r.phone)).filter(Boolean));
  let addedCount = 0;
  numbers.forEach((phone, idx) => {
    const key = _smsRecipientKey(phone);
    if (!key) return;
    SMS_COMPOSER_STATE.selectedRecipientPhones.add(key);
    if (existingByKey.has(key)) return;
    SMS_COMPOSER_STATE.recipientOptions.push({
      uid: `manual-${Date.now()}-${idx}`,
      name: 'Manual Number',
      phone
    });
    existingByKey.add(key);
    addedCount++;
  });

  _renderSmsRecipientPicker();
  if (manualInput) manualInput.value = '';
  if (addedCount === 0) alert('Those number(s) are already in the recipient picker and were selected.');
};

async function _performSmsFallback(messageWithLink, recipientPhones = []) {
  const to = Array.isArray(recipientPhones) ? recipientPhones.filter(Boolean).join(',') : '';
  // `sms:` intentionally opens the platform texting app; on many devices/carriers this can route over RCS automatically.
  const smsUri = to
    ? `sms:${encodeURIComponent(to)}?&body=${encodeURIComponent(messageWithLink)}`
    : `sms:?&body=${encodeURIComponent(messageWithLink)}`;
  const isMobile = /android|iphone|ipad|ipod|windows phone|mobile/i.test(navigator.userAgent || '');
  if (!isMobile) {
    try {
      await navigator.clipboard?.writeText(messageWithLink);
      alert('Texting apps are usually unavailable on desktop. Message copied to clipboard.');
    } catch (_) {
      prompt('Copy this message for texting:', messageWithLink);
    }
    return;
  }

  try {
    window.location.href = smsUri;
  } catch (_) {
    try {
      await navigator.clipboard?.writeText(messageWithLink);
      alert('Could not open your texting app. Message copied to clipboard.');
    } catch (__){
      prompt('Could not open texting app. Copy this message:', messageWithLink);
    }
  }
}

async function _submitViaBackendOrFallback() {
  const includePhotos = Boolean(document.getElementById('sms-include-photos')?.checked);
  const manualNumbers = String(document.getElementById('sms-manual-phone')?.value || '')
    .split(/[,\n;]/)
    .map(_smsNormalizeE164)
    .filter(Boolean);
  const selectedNumbers = Array.from(document.querySelectorAll('[data-sms-recipient]:checked'))
    .map(el => SMS_COMPOSER_STATE.recipientOptions[Number(el.getAttribute('data-sms-recipient'))]?.phone || '')
    .map(_smsNormalizeE164)
    .filter(Boolean);
  const recipientPhones = Array.from(new Set([...selectedNumbers, ...manualNumbers]));
  const tryNativeShare = async () => {
    if (!includePhotos) return false;
    return _tryNativeIssueShare(SMS_COMPOSER_STATE.issue, SMS_COMPOSER_STATE.messageWithLink);
  };

  if (!recipientPhones.length) {
    const shared = await tryNativeShare();
    if (shared) return;
    await _performSmsFallback(SMS_COMPOSER_STATE.messageWithLink);
    return;
  }

  const backendSend = typeof window.sendIssueMms === 'function' ? window.sendIssueMms : null;
  if (!backendSend) {
    const shared = await tryNativeShare();
    if (shared) return;
    if (includePhotos) {
      alert('Photo attachments require native share support or an MMS backend. Falling back to text-only compose.');
    }
    await _performSmsFallback(SMS_COMPOSER_STATE.messageWithLink, recipientPhones);
    return;
  }

  try {
    const attachments = includePhotos ? await _issueMmsAttachments(SMS_COMPOSER_STATE.issue) : [];
    if (includePhotos && !attachments.length) {
      console.warn('Include photos was selected, but no issue photos were available to attach.');
    }
    const attachmentUrls = attachments.map(a => a.url || a.dataUrl).filter(Boolean);
    const payload = {
      issueId: SMS_COMPOSER_STATE.issueId,
      recipients: recipientPhones,
      recipientPhones,
      phoneNumbers: recipientPhones,
      phones: recipientPhones,
      to: recipientPhones,
      toNumbers: recipientPhones,
      includePhotos,
      body: SMS_COMPOSER_STATE.messageWithLink,
      message: SMS_COMPOSER_STATE.messageWithLink,
      text: SMS_COMPOSER_STATE.messageWithLink,
      issue: SMS_COMPOSER_STATE.issue,
      attachments,
      images: attachments,
      photos: attachments,
      media: attachmentUrls,
      mediaUrls: attachmentUrls,
      imageUrls: attachments.map(a => a.url).filter(Boolean)
    };
    const result = await backendSend(payload);
    const sentCount = Number(result?.sentCount || recipientPhones.length || 0);
    alert(`Sent via ${includePhotos ? 'MMS' : 'text (SMS/RCS based on device + carrier)'} to ${sentCount} recipient${sentCount === 1 ? '' : 's'}.`);
  } catch (err) {
    console.warn('sendIssueMms failed; falling back to sms: URI.', err);
    const shared = await tryNativeShare();
    if (shared) return;
    if (includePhotos) {
      alert('Could not send MMS attachments from backend. Falling back to text-only compose.');
    }
    await _performSmsFallback(SMS_COMPOSER_STATE.messageWithLink, recipientPhones);
  }
}

window.closeSmsComposer = async (fallback = false) => {
  document.getElementById('sms-compose-modal')?.classList.remove('visible');
  if (fallback && SMS_COMPOSER_STATE.messageWithLink) {
    await _performSmsFallback(SMS_COMPOSER_STATE.messageWithLink);
  }
};

async function openIssueSmsComposer(issue) {
  if (!issue) return;
  const issueLink = (() => {
    try {
      return window.location?.href ? `${window.location.origin}${window.location.pathname}?issue=${encodeURIComponent(issue.id)}` : '';
    } catch (_) {
      return '';
    }
  })();
  const messageWithLink = formatIssueSmsBody(issue, issueLink);
  SMS_COMPOSER_STATE.issueId = issue.id;
  SMS_COMPOSER_STATE.issue = issue;
  SMS_COMPOSER_STATE.messageWithLink = messageWithLink;
  SMS_COMPOSER_STATE.recipientOptions = await _smsRecipientOptions();
  SMS_COMPOSER_STATE.selectedRecipientPhones = new Set();
  const subtitle = document.getElementById('sms-compose-subtitle');
  if (subtitle) subtitle.textContent = `${issue.machine || issue.id} • Choose recipients and review before sending.`;
  const manual = document.getElementById('sms-manual-phone');
  if (manual) manual.value = '';
  const includePhotos = document.getElementById('sms-include-photos');
  if (includePhotos) includePhotos.checked = true;
  const preview = document.getElementById('sms-preview-text');
  if (preview) preview.value = messageWithLink;
  _renderSmsRecipientPicker();
  document.getElementById('sms-compose-modal')?.classList.add('visible');
}

window.submitSmsComposer = async () => {
  const sendBtn = document.getElementById('sms-send-btn');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
  }
  try {
    await _submitViaBackendOrFallback();
    await closeSmsComposer(false);
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
    }
  }
};

window.sendIssueViaSms = async (id, evt) => {
  evt?.stopPropagation?.();
  evt?.preventDefault?.();

  const issue = issues.find(i => i.id === id);
  if (!issue) {
    setSyncStatus('err', 'Unable to send text: issue not found.');
    return;
  }
  await openIssueSmsComposer(issue);
};

// ── DELETE ──
window.deleteIssue = async id => {
  if (DEMO_MODE) {
    setSyncStatus('err', 'Demo sandbox does not allow deleting shared issues.');
    return;
  }
  if (!currentUserPermissions.canEditIssue) return;
  if (!confirm('Delete this issue permanently?')) return;
  try {
    if (shouldUseSqlStagingReads(currentPlantId)) {
      await dataApi.deleteIssue(currentPlantId, id);
      clearIssueReminder(id);
      issuesById.delete(id);
      issueEventHistoryCache.delete(id);
      issueDetailsHydrationInFlight.delete(id);
      rebuildIssuesArrayFromMap();
      refreshVisibleData();
      return;
    }
    const batch = writeBatch(db);
    batch.delete(plantDoc('issues', id));
    const alertsSnap = await getDocs(query(collection(db, 'plants', currentPlantId, 'roleFeedAlerts'), where('issueId', '==', id)));
    alertsSnap.docs.forEach(d => batch.delete(doc(db, 'plants', currentPlantId, 'roleFeedAlerts', d.id)));
    await batch.commit();
    clearIssueReminder(id);
    issuesById.delete(id);
    issueEventHistoryCache.delete(id);
    issueDetailsHydrationInFlight.delete(id);
    rebuildIssuesArrayFromMap();
    refreshVisibleData();
  }
  catch(e) { setSyncStatus('err','Error deleting: '+e.message); }
};

// ── STAT FILTER TOGGLE ──
window.toggleStatFilter = s => {
  const sf=document.getElementById('status-filter');
  sf.value = sf.value===s ? '' : s;
  updateStatPillStyles(); renderIssues(); updateFilterBadge();
  completeDemoGuideStep('filters');
};

function updateStatPillStyles() {
  const sf=document.getElementById('status-filter').value;
  Object.entries(STATUSES).forEach(([key, st])=>{
    const pill=document.getElementById('pill-'+key);
    if (!pill) return;
    const col = st.swipeColor || st.cssColor || st.color;
    if (sf === key) {
      pill.style.borderColor = col;
      pill.style.background = alphaColor(col, 0.12);
      pill.style.color = col;
      pill.style.animation = 'statPillPulse 1.5s ease-in-out infinite';
    } else {
      pill.style.borderColor = '';
      pill.style.background = '';
      pill.style.color = '';
      pill.style.animation = '';
    }
  });
}

// ── TAP-SAFE TOUCH HELPER ──
// Fires only if the finger didn't move more than TAP_SLOP px between
// touchstart and touchend. Covers scroll (vertical) and swipe (horizontal).
// click is suppressed entirely — touch is the only activation path.
const TAP_SLOP = 10;

function addTapListener(el, fn) {
  // Simplified: just use click events, no touch interference
  el.addEventListener('click', fn);
}

// ── SORT ──
// Applies primary sort order to `arr` in-place. Used by both renderIssues and openExportModal
// so the PDF export always matches what the user sees on screen.
function applySortOrder(arr, sort) {
  if (sort === 'newest') {
    arr.sort((a, b) => b.timestamp - a.timestamp);
  } else if (sort === 'oldest') {
    arr.sort((a, b) => a.timestamp - b.timestamp);
  } else if (sort === 'machine') {
    arr.sort((a, b) => a.machine.localeCompare(b.machine));
  } else if (sort === 'status') {
    const order = window._STATUS_ORDER || Object.keys(STATUSES);
    arr.sort((a, b) => order.indexOf(currentStatusKey(a)) - order.indexOf(currentStatusKey(b)));
  } else if (sort === 'longest-open') {
    arr.sort((a, b) => {
      const aOpen = currentStatusKey(a) !== 'resolved';
      const bOpen = currentStatusKey(b) !== 'resolved';
      if (aOpen && !bOpen) return -1;
      if (!aOpen && bOpen) return 1;
      return (a.timestamp || 0) - (b.timestamp || 0); // oldest unresolved first
    });
  } else if (sort === 'submitter') {
    arr.sort((a, b) => (a.userName || '').localeCompare(b.userName || ''));
  } else if (sort === 'most-updates') {
    // For v2 issues the canonical history is in eventHistory (from events subcollection);
    // fall back to statusHistory for legacy v1 issues.
    const countUpdates = i => (i.eventHistory?.length || i.statusHistory?.length || 0);
    arr.sort((a, b) => countUpdates(b) - countUpdates(a));
  } else if (sort === 'recently-updated') {
    // Prefer the Firestore updatedAt timestamp — it is written on every status change and
    // is far more reliable than parsing free-form dateTime strings from history entries.
    const lastUpdateTime = i => {
      if (i.updatedAt?.toMillis) return i.updatedAt.toMillis();
      // Fallback: scan eventHistory then statusHistory for the most recent dateTime string.
      const h = i.eventHistory?.length ? i.eventHistory : i.statusHistory;
      if (!h?.length) return i.timestamp || 0;
      const last = h[h.length - 1];
      if (!last.dateTime) return i.timestamp || 0;
      try {
        const d = new Date(last.dateTime);
        return isNaN(d.getTime()) ? (i.timestamp || 0) : d.getTime();
      } catch (e) { return i.timestamp || 0; }
    };
    arr.sort((a, b) => lastUpdateTime(b) - lastUpdateTime(a));
  }
}

// ── RENDER ──
function renderIssues() {
  const search=document.getElementById('search-input').value.toLowerCase();
  const mf=document.getElementById('machine-filter').value;
  const sf=document.getElementById('status-filter').value;
  const sort=currentSort;
  const openSwipeSnapshot = captureOpenSwipeSnapshot();

  // Build set of machines in active rows (for Active Rows filter)
  const activeRowMachines = new Set();
  if (issueRowScope === 'active' && activeRows.size > 0) {
    activeRows.forEach(rowName => {
      (PRESSES[rowName]||[]).forEach(m => activeRowMachines.add(m));
    });
  }

  let filtered=issues.filter(i=>{
    if (issueScope==='mine' && i.userId!==currentUser?.uid) return false;
    if (issueShiftFilter !== 'all' && i.shift !== issueShiftFilter) return false;
    if (!periodFilter(i)) return false;
    if (issueRowScope === 'active' && activeRows.size > 0 && !activeRowMachines.has(i.machine)) return false;
    if (mf && i.machine!==mf) return false;
    if (sf && !issueHasActiveStatus(i, sf)) return false;
    if (search) {
      const machineText = String(i.machine || '').toLowerCase();
      const noteText = String(i.note || '').toLowerCase();
      const resolveText = String(i.resolveNote || '').toLowerCase();
      const userText = String(i.userName || '').toLowerCase();
      if (!machineText.includes(search) && !noteText.includes(search) && !resolveText.includes(search) && !userText.includes(search)) return false;
    }
    return true;
  });

  applySortOrder(filtered, sort);
  // Always float resolved issues to the bottom (unless sorting by status)
  if (sort !== 'status' && sort !== 'longest-open') {
    const isResolved = i => currentStatusKey(i) === 'resolved';
    filtered.sort((a,b) => isResolved(a) - isResolved(b));
  }
  // Float high-priority (non-resolved) issues to the very top
  {
    const isResolved = i => currentStatusKey(i) === 'resolved';
    filtered.sort((a,b) => {
      const aR = isResolved(a), bR = isResolved(b);
      if (aR || bR) return 0; // don't disturb resolved ordering
      return (b.highPriority ? 1 : 0) - (a.highPriority ? 1 : 0);
    });
  }

  if (_roleAlertFocusIssueId) {
    const focusIdx = filtered.findIndex(i => i.id === _roleAlertFocusIssueId);
    if (focusIdx > 0) {
      const [focusIssue] = filtered.splice(focusIdx, 1);
      filtered.unshift(focusIssue);
    } else if (focusIdx === -1) {
      const focusIssue = issues.find(i => i.id === _roleAlertFocusIssueId);
      if (focusIssue) filtered.unshift({ ...focusIssue, __alertFocus: true });
    }
  }

  // Reset display limit when filter/sort parameters change
  const filterKey = `${issueScope}|${issuePeriod}|${document.getElementById('date-filter')?.value}|${mf}|${sf}|${search}|${sort}|${issueRowScope}|${issueShiftFilter}`;
  if (filterKey !== renderIssues._lastFilterKey) {
    issueDisplayLimit = PAGE_SIZE;
    renderIssues._lastFilterKey = filterKey;
  }

  const totalFiltered = filtered.length;
  const visible = filtered.slice(0, issueDisplayLimit);

  const list=document.getElementById('issues-list');
  document.getElementById('issue-count').textContent = issueDisplayLimit < totalFiltered
    ? `${issueDisplayLimit} of ${totalFiltered} issues`
    : `${totalFiltered} issue${totalFiltered!==1?'s':''}`;

  list.classList.remove('masonic-enabled');
  list.style.height = '';

  if (filtered.length===0) {
    const _sigmaHtml = MASCOTS.processengineer?.svg(110, 110) || '<div class="empty-state-icon">📋</div>';
    list.innerHTML=`<div class="empty-state"><div class="mascot-empty-wrap">${_sigmaHtml}</div><div class="empty-state-text">No issues match your filters.</div></div>`;
    return;
  }

  const expanded=new Set();
  document.querySelectorAll('.issue-body.visible').forEach(el=>expanded.add(el.id.replace('body-','')));
  openSwipeRow = null;
  list.innerHTML='';

  const STATUS_CONFIG = Object.fromEntries(Object.entries(STATUSES).map(([k,v])=>[k,{label:v.label,cls:v.cls,icon:v.icon,color:v.cssColor,subs:v.subs}]));
  // Fallback for any orphaned status keys not in current STATUSES config
  const STATUS_CONFIG_SAFE = new Proxy(STATUS_CONFIG, {
    get(target, key) {
      return target[key] || { label: key || 'Unknown', cls: 'status-open', icon: '●', color: '#8b949e', subs: [] };
    }
  });

  // Build options html for status select
  const statusOptions = getAlphabetizedStatusKeys().map(k => {
    const v = STATUS_CONFIG[k];
    return `<option value="${k}">${v.icon} ${v.label}</option>`;
  }).join('');
  function subOptions(statusKey, selectedSub) {
    const cfg = STATUS_CONFIG[statusKey];
    if (!cfg||!cfg.subs.length) return '';
    return '<select class="tl-mini-select" style="margin-top:4px;" onchange="this.dataset.sub=this.value" data-sub="'+esc(selectedSub||'')+'">'
      +'<option value="">Sub-status (optional)</option>'
      +cfg.subs.map(s=>`<option value="${s}"${s===selectedSub?' selected':''}>${s}</option>`).join('')
      +'</select>';
  }

  visible.forEach(issue => {
    const wasOpen=expanded.has(issue.id);
    const isMyIssue=issue.userId===currentUser?.uid;
    const isAlertFocus = !!issue.__alertFocus;
    const isLocalIssue = !!(issue.__localPending || issue.__localSyncStatus);
    const reminderState = getIssueReminderState(issue.id);
    const isTimerOverdue = !!reminderState?.isOverdue;
    const row=document.createElement('div'); row.className='issue-row'; row.dataset.id = issue.id;
    if (isAlertFocus) row.classList.add('alert-focus-issue');
    const card=document.createElement('div');
    card.className='issue-card'+(issueIsResolvedV2(issue)?' resolved':'')+(issue.highPriority?' high-priority':'')+(isTimerOverdue?' timer-overdue':'')+(isAlertFocus?' alert-focus-card':'')+(isLocalIssue?' local-pending':'')+(issue.__localSyncStatus === 'failed'?' sync-failed':'');

    const _photoList = (issue.photos || []).map(p => ({
      url: p.dataUrl || p.downloadURL || p.url || '',
      takenAt: p.takenAt || p.timestamp || '',
      uploadedAt: p.uploadedAt || p.createdAt || '',
      name: p.name || ''
    })).filter(p => p.url);
    if (_photoList.length) window._issuePhotos = window._issuePhotos || {};
    if (_photoList.length) window._issuePhotos[issue.id] = _photoList;
    const photosHtml=_photoList.length
      ? `<div class="issue-photos">${_photoList.map((photo,i)=>`<img class="issue-photo-thumb" src="${photo.url}" loading="lazy" onclick="openLightbox(${i},'${issue.id}')">`).join('')}</div>` : '';

    // Authoritative current status from issue.currentStatus (v2) or lifecycle fallback
    const currentKey = currentStatusKey(issue);
    const currentSubKey = issue.currentStatus?.subStatusKey || '';
    // History for timeline display
    const history = issue.statusHistory && issue.statusHistory.length > 0
      ? issue.statusHistory
      : issue.eventHistory && issue.eventHistory.length > 0
      ? issue.eventHistory
      : [{
          status: currentKey,
          subStatus: currentSubKey,
          note: issue.currentStatus?.notePreview || '',
          dateTime: issue.currentStatus?.enteredDateTime || issue.dateTime || '',
          by: issue.currentStatus?.enteredBy?.name || issue.userName || ''
        }];

    // If the history's last entry doesn't reflect the actual current status
    // (e.g. resolved via events subcollection without writing to statusHistory),
    // append a synthetic display-only entry so the timeline shows the correct state.
    const needsSynthetic = (history[history.length - 1]?.status || 'open') !== currentKey;
    const displayHistory = needsSynthetic
      ? [...history, {
          status: currentKey,
          subStatus: currentSubKey,
          note: issue.currentStatus?.notePreview || '',
          dateTime: issue.currentStatus?.enteredDateTime || '',
          by: issue.currentStatus?.enteredBy?.name || '',
          _synthetic: true
        }]
      : history;
    const workflowStatusCounts = displayHistory.reduce((counts, entry) => {
      const key = String(entry?.status || '');
      if (key) counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    const workflowDisplayState = (entry, isCurrent) => {
      const statusKey = String(entry?.status || '');
      if (!getEntryWorkflowId(entry) && !isCurrent && workflowStatusCounts[statusKey] > 1) return null;
      return getWorkflowStateForEntry(issue, entry, isCurrent);
    };
    const workflowDisplayActor = (entry, state, isCurrent) => {
      const statusKey = String(entry?.status || '');
      if (!getEntryWorkflowId(entry) && !isCurrent && workflowStatusCounts[statusKey] > 1) return null;
      return getWorkflowActorForEntry(issue, entry, state, isCurrent);
    };

    const lastEntry = displayHistory[displayHistory.length-1];
    const scfg = STATUS_CONFIG_SAFE[currentKey];
    const sc = { ...scfg, label: scfg.label + (currentSubKey ? ' › '+currentSubKey : '') };

    const editedNote = issue.editedAt ? `<div style="font-size:10px;color:var(--color-text-subtle, var(--text3));margin-top:3px;font-family:'Share Tech Mono',monospace">edited ${issue.editedAt}${issue.editedBy?' by '+esc(issue.editedBy):''}</div>` : '';

    // Helper to parse a formatted date string back into input values
    function parseDTForInputs(dtStr) {
      if (!dtStr) { const n=new Date(); return toLocalDTInputs(n); }
      try { const d=new Date(dtStr); if(isNaN(d.getTime())) { const n=new Date(); return toLocalDTInputs(n); } return toLocalDTInputs(d); }
      catch(e) { const n=new Date(); return toLocalDTInputs(n); }
    }

    // Workflow state configuration
    const currentEntryIndex = displayHistory.length - 1;
    const currentEntry = displayHistory[currentEntryIndex] || {};
    const workflowState = workflowDisplayState(currentEntry, true);
    const hasNoWorkflowState = !workflowState;
    const workflowConfig = {
      called:      { icon: '🔔', label: 'Called',      cssState: 'called' },
      accepted:    { icon: '👋', label: 'Accepted',    cssState: 'accepted' },
      'in-progress': { icon: '🔧', label: 'In Progress', cssState: 'in-progress' },
      finished:    { icon: '✓',  label: 'Finished',    cssState: 'finished' }
    };
    const wfOrder = ['called', 'accepted', 'in-progress', 'finished'];
    const wfCurrentIdx = workflowState ? wfOrder.indexOf(workflowState) : -1;
    const isCompleted = (state) => workflowState && wfOrder.indexOf(state) < wfCurrentIdx;
    const wfByStatus = issue.workflowStateByStatus || {};

    // Build timeline entries HTML — reversed so newest is on top
    const timelineEntries = [...displayHistory].reverse().map((entry, displayIdx) => {
      const trueIdx = displayHistory.length - 1 - displayIdx; // real index in array for Firestore ops
      const isCurrent = trueIdx === displayHistory.length - 1;
      const isSynthetic = !!entry._synthetic; // display-only entry; not stored in statusHistory
      const cfg = STATUS_CONFIG_SAFE[entry.status];
      const isResolvedEntry = entry.status === 'resolved';
      const entryWorkflowState = isResolvedEntry
        ? 'finished'
        : workflowDisplayState(entry, isCurrent);
      const wfCfg = workflowConfig[entryWorkflowState] || workflowConfig.called;
      const wfColor = !entryWorkflowState ? '#6b7280'
        : entryWorkflowState === 'called' ? '#eab308'
        : entryWorkflowState === 'accepted' ? '#22c55e'
        : entryWorkflowState === 'in-progress' ? '#3b82f6'
        : '#a855f7';

      // Left bar color: workflow state color for regular entries, status color for resolved
      const barColor = isResolvedEntry ? cfg.color : wfColor;
      // Subtle tinted background using bar color
      const entryBg = `background:${alphaColor(barColor, 0.05)};`;

      // Workflow badge (clickable for non-resolved entries to cycle state)
      const wfBadgeLabel = entryWorkflowState
        ? `${wfCfg.icon} ${wfCfg.label.toUpperCase()}${isCurrent ? ' · CURRENT' : ''}`
        : `— NOT STARTED${isCurrent ? ' · CURRENT' : ''}`;
      const wfBadge = isResolvedEntry
        ? `<div class="tl-wf-badge no-action" style="color:${cfg.color}">${cfg.icon} RESOLVED${isCurrent ? ' · CURRENT' : ''}</div>`
        : `<button class="tl-wf-badge" style="color:${wfColor}" onclick="event.stopPropagation(); cycleWorkflowStateForEntry('${issue.id}',${trueIdx})" title="Tap to cycle workflow state">${wfBadgeLabel}</button>`;
      const entrySerialMatch = String(entry.note || '').match(/S\/N:\s*([A-Za-z0-9]+)/i);
      const entrySerialNumber = entrySerialMatch ? entrySerialMatch[1].toUpperCase() : '';
      const entryMaterialBadge = String(entry.status || '').toLowerCase() === 'materials' && entrySerialNumber
        ? ` <span class="issue-serial-tag" title="Serial Number: ${esc(entrySerialNumber)}">🏷️ ${esc(entrySerialNumber)}</span>`
        : '';

      return `<div class="tl-entry${entryWorkflowState === 'finished' ? ' finished-checkered' : ''}" style="border-left-color:${barColor};${entryBg}">
        ${wfBadge}
        <div>
          <div class="tl-header">
            <span class="tl-status-label" style="color:${cfg.color}">${cfg.label}${entry.subStatus?' › '+esc(entry.subStatus):''}${entryMaterialBadge}</span>
          </div>
          <div class="tl-time">${entry.dateTime||''}${entry.by?' — '+esc(entry.by):''}</div>
          ${entry.note?`<div class="tl-note-text">"${esc(entry.note)}"</div>`:''}
          ${Array.isArray(entry.photos) && entry.photos.length ? `<div class="issue-photos" style="margin-top:6px;">${entry.photos.map((p,i)=>`<img class="issue-photo-thumb" src="${esc(p.downloadURL || p.dataUrl || '')}" loading="lazy" alt="${esc(p.name || `Status photo ${i+1}`)}" onclick="openLightbox(${i}, [${entry.photos.map(sp => `{url:'${esc(sp.downloadURL || sp.dataUrl || '')}',takenAt:'${esc(sp.takenAt || sp.timestamp || '')}',uploadedAt:'${esc(sp.uploadedAt || sp.createdAt || '')}'}`).join(',')}])">`).join('')}</div>` : ''}
          ${currentUserPermissions.canEditIssue ? `<div style="display:flex;gap:5px;margin-top:6px;">
            ${!isResolvedEntry && !isCurrent ? `<button class="tl-edit-btn" onclick="setStatusCurrentFromHistory('${issue.id}',${trueIdx})">Set current</button>` : ''}
            ${!isResolvedEntry && entryWorkflowState === 'finished' ? `<button class="tl-edit-btn" onclick="setWorkflowStateForEntry('${issue.id}',${trueIdx},'called')">Un-finish</button>` : ''}
            <button class="tl-edit-btn" onclick="startEditEntry('${issue.id}',${trueIdx})">✏ Edit</button>
            <button class="tl-remove-btn" onclick="removeStatusEntry('${issue.id}',${trueIdx})" ${isSynthetic||history.length<=1?'disabled':''}>🗑 Delete</button>
          </div>` : ''}
        </div>
      </div>`;
    }).join('');

    // Pending new entry for this issue
    const pend = pendingEntry[issue.id] || {};
    const pendSubs = STATUS_CONFIG[pend.status]?.subs || [];
    const pendNowDT = toLocalDTInputs(new Date());
    const canEdit = currentUserPermissions.canEditIssue && !isLocalIssue;
    const addRowHtml = !canEdit ? '' : pend.status !== undefined
      ? `<div class="tl-add-row">
          <select class="tl-mini-select" onchange="setPendingStatus('${issue.id}','status',this.value)">
            <option value="">Status…</option>
            ${getAlphabetizedStatusKeys().map(k=>`<option value="${k}"${k===pend.status?' selected':''}>${STATUS_CONFIG[k].icon} ${STATUS_CONFIG[k].label}</option>`).join('')}
          </select>
          ${pendSubs.length?`<select class="tl-mini-select" id="pending-sub-${issue.id}"><option value="">Sub-status…</option>${pendSubs.map(s=>`<option value="${s}"${s===pend.subStatus?' selected':''}>${s}</option>`).join('')}</select>`:''}
          <input class="tl-mini-input" id="pending-note-${issue.id}" placeholder="Note (optional)…">
          <div style="display:flex;gap:4px;align-items:center;width:100%;">
            <input type="date" class="tl-mini-input" id="pending-date-${issue.id}" value="${pendNowDT.dateStr}" style="flex:1;min-width:110px;">
            <input type="time" class="tl-mini-input" id="pending-time-${issue.id}" value="${pendNowDT.timeStr}" style="width:90px;">
          </div>
          <button class="tl-mini-btn tl-save-btn" onclick="commitAddEntry('${issue.id}')">+ Add</button>
          <button class="tl-mini-btn tl-cancel-btn" onclick="cancelAddEntry('${issue.id}')">Cancel</button>
        </div>`
      : `<div class="tl-add-row">
          <button class="tl-mini-btn" style="background:var(--color-surface-raised, var(--bg3));border:1px solid var(--color-border, var(--border));color:var(--color-text-muted, var(--text2));padding:4px 11px;" onclick="setPendingStatus('${issue.id}','status','')">+ Add status entry</button>
        </div>`;

    const resolveHtml = `<div class="status-timeline">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-text-muted, var(--text2));margin-bottom:8px;">Status History</div>
      <div class="tl-list">
        ${timelineEntries}
      </div>
      ${addRowHtml}
    </div>
    <div class="action-row issue-footer-actions" style="margin-top:10px;">
      <button class="issue-reminder-btn${reminderState?.isOverdue ? ' overdue' : ''}" onclick="event.stopPropagation(); openIssueReminderModal('${issue.id}')" title="Set check-back timer">
        <span class="issue-reminder-icon">⏱</span>
        <span class="issue-reminder-copy">
          <span class="issue-reminder-label">${reminderState?.isOverdue ? 'Check now' : 'Check back'}</span>
          <span class="issue-reminder-time" data-reminder-id="${issue.id}">${formatReminderClock(reminderState)}</span>
        </span>
      </button>
      ${canEdit ? `<div class="issue-footer-actions-right">
      <button class="btn btn-edit" onclick="openEditModal('${issue.id}')">✏️ Edit</button>
      ${DEMO_MODE ? '' : `<button class="btn btn-danger" onclick="deleteIssue('${issue.id}')">🗑 Delete</button>`}
      </div>` : ''}
    </div>`;

    const datePart = issue.dateTime ? issue.dateTime.replace(/,\s*\d{4}/, '') : '';
    const submitterHtml=issue.userName?`<span class="issue-submitter">${esc(issue.userName.split(' ')[0])}${isMyIssue?' (you)':''}</span>`:'';
    const alertFocusHtml = isAlertFocus ? `<span class="issue-alert-focus-badge">Outside current time frame</span>` : '';

    // Secondary status keys (needed by workflow rows below)
    const secKeys = getSecondaryStatuses(issue).filter(k => k !== 'resolved');

    // Build compact 4-step header buttons with state label below
    const wfActor = workflowDisplayActor(currentEntry, workflowState, true);
    const wfHeaderHtml = `<div class="wf-steps-wrap" onclick="event.stopPropagation()">
      <div class="wf-steps-row">
        ${hasNoWorkflowState ? `<div class="wf-prompt-arrow" id="wf-arrow-${issue.id}"></div>` : ''}
        <div class="wf-steps">${wfOrder.map(state => {
          const cfg = workflowConfig[state];
          const cls = state === workflowState ? `active ${cfg.cssState}` : isCompleted(state) ? 'completed' : 'pending';
          return `<button class="wf-step-btn ${cls}" onclick="handleWfStepClick(event,'${issue.id}',${currentEntryIndex},'${state}')" title="${cfg.label}">${cfg.icon}</button>`;
        }).join('')}</div>
      </div>
      <div class="wf-state-label ${workflowState ? workflowConfig[workflowState].cssState : ''}">${workflowState ? workflowConfig[workflowState].label : ''}</div>
      <div class="wf-state-meta ${workflowState ? workflowConfig[workflowState].cssState : ""}">${formatWorkflowActor(wfActor)}</div>
    </div>`;

    // Per-status workflow rows for the card header. Finished statuses stay in
    // the status history timeline, but drop out of the top active-work area.
    const historicalWorkflowEntries = [...displayHistory]
      .map((entry, idx) => ({ entry, idx }))
      .reverse()
      .filter(({ entry, idx }) => {
        if (!entry?.status || entry.status === 'open' || entry.status === 'resolved' || idx === currentEntryIndex) return false;
        return workflowDisplayState(entry, false) !== 'finished';
      });

    const wfHistoryRowsHtml = historicalWorkflowEntries.map(({ entry, idx }) => {
          const sKey = entry.status;
          const sCfg = STATUS_CONFIG_SAFE[sKey];
          const sColor = getStatusColor(sKey);
          const sState = workflowDisplayState(entry, false);
          const sCurrentIdx = sState ? wfOrder.indexOf(sState) : -1;
          const sSubLabel = entry.subStatus || '';
          const sActor = workflowDisplayActor(entry, sState, false);
          const btnHtml = wfOrder.map(st => {
            const cfg = workflowConfig[st];
            const cls = st === sState ? `active ${cfg.cssState}` : (sState && wfOrder.indexOf(st) < sCurrentIdx) ? 'completed' : 'pending';
            return `<button class="wf-step-btn ${cls}" onclick="event.stopPropagation(); setWorkflowStateForEntry('${issue.id}',${idx},'${st}')" title="${cfg.label}">${cfg.icon}</button>`;
          }).join('');
          const sStateLabel = sState ? workflowConfig[sState].label : 'Not Started';
          const sStateClass = sState ? workflowConfig[sState].cssState : '';
          return `<div class="wf-status-row${sState === 'finished' ? ' finished-checkered' : ''}">
            <div class="wf-status-row-info">
              <div class="issue-status" style="color:${sColor};border-color:${sColor};background:${alphaColor(sColor,0.12)}">
                <span class="issue-status-main">${sCfg.icon} ${esc(sCfg.label)}</span>
              </div>
              ${sSubLabel ? `<span class="issue-status-sub" style="color:${sColor};">${esc(sSubLabel)}</span>` : ''}
            </div>
            <div class="wf-steps-wrap" onclick="event.stopPropagation()">
              <div class="wf-steps">${btnHtml}</div>
              <div class="wf-state-label ${sStateClass}">${sStateLabel}</div>
              <div class="wf-state-meta ${sStateClass}">${sState ? formatWorkflowActor(sActor) : ''}</div>
            </div>
          </div>`;
        }).join('');

    // Split status label from sub-status for two-line display
    const baseLabel = scfg.label;
    const subLabel = currentSubKey;

    // Secondary status dots (shown on the current row)
    const visibleSecKeys = secKeys.filter(k => wfByStatus[k] !== 'finished');
    const secDotsHtml = visibleSecKeys.length > 0
      ? `<div class="secondary-status-dots">${visibleSecKeys.map(k => {
          const cfg = STATUS_CONFIG_SAFE[k];
          const col = getStatusColor(k);
          return `<span class="secondary-dot" style="color:${col};border-color:${col};background:${alphaColor(col,0.12)}">${cfg.icon} ${cfg.label}</span>`;
        }).join('')}</div>`
      : '';

    let foundSerialNumber = '';
    const reversedHistory = [...displayHistory].reverse();
    for (const entry of reversedHistory) {
      if (!entry.note) continue;
      const match = entry.note.match(/S\/N:\s*([A-Za-z0-9]+)/i);
      if (match) {
        foundSerialNumber = match[1].toUpperCase();
        break;
      }
    }
    const isMaterialsWorkflow = String(currentKey || '').toLowerCase() === 'materials';
    const serialBadgeHtml = isMaterialsWorkflow && foundSerialNumber
      ? `<div class="issue-serial-tag" style="margin-left:12px; margin-top:2px;" title="Serial Number: ${esc(foundSerialNumber)}">🏷️ ${esc(foundSerialNumber)}</div>`
      : '';
    const subLabelWithSerial = (() => {
      if (!subLabel) return '';
      if (!isMaterialsWorkflow || !foundSerialNumber) return subLabel;
      return `${subLabel} ${foundSerialNumber}`;
    })();

    const currentWfRowHtml = `<div class="wf-status-row${workflowState === 'finished' ? ' finished-checkered' : ''}">
      <div class="wf-status-row-info">
        <div class="issue-status" style="color:${sc.color};border-color:${sc.color};background:${alphaColor(sc.color,0.12)}">
          <span class="issue-status-main">${sc.icon} ${baseLabel}</span>
        </div>
        ${subLabelWithSerial ? `<span class="issue-status-sub" style="color:${sc.color};">${esc(subLabelWithSerial)}</span>` : ''}
        ${serialBadgeHtml}
        ${secDotsHtml}
      </div>
      ${wfHeaderHtml}
    </div>`;

    const wfStatusRowsInnerHtml = `${currentWfRowHtml}${wfHistoryRowsHtml}`;
    const wfStatusRowsHtml = wfStatusRowsInnerHtml.trim()
      ? `<div class="wf-status-rows" onclick="event.stopPropagation()">
      ${currentWfRowHtml}
      ${wfHistoryRowsHtml}
    </div>`
      : '';

    const _shiftDef = issue.shift ? getShiftSchedule(currentPlantId).find(s => s.key === issue.shift) : null;
    const shiftBadgeHtml = _shiftDef
      ? `<span class="shift-badge" style="background:${_shiftDef.color}20;color:${_shiftDef.color};border-color:${_shiftDef.color}50">${_shiftDef.shortLabel}</span>`
      : '';
    const timerBadgeHtml = reminderState ? `<span class="timer-mini-badge ${reminderState.isOverdue ? 'overdue' : ''}"><span class="timer-mini-dot"></span><span data-reminder-id="${issue.id}">${formatReminderClock(reminderState)}</span></span>` : '';
    const localSyncBadgeHtml = isLocalIssue
      ? `<span class="local-sync-badge ${issue.__localSyncStatus === 'failed' ? 'failed' : ''}">${issue.__localSyncStatus === 'failed' ? 'Sync failed' : issue.__localSyncStatus === 'syncing' ? 'Uploading' : 'Pending sync'}</span>`
      : '';

    card.innerHTML=`
      <div class="issue-card-header" onclick="toggleCard('${issue.id}')">
        <div class="issue-card-top">
          <div class="issue-machine-tag">${esc(issue.machine)}</div>
          <div class="issue-meta">
            <div class="issue-note-preview">${esc(issue.note)}</div>
            <div class="issue-time">${datePart} ${submitterHtml}${shiftBadgeHtml}${timerBadgeHtml}${localSyncBadgeHtml}${(issue.photos||[]).length?`<span class="photo-count-badge">📷 ${issue.photos.length}</span>`:''}${issue.editedAt?'<span style="color:var(--color-text-subtle, var(--text3))">(edited)</span>':''}${alertFocusHtml}</div>
          </div>
          <button class="priority-btn${(issue.highPriority || isTimerOverdue)?' active':''}" onclick="event.stopPropagation(); ${isLocalIssue ? '' : `togglePriority('${issue.id}')`}" ${isLocalIssue ? 'disabled' : ''} title="${isLocalIssue?'Sync before changing priority':isTimerOverdue?'Timer overdue - clear timer to stop pulse':(issue.highPriority?'Remove high priority':'Mark as high priority')}">!</button>
          <div class="issue-expand-icon ${wasOpen?'open':''}" id="chevron-${issue.id}">▼</div>
        </div>
        ${wfStatusRowsHtml}
      </div>
      <div class="issue-body ${wasOpen?'visible':''}" id="body-${issue.id}">
        <!-- Full width content -->
        <div class="issue-full-note">${esc(issue.note)}</div>
        ${editedNote}
        ${photosHtml}
        <div class="divider"></div>
        ${resolveHtml}
      </div>`;
    // Safety cleanup: remove any legacy "Workflow: ..." pill buttons from status history rows.
    card.querySelectorAll('.status-timeline button').forEach(btn => {
      if (/^workflow\s*:/i.test((btn.textContent || '').trim())) btn.remove();
    });
    row.appendChild(card);

    // Add teaser strip (gradient bar that peeks out during left swipe)
    const teaser = document.createElement('div');
    teaser.className = 'swipe-teaser';
    // Build gradient from first few status colors
    const statusOrder = getAlphabetizedStatusKeys();
    const colors = statusOrder.slice(0, 5).map(k => getStatusColor(k)).join(', ');
    teaser.style.background = `linear-gradient(to bottom, ${colors})`;
    card.appendChild(teaser);

    // Right-swipe notes teaser (teal bar on left edge)
    const notesTeaser = document.createElement('div');
    notesTeaser.className = 'swipe-notes-teaser';
    card.appendChild(notesTeaser);

    // Category panel (slides out underneath card)
    const catPanel = document.createElement('div');
    catPanel.className = 'swipe-category-panel';
    const catInner = document.createElement('div');
    catInner.className = 'swipe-category-inner';

    // Build status tiles for ALL statuses (including open/resolved)
    // Keep true alphabetic left-to-right order in the swipe category slider.
    statusOrder.forEach(key => {
      const st = getStatusDef(key);
      const tile = document.createElement('div');
      tile.className = 'swipe-status-tile' + (currentStatusKey(issue) === key ? ' current' : '');
      tile.style.color = getStatusColor(key);
      tile.dataset.status = key;
      tile.innerHTML = `<span class="swipe-tile-icon">${st.icon}</span><span class="swipe-tile-label">${getStatusLabel(key, 'short')}</span>`;
      catInner.appendChild(tile);
    });

    // Search tile (always last)
    const searchTile = document.createElement('div');
    searchTile.className = 'swipe-status-tile swipe-search-tile';
    searchTile.style.color = 'var(--color-text-muted, var(--text2))';
    searchTile.dataset.status = '__search__';
    searchTile.innerHTML = `<span class="swipe-tile-icon">🔍</span><span class="swipe-tile-label">Search</span>`;
    catInner.appendChild(searchTile);

    catPanel.appendChild(catInner);

    // Sub-status panel
    const subPanel = document.createElement('div');
    subPanel.className = 'swipe-sub-panel';
    subPanel.innerHTML = '<div class="swipe-search-bar-row search-bar-row"></div><div class="swipe-sub-inner"></div>';

    row.appendChild(catPanel);
    row.appendChild(subPanel);
    list.appendChild(row);

    // Helper functions for this card
    const scrollPanelBottomIntoView = (panelEl) => {
      if (!panelEl) return;
      requestAnimationFrame(() => {
        const rect = panelEl.getBoundingClientRect();
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const overflowBottom = rect.bottom - viewportHeight;
        if (overflowBottom > 0) {
          window.scrollBy({ top: overflowBottom, behavior: 'smooth' });
        }
      });
    };

    const openCategoryPanel = () => {
      if (!currentUserPermissions.canEditIssue) return;
      card.classList.remove('peeking', 'dragging');
      card.style.transform = '';
      card.classList.add('swiped');
      catPanel.classList.add('visible');
      if (openSwipeRow && openSwipeRow.card !== card) closeSwipeCard(openSwipeRow.card);
      openSwipeRow = { card, catPanel, subPanel };
      scheduleIssueLogRelayout();
      scrollPanelBottomIntoView(catPanel);
      setTimeout(() => scrollPanelBottomIntoView(catPanel), 280);
    };

    const closeSwipeCard = (c) => {
      if (isSearchMode) closeSearch();
      c.classList.remove('swiped');
      const r = c.closest('.issue-row');
      const cp = r.querySelector('.swipe-category-panel');
      const sp = r.querySelector('.swipe-sub-panel');
      cp.classList.remove('visible', 'has-subs', 'search-mode');
      sp.classList.remove('visible');
      cp.querySelector('.swipe-category-inner')?.classList.remove('has-selection');
      const swipeSearchBar = sp.querySelector('.swipe-search-bar-row');
      if (swipeSearchBar) {
        swipeSearchBar.innerHTML = '';
        swipeSearchBar.classList.remove('visible');
      }
      cp.querySelectorAll('.swipe-status-tile').forEach(t => {
        t.classList.remove('selected', 'search-match');
        t.style.opacity = '';
        t.style.pointerEvents = '';
      });
      swipeSearchSub = '';
      swipeSearchActiveSub = '';
      swipeSearchMode = false;
      if (openSwipeRow?.card === c) openSwipeRow = null;
      scheduleIssueLogRelayout();
    };

    // Tile clicks
    let lastTileTap = null; // { key, stamp } — tracks last tap for double-click/double-tap detection
    let swipeSearchSub = '';
    let swipeSearchActiveSub = '';
    let swipeSearchMode = false;

    const dimSwipeTiles = () => {
      catInner.querySelectorAll('.swipe-status-tile').forEach(t => {
        if (t === searchTile) { t.style.opacity = ''; t.style.pointerEvents = ''; return; }
        t.classList.remove('selected', 'current', 'search-match');
        if (swipeSearchActiveSub && getSubCats(swipeSearchActiveSub).includes(t.dataset.status)) {
          t.style.opacity = '1'; t.style.pointerEvents = 'auto';
          t.classList.add('search-match');
        } else {
          t.style.opacity = '0.5'; t.style.pointerEvents = 'none';
        }
      });
    };

    const resetSwipeSearchMode = () => {
      if (isSearchMode) closeSearch();
      swipeSearchActiveSub = '';
      swipeSearchMode = false;
      searchApplySelection = null;
      searchExitFn = null;
      searchTile.classList.remove('selected');
      catInner.classList.remove('has-selection');
      catPanel.classList.remove('has-subs', 'search-mode');
      subPanel.classList.remove('visible');
      const swipeSearchBar = subPanel.querySelector('.swipe-search-bar-row');
      if (swipeSearchBar) {
        swipeSearchBar.innerHTML = '';
        swipeSearchBar.classList.remove('visible');
      }
      catInner.querySelectorAll('.swipe-status-tile').forEach(t => {
        t.classList.remove('selected', 'search-match');
        t.style.opacity = '';
        t.style.pointerEvents = '';
      });
      scheduleIssueLogRelayout();
    };

    const handleSwipeSearchTileClick = (e) => {
      if (swipeSearchMode) { resetSwipeSearchMode(); return; }

      const subInner = subPanel.querySelector('.swipe-sub-inner');
      const searchBar = subPanel.querySelector('.swipe-search-bar-row');

      // Set shared search state
      isSearchMode = true;
      searchFilterText = '';
      searchApplySelection = (key, sub) => {
        closeSwipeCard(card);
        if (sub && requiresSerialNumber(key, sub)) { openSerialModal(issue.id, key, sub); }
        else { addStatusEntry(issue.id, key, sub, ''); }
      };
      searchExitFn = null;

      // Swipe-specific state
      swipeSearchMode = true;
      swipeSearchActiveSub = '';
      searchTile.classList.add('selected');
      catInner.classList.add('has-selection');
      catPanel.classList.add('has-subs', 'search-mode');
      dimSwipeTiles();

      const swipeSubPick = (sub) => {
        if (!getSubCats(sub).length) return;
        swipeSearchActiveSub = sub;
        dimSwipeTiles();
        renderSharedSearchContent(searchBar, subInner, swipeSubPick, swipeSearchActiveSub);
      };
      renderSharedSearchContent(searchBar, subInner, swipeSubPick, swipeSearchActiveSub);
      subPanel.classList.add('visible');
      scheduleIssueLogRelayout();
      scrollPanelBottomIntoView(subPanel);
      setTimeout(() => scrollPanelBottomIntoView(subPanel), 240);
    };

    catInner.querySelectorAll('.swipe-status-tile').forEach(tile => {
      const handleTileClick = (e) => {
        if (e && e.__aptrackerHandledSwipeClick) return;
        if (e) e.__aptrackerHandledSwipeClick = true;
        const statusKey = tile.dataset.status;
        if (statusKey === '__search__') { handleSwipeSearchTileClick(e); return; }
        if (swipeSearchActiveSub) {
          if (searchApplySelection) searchApplySelection(statusKey, swipeSearchActiveSub);
          return;
        }
        const statusDef = getStatusDef(statusKey);
        const stamp = e ? e.timeStamp : Date.now();

        // Detect double-click/double-tap:
        // Two listener calls from the same event share the same timeStamp, so filter those out.
        const prevTap = lastTileTap;
        lastTileTap = { key: statusKey, stamp };
        if (prevTap && prevTap.stamp === stamp) return; // duplicate call from same event

        const isDoubleTap = prevTap
          && prevTap.key === statusKey
          && (stamp - prevTap.stamp) < 350;

        if (isDoubleTap && getStatusSubs(statusKey).length > 0) {
          // Double-click/tap on a category = apply immediately with no sub-status (Skip)
          catInner.querySelectorAll('.swipe-status-tile').forEach(t => t.classList.remove('selected'));
          catInner.classList.remove('has-selection');
          subPanel.classList.remove('visible');
          catPanel.classList.remove('has-subs');
          closeSwipeCard(card);
          addStatusEntry(issue.id, statusKey, '', '');
          return;
        }

        // Clear previous selection
        catInner.querySelectorAll('.swipe-status-tile').forEach(t => t.classList.remove('selected'));
        catInner.classList.remove('has-selection');

        if (getStatusSubs(statusKey).length > 0) {
          // Show sub panel
          tile.classList.add('selected');
          catInner.classList.add('has-selection');
          catPanel.classList.add('has-subs');

    const subInner = subPanel.querySelector('.swipe-sub-inner');
    subInner.innerHTML = '';
    subInner.className = 'swipe-sub-inner subcategory-grid'; 
    applyColumnMajorGridLayout(subInner, getStatusSubs(statusKey).length + 1, 2);
          
    const activeColor = getStatusColor(statusKey);

          // Sub chips (alphabetized for consistent scan order)
          const sortedSubs = [...getStatusSubs(statusKey)].sort((a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' }));
          sortedSubs.forEach(sub => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'subcategory-item swipe-sub-action';
            item.innerHTML = `<span class="subcategory-item-label">${esc(sub)}</span>`;
            item.style.borderColor = alphaColor(activeColor, 0.32);
            item.style.color = activeColor;
            item.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)';
            item.dataset.sub = sub;
            subInner.appendChild(item);
          });

          // Skip chip
          const skipChip = document.createElement('button');
          skipChip.type = 'button';
          skipChip.className = 'subcategory-item swipe-sub-action skip';
          skipChip.innerHTML = `<span class="subcategory-item-label" style="color:var(--color-text-subtle, var(--text3)); font-style:italic;">Skip ›</span>`;
          skipChip.style.borderColor = 'var(--color-border, var(--border))';
          skipChip.style.background = 'transparent';
          skipChip.dataset.sub = '';
          subInner.appendChild(skipChip);

          // Add click handlers to sub chips
          subInner.querySelectorAll('.swipe-sub-action').forEach(chip => {
            const handleSubClick = () => {
              const sub = chip.dataset.sub;
              closeSwipeCard(card);
              if (sub && requiresSerialNumber(statusKey, sub)) {
                openSerialModal(issue.id, statusKey, sub);
              } else {
                addStatusEntry(issue.id, statusKey, sub, '');
              }
            };
            
            addTapListener(chip, handleSubClick);
            chip.addEventListener('click', handleSubClick); // Mouse support
          });

          subPanel.classList.add('visible');
          scheduleIssueLogRelayout();
          scrollPanelBottomIntoView(subPanel);
          setTimeout(() => scrollPanelBottomIntoView(subPanel), 240);
        } else {
          // Apply immediately (no subs)
          closeSwipeCard(card);
          addStatusEntry(issue.id, statusKey, '', '');
        }
      };
      
      addTapListener(tile, handleTileClick);
      tile.addEventListener('click', handleTileClick); // Mouse support
    });

    // Swipe gesture handling - Peek & Reveal with bidirectional close
    let sx = 0, sy = 0, currentX = 0, tracking = false, intentDecided = false, isHoriz = false;
    const isOpen = () => openSwipeRow?.card === card;

    card.addEventListener('touchstart', e => {
      // Don't track swipes on form elements
      if (e.target.matches('input, select, textarea, button')) {
        tracking = false;
        return;
      }

      // Don't start swipe tracking when touching category tiles or sub-chips —
      // a slight horizontal drift would otherwise suppress the click or restart animations.
      if (e.target.closest('.swipe-category-panel, .swipe-sub-panel')) {
        tracking = false;
        return;
      }

      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      currentX = 0;
      tracking = true;
      intentDecided = false;
      isHoriz = false;
      card.classList.add('dragging');
    }, { passive: true, capture: true });

    card.addEventListener('touchmove', e => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - sx;
      const dy = e.touches[0].clientY - sy;

      if (!intentDecided && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        isHoriz = Math.abs(dx) > Math.abs(dy);
        intentDecided = true;
        if (!isHoriz) {
          card.classList.remove('dragging', 'peeking');
          card.style.transform = '';
        }
      }

      if (!isHoriz) {
        tracking = false;
        return;
      }

      // Prevent scrolling when swiping horizontally
      e.preventDefault();

      // Card follows finger - bidirectional when open, both directions when closed too
      currentX = Math.max(-80, Math.min(80, dx));
      card.style.transform = `translateX(${currentX}px)`;

      // Show appropriate teaser strip when peeking
      if (currentX < -15) {
        card.classList.add('peeking');
        card.classList.remove('peeking-right');
      } else if (currentX > 15) {
        card.classList.add('peeking-right');
        card.classList.remove('peeking');
      } else {
        card.classList.remove('peeking', 'peeking-right');
      }
    }, { passive: false });

    card.addEventListener('touchend', e => {
      card.classList.remove('dragging');
      
      if (!tracking || !isHoriz) {
        tracking = false;
        card.classList.remove('peeking');
        card.style.transform = '';
        return;
      }
      
      // Prevent any click events from firing
      e.preventDefault();
      tracking = false;

      const dx = e.changedTouches[0].clientX - sx;
      
      // Snap back
      card.style.transform = '';
      card.classList.remove('peeking', 'peeking-right');

      if (!isOpen() && dx < -25) {
        // Closed: swipe left → open status category panel
        _swipeJustHappened = true;
        setTimeout(() => { _swipeJustHappened = false; }, 50);
        openCategoryPanel();
      } else if (!isOpen() && dx > 25) {
        // Closed: swipe right → open notes modal for this press
        _swipeJustHappened = true;
        setTimeout(() => { _swipeJustHappened = false; }, 50);
        openPressWikiModal(toPressId(issue.machine), issue.machine);
      } else if (isOpen() && Math.abs(dx) > 25) {
        // Open: swipe either direction to close
        _swipeJustHappened = true;
        setTimeout(() => { _swipeJustHappened = false; }, 50);
        closeSwipeCard(card);
      }
    }, { passive: false });

    // Mouse handling for desktop - Peek & Reveal with bidirectional close
    let mouseDown = false, mouseStartX = 0, mouseCurrentX = 0;
    card.addEventListener('mousedown', e => {
      // Don't interfere with form element interactions
      if (e.target.matches('input, select, textarea, button')) {
        return;
      }
      
      mouseDown = true;
      mouseStartX = e.clientX;
      mouseCurrentX = 0;
      card.classList.add('dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!mouseDown) return;
      mouseCurrentX = Math.max(-80, Math.min(80, e.clientX - mouseStartX));
      card.style.transform = `translateX(${mouseCurrentX}px)`;
      if (mouseCurrentX < -15) {
        card.classList.add('peeking');
        card.classList.remove('peeking-right');
      } else if (mouseCurrentX > 15) {
        card.classList.add('peeking-right');
        card.classList.remove('peeking');
      } else {
        card.classList.remove('peeking', 'peeking-right');
      }
    });

    document.addEventListener('mouseup', e => {
      if (!mouseDown) return;
      mouseDown = false;
      card.classList.remove('dragging', 'peeking', 'peeking-right');
      card.style.transform = '';
      const dx = e.clientX - mouseStartX;
      if (!isOpen() && dx < -25) {
        _swipeJustHappened = true;
        setTimeout(() => { _swipeJustHappened = false; }, 50);
        openCategoryPanel();
      } else if (!isOpen() && dx > 25) {
        _swipeJustHappened = true;
        setTimeout(() => { _swipeJustHappened = false; }, 50);
        openPressWikiModal(toPressId(issue.machine), issue.machine);
      } else if (isOpen() && Math.abs(dx) > 25) {
        _swipeJustHappened = true;
        setTimeout(() => { _swipeJustHappened = false; }, 50);
        closeSwipeCard(card);
      }
    });

    let horizontalWheelTotal = 0;
    let horizontalWheelTimer = null;
    card.addEventListener('wheel', e => {
      if (e.target.matches('input, select, textarea, button') || e.target.closest('.swipe-category-panel, .swipe-sub-panel')) {
        return;
      }
      if (Math.abs(e.deltaX) < 18 || Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.15) {
        return;
      }
      e.preventDefault();
      horizontalWheelTotal += e.deltaX;
      card.classList.toggle('peeking', horizontalWheelTotal > 18);
      card.classList.toggle('peeking-right', horizontalWheelTotal < -18);
      clearTimeout(horizontalWheelTimer);
      horizontalWheelTimer = setTimeout(() => {
        const dx = horizontalWheelTotal;
        horizontalWheelTotal = 0;
        card.classList.remove('peeking', 'peeking-right');
        if (!isOpen() && dx > 35) {
          _swipeJustHappened = true;
          setTimeout(() => { _swipeJustHappened = false; }, 50);
          openCategoryPanel();
        } else if (!isOpen() && dx < -35) {
          _swipeJustHappened = true;
          setTimeout(() => { _swipeJustHappened = false; }, 50);
          openPressWikiModal(toPressId(issue.machine), issue.machine);
        } else if (isOpen() && Math.abs(dx) > 35) {
          _swipeJustHappened = true;
          setTimeout(() => { _swipeJustHappened = false; }, 50);
          closeSwipeCard(card);
        }
      }, 80);
    }, { passive: false });

    if (openSwipeSnapshot?.issueId === issue.id) {
      openCategoryPanel();
    }
  });

  if (issueDisplayLimit < totalFiltered) {
    const remaining = totalFiltered - issueDisplayLimit;
    const loadMoreRow = document.createElement('div');
    loadMoreRow.className = 'load-more-row';
    loadMoreRow.innerHTML = `<button class="load-more-btn" onclick="loadMoreIssues()">Show ${Math.min(remaining, PAGE_SIZE)} more <span class="load-more-count">${remaining} remaining</span></button>`;
    list.appendChild(loadMoreRow);
  }

  maybeNotifyIssueReminders(filtered);
  scheduleIssueLogRelayout();
  scheduleIssueLogRelayout(40);
}

window.loadMoreIssues = function() {
  issueDisplayLimit += PAGE_SIZE;
  renderIssues();
};

// ── STATUS BOTTOM SHEET ──







// ── SWIPE TO STATUS ──
let openSwipeRow = null;

function captureOpenSwipeSnapshot() {
  if (!openSwipeRow?.card) return null;
  const row = openSwipeRow.card.closest('.issue-row');
  const issueId = row?.dataset?.id || '';
  if (!issueId) return null;
  return { issueId };
}

function closeSwipe() {
  if (!openSwipeRow) return;
  const { card, catPanel, subPanel } = openSwipeRow;
  card.classList.remove('swiped');
  catPanel.classList.remove('visible', 'has-subs');
  subPanel.classList.remove('visible');
  catPanel.querySelectorAll('.swipe-status-tile').forEach(t => t.classList.remove('selected'));
  openSwipeRow = null;
  scheduleIssueLogRelayout();
}

document.addEventListener('click', e => {
  if (!openSwipeRow) return;
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  const clickedInsideIssueRow = path.some(node => node && node.classList && node.classList.contains('issue-row'));
  if (!clickedInsideIssueRow) closeSwipe();
});

let _swipeJustHappened = false;
window.toggleCard = id => {
  // Don't toggle if a swipe gesture just completed or card is swiped open
  if (_swipeJustHappened) { _swipeJustHappened = false; return; }
  if (openSwipeRow) return;
  const bodyEl = document.getElementById('body-'+id);
  const chevronEl = document.getElementById('chevron-'+id);
  const willOpen = bodyEl ? !bodyEl.classList.contains('visible') : false;
  bodyEl?.classList.toggle('visible');
  chevronEl?.classList.toggle('open');
  if (willOpen) {
    ensureIssueDetailsHydrated(id).catch(() => {});
    setTimeout(() => {
      const cardEl = bodyEl?.closest('.issue-card');
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }, 50);
  }
  scheduleIssueLogRelayout();
};

function resetIssueLogLayoutStyles(list) {
  list.style.height = '';
  list.querySelectorAll(':scope > .issue-row').forEach(row => {
    row.style.position = '';
    row.style.top = '';
    row.style.left = '';
    row.style.width = '';
    row.style.transform = '';
  });
  const loadMoreEl = list.querySelector(':scope > .load-more-row');
  if (loadMoreEl) {
    loadMoreEl.style.position = '';
    loadMoreEl.style.top = '';
    loadMoreEl.style.left = '';
    loadMoreEl.style.width = '';
  }
  issueLogMasonicState.positions.clear();
}

function getIssueLogColumnCount(listWidth, minColumnWidth = 300, gutter = 8) {
  return Math.max(1, Math.floor((listWidth + gutter) / (minColumnWidth + gutter)));
}

function placeIssueLogRows(rows, columnCount, columnWidth, gutter) {
  const colHeights = Array(columnCount).fill(0);
  issueLogMasonicState.positions.clear();

  rows.forEach(row => {
    let targetCol = 0;
    for (let i = 1; i < columnCount; i++) {
      if (colHeights[i] < colHeights[targetCol]) targetCol = i;
    }

    const x = targetCol * (columnWidth + gutter);
    const y = colHeights[targetCol];
    issueLogMasonicState.positions.set(row.dataset.id || '', { x, y });

    row.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    colHeights[targetCol] += row.offsetHeight + gutter;
  });

  return Math.max(0, Math.max(...colHeights) - gutter);
}

function observeIssueLogRows(rows) {
  if (!('ResizeObserver' in window)) return;
  if (!issueLogResizeObserver) {
    issueLogResizeObserver = new ResizeObserver(() => {
      scheduleIssueLogRelayout(0);
    });
  }

  issueLogResizeObserver.disconnect();
  rows.forEach(row => issueLogResizeObserver.observe(row));
}

function applyIssueLogLayout() {
  const list = document.getElementById('issues-list');
  if (!list) return;

  const rows = [...list.querySelectorAll(':scope > .issue-row')];
  if (!rows.length) {
    list.classList.remove('masonic-enabled');
    list.style.height = '';
    if (issueLogResizeObserver) issueLogResizeObserver.disconnect();
    return;
  }

  if (issueLogLayoutMode !== 'masonic' || window.innerWidth <= 480) {
    list.classList.remove('masonic-enabled');
    if (issueLogResizeObserver) issueLogResizeObserver.disconnect();
    resetIssueLogLayoutStyles(list);
    return;
  }

  const gutter = issueLogMasonicState.gutter;
  const listWidth = list.clientWidth;
  if (!listWidth) return;

  const columnCount = getIssueLogColumnCount(listWidth, 300, gutter);
  const columnWidth = (listWidth - (gutter * (columnCount - 1))) / columnCount;

  issueLogMasonicState.columnCount = columnCount;
  issueLogMasonicState.columnWidth = columnWidth;

  list.classList.add('masonic-enabled');

  rows.forEach(row => {
    row.style.position = 'absolute';
    row.style.width = `${columnWidth}px`;
    row.style.top = '0px';
    row.style.left = '0px';
  });

  const maxHeight = placeIssueLogRows(rows, columnCount, columnWidth, gutter);
  const loadMoreEl = list.querySelector(':scope > .load-more-row');
  if (loadMoreEl) {
    loadMoreEl.style.position = 'absolute';
    loadMoreEl.style.top = `${maxHeight}px`;
    loadMoreEl.style.left = '0';
    loadMoreEl.style.width = '100%';
    list.style.height = `${maxHeight + loadMoreEl.offsetHeight + gutter}px`;
  } else {
    list.style.height = `${maxHeight}px`;
  }
  observeIssueLogRows(rows);
}

function scheduleIssueLogRelayout(delay = 0) {
  if (issueLogLayoutMode !== 'masonic') return;

  if (issueLogDeferredRelayoutTimer) {
    clearTimeout(issueLogDeferredRelayoutTimer);
    issueLogDeferredRelayoutTimer = null;
  }

  const run = () => {
    if (issueLogLayoutRaf) cancelAnimationFrame(issueLogLayoutRaf);
    issueLogLayoutRaf = requestAnimationFrame(() => {
      issueLogLayoutRaf = null;
      applyIssueLogLayout();
    });
  };

  if (delay > 0) issueLogDeferredRelayoutTimer = setTimeout(run, delay);
  else run();
}

window.addEventListener('resize', () => {
  scheduleIssueLogRelayout(50);
});

function currentStatusKey(issue) {
  if (issue?.currentStatus?.statusKey) return issue.currentStatus.statusKey;
  return issue?.lifecycle?.isResolved ? 'resolved' : 'open';
}

function formatIssueSmsBody(issue, issueLink = '') {
  if (!issue) return '';

  const statusKey = currentStatusKey(issue);
  const statusDef = getStatusDef(statusKey);
  const statusText = statusDef?.label || statusKey || 'Unknown';
  const subStatus = issue.currentStatus?.subLabel || issue.currentStatus?.subStatusKey || '';
  const noteText = issue.currentStatus?.notePreview || issue.note || 'N/A';
  const loggedAt = issue.dateTime || (issue.timestamp ? formatDate(issue.timestamp) : 'Unknown time');
  const machineIdentifier = issue.machine || issue.machineCode || 'Unknown';

  const lines = [
    `Issue update (${currentPlantName || 'Plant'})`,
    `Machine: ${machineIdentifier}`,
    `Status: ${statusText}${subStatus ? ` / ${subStatus}` : ''}`,
    `Note: ${noteText}`,
    `Logged: ${loggedAt}`
  ];
  if (issueLink) lines.push(`Link: ${issueLink}`);
  return lines.join('\n');
}

function issueIsResolvedV2(issue) {
  if (typeof issue?.lifecycle?.isResolved === 'boolean') return issue.lifecycle.isResolved;
  return issue?.currentStatus?.statusKey === 'resolved';
}

function updateStats() {
  let scoped = issueScope==='mine' ? issues.filter(i=>i.userId===currentUser?.uid) : issues;
  scoped = scoped.filter(periodFilter);
  document.getElementById('stat-open').textContent              = scoped.filter(i=>issueHasActiveStatus(i,'open')).length+' Open';
  document.getElementById('stat-resolved').textContent          = scoped.filter(i=>issueHasActiveStatus(i,'resolved')).length+' Resolved';
  // Loop through every key currently in the database-driven STATUSES object
    Object.keys(STATUSES).forEach(key => {
      const el = document.getElementById('stat-' + key);
      if (el) {
        const count = scoped.filter(i => issueHasActiveStatus(i, key)).length;
        el.textContent = `${count} ${getStatusLabel(key, 'stat')}`;
      }
    });
}

// ── MASCOT POPOVER ──
function openMascotPopover(e, statusKey, contextType, issueId) {
  e.stopPropagation();
  const m = MASCOTS[statusKey];
  if (!m) return;
  const popover  = document.getElementById('mascot-popover');
  const backdrop = document.getElementById('mascot-popover-backdrop');
  if (!popover || !backdrop) return;
  popover.style.setProperty('--mascot-accent', m.color);
  const statusDef = getStatusDef(statusKey);
  let badgeLabel = '', contextHtml = '';
  if (contextType === 'stat') {
    let scoped = issueScope === 'mine' ? issues.filter(i => i.userId === currentUser?.uid) : issues;
    scoped = scoped.filter(periodFilter);
    const matching = scoped.filter(i => issueHasActiveStatus(i, statusKey));
    const count = matching.length;
    const presses = [...new Set(matching.map(i => i.machine || i.machineCode).filter(Boolean))].slice(0, 6).join(', ');
    badgeLabel = 'ACTIVE ON FLOOR';
    contextHtml = `
      <div class="mascot-popover-fact">
        <span class="mascot-popover-fact-label">Issues</span>
        <span class="mascot-popover-fact-value" style="color:${m.color}">${count}</span>
      </div>
      ${presses ? `<div class="mascot-popover-fact">
        <span class="mascot-popover-fact-label">Presses</span>
        <span class="mascot-popover-fact-value">${presses}</span>
      </div>` : ''}
    `;
  } else if (contextType === 'issue') {
    const issue = issues.find(i => i.id === issueId);
    const cs = issue?.currentStatus || {};
    const setBy  = cs.enteredBy?.name || issue?.userName || '—';
    const setAt  = cs.enteredDateTime || issue?.dateTime || '—';
    const sub    = cs.subLabel || cs.subStatusKey || '';
    const note   = cs.notePreview || '';
    badgeLabel = 'STATUS DETAILS';
    contextHtml = `
      <div class="mascot-popover-fact">
        <span class="mascot-popover-fact-label">Set by</span>
        <span class="mascot-popover-fact-value">${setBy}</span>
      </div>
      <div class="mascot-popover-fact">
        <span class="mascot-popover-fact-label">At</span>
        <span class="mascot-popover-fact-value">${setAt}</span>
      </div>
      ${sub ? `<div class="mascot-popover-fact">
        <span class="mascot-popover-fact-label">Sub-status</span>
        <span class="mascot-popover-fact-value" style="color:${m.color}">${sub}</span>
      </div>` : ''}
      ${note ? `<div class="mascot-popover-fact">
        <span class="mascot-popover-fact-label">Note</span>
        <span class="mascot-popover-fact-value">${note}</span>
      </div>` : ''}
    `;
  }
  popover.innerHTML = `
    <button class="mascot-popover-close" onclick="closeMascotPopover()">✕</button>
    <div style="margin-bottom:2px">${m.svg(120, 120)}</div>
    <div class="mascot-popover-name" style="color:${m.color}">${m.name}</div>
    <div class="mascot-popover-role">${statusDef.label}</div>
    <div class="mascot-popover-tagline">${m.tagline}</div>
    <div class="mascot-popover-divider"></div>
    <div class="mascot-popover-badge-label">${badgeLabel}</div>
    <div class="mascot-popover-facts">${contextHtml}</div>
  `;
  backdrop.classList.add('visible');
}
function closeMascotPopover() {
  document.getElementById('mascot-popover-backdrop')?.classList.remove('visible');
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeMascotPopover();
    if (document.getElementById('spotlight-overlay')?.classList.contains('visible')) window.closeTutorial();
  }
});

// ── SPOTLIGHT TUTORIAL ──
const TUTORIAL_KEY = 'aptracker_tutorial_v1';

const SPOTLIGHT_STEPS = [
  {
    target: '#demo-guide',
    fallbackTarget: null,
    padding: 8,
    mascotKey: 'open',
    headline: 'DEMO PLANT ORIENTATION',
    body: "This demo plant is a hands-on sandbox. Use the checklist to try real actions; use this tour to learn where the main tools live.",
  },
  {
    target: '#header-quick-inline',
    mobileTarget: '#header-quick-wrap',
    fallbackTarget: '#header-quick-wrap',
    padding: 8,
    mascotKey: 'processengineer',
    headline: 'TOP TOOLS',
    body: 'Wiki, Notes, Todos, Messages, and Alerts sit in the header so plant context is always one tap away.',
    beforeShow: () => {
      if (window.matchMedia('(max-width: 760px)').matches) {
        setTimeout(() => {
          if (!document.getElementById('header-quick-menu')?.classList.contains('visible')) toggleHeaderQuickMenu?.();
        }, 0);
      } else {
        closeHeaderQuickMenu?.();
      }
    },
    afterLeave: () => closeHeaderQuickMenu?.(),
  },
  {
    target: '.controls',
    padding: 8,
    mascotKey: 'processengineer',
    headline: 'TIME & SCOPE',
    body: 'Start by choosing the time window and whether you want every issue or just the work assigned to you.',
  },
  {
    target: '#filter-drawer',
    fallbackTarget: '#filter-toggle-btn',
    padding: 8,
    mascotKey: 'quality',
    headline: 'FILTER THE VIEW',
    body: 'Open Filters when you need a narrower list by press, status, shift, owner, or text search.',
    beforeShow: () => {
      if (!document.getElementById('filter-drawer')?.classList.contains('open')) window.toggleFilterDrawer?.();
    },
    afterLeave: () => {
      if (document.getElementById('filter-drawer')?.classList.contains('open')) window.toggleFilterDrawer?.();
    },
  },
  {
    target: '.map-mode-toggle',
    padding: 10,
    mascotKey: 'controlman',
    headline: 'MAP MODES',
    body: '+ Report is for logging issues, Timeline shows machine history, and Wiki opens machine-specific knowledge.',
    beforeShow: () => window.setMapMode?.('log'),
  },
  {
    target: '#floor-map',
    padding: 10,
    mascotKey: 'controlman',
    headline: 'READ THE FLOOR',
    body: "Rows and presses mirror the plant. Press colors and row summaries show where attention is needed right now.",
  },
  {
    target: '.issue-row .issue-card',
    fallbackTarget: '.issues-section',
    padding: 8,
    mascotKey: 'maintenance',
    headline: 'ISSUE CARDS',
    body: 'The issue log is the work queue. Expand a card to see details, photos, comments, ownership, and history.',
    beforeShow: () => document.querySelector('.issues-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  },
  {
    target: '.issue-row .wf-steps-wrap',
    fallbackTarget: '.issue-row .issue-card',
    padding: 8,
    mascotKey: 'alert',
    headline: 'WORKFLOW STATUS',
    body: 'Status owns the work. Workflow steps show whether the team has been called, accepted, started, and finished.',
    wf: true,
  },
  {
    target: '#export-dropdown-wrap',
    padding: 8,
    mascotKey: 'resolved',
    headline: 'EXPORT & REPLAY',
    body: 'Export the current view when you need a shift handoff. Reopen this tour later from the Demo Mode user menu.',
    beforeShow: () => setTimeout(() => {
      if (!document.getElementById('export-dropdown')?.classList.contains('visible')) window.toggleExportDropdown?.();
    }, 0),
    afterLeave: () => window.closeExportDropdown?.(),
    isLast: true,
  },
];

let _sptStep = 0;

function _sptRunHook(fn) {
  if (typeof fn !== 'function') return;
  try { fn(); }
  catch (err) { console.warn('Tutorial hook failed:', err); }
}

function _sptResolveTarget(step) {
  if (!step) return null;
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  const selectors = [
    mobile ? step.mobileTarget : step.desktopTarget,
    step.target,
    step.fallbackTarget,
  ].filter(Boolean);
  for (const selector of selectors) {
    const target = document.querySelector(selector);
    if (target) return target;
  }
  return null;
}

window.openTutorial = function(step = 0) {
  const overlay = document.getElementById('spotlight-overlay');
  const wrap = document.getElementById('spt-wrap');
  const card = document.getElementById('spt-card');
  if (!overlay || !wrap || !card) {
    console.warn('Tutorial markup is incomplete; skipping spotlight overlay.');
    return;
  }
  _sptStep = step;
  overlay.classList.add('visible');
  wrap.classList.add('visible');
  _renderSptStep();
};

window.closeTutorial = function() {
  _sptRunHook(SPOTLIGHT_STEPS[_sptStep]?.afterLeave);
  localStorage.setItem(TUTORIAL_KEY, '1');
  document.getElementById('spotlight-overlay')?.classList.remove('visible');
  document.getElementById('spt-wrap')?.classList.remove('visible');
  const hl = document.getElementById('spotlight-hl');
  if (hl) { hl.style.transition = 'none'; hl.style.opacity = '0'; hl.classList.remove('active'); }
};

window.tutorialNext = function() {
  if (_sptStep >= SPOTLIGHT_STEPS.length - 1) { window.closeTutorial(); return; }
  _sptRunHook(SPOTLIGHT_STEPS[_sptStep]?.afterLeave);
  _sptStep++;
  _renderSptStep();
};

window.tutorialBack = function() {
  if (_sptStep <= 0) return;
  _sptRunHook(SPOTLIGHT_STEPS[_sptStep]?.afterLeave);
  _sptStep--;
  _renderSptStep();
};

function _renderSptStep() {
  const step = SPOTLIGHT_STEPS[_sptStep];
  if (!step) return;
  _sptRunHook(step.beforeShow);
  const m = step.mascotKey ? MASCOTS[step.mascotKey] : null;
  const accent = m ? m.color : '#3b82f6';

  const accentEl = document.getElementById('spt-accent');
  const mascotEl = document.getElementById('spt-mascot');
  const headEl   = document.getElementById('spt-headline');
  const bodyEl   = document.getElementById('spt-body');
  const progEl   = document.getElementById('spt-progress');
  const nextBtn  = document.getElementById('spt-next');
  const backBtn  = document.getElementById('spt-back');
  const card     = document.getElementById('spt-card');

  if (accentEl) accentEl.style.background = accent;
  card?.style.setProperty('--spt-accent', accent);

  if (mascotEl) {
    let html = '';
    if (m) {
      html = `<div class="spt-mascot-header">
        <div style="line-height:0;flex-shrink:0">${m.svg(48, 48)}</div>
        <div><div class="spt-mascot-name" style="color:${m.color}">${m.name}</div>
        <div class="spt-mascot-tagline">${m.tagline}</div></div>
      </div>`;
    }
    if (step.wf) {
      html += `<div class="spt-wf-area"><div class="spt-wf-vis">
        <div class="spt-wf-step wf-done"><div class="spt-wf-dot"></div><div class="spt-wf-label">Called</div></div>
        <div class="spt-wf-line"></div>
        <div class="spt-wf-step wf-done"><div class="spt-wf-dot"></div><div class="spt-wf-label">Accepted</div></div>
        <div class="spt-wf-line"></div>
        <div class="spt-wf-step wf-active"><div class="spt-wf-dot"></div><div class="spt-wf-label">In Progress</div></div>
        <div class="spt-wf-line pending"></div>
        <div class="spt-wf-step"><div class="spt-wf-dot"></div><div class="spt-wf-label">Finished</div></div>
      </div></div>`;
    }
    mascotEl.innerHTML = html;
  }

  if (headEl) headEl.textContent = step.headline;
  if (bodyEl) bodyEl.textContent = step.body;

  if (progEl) {
    progEl.innerHTML = SPOTLIGHT_STEPS.map((_, i) =>
      `<span class="spt-dot${i === _sptStep ? ' active' : ''}"></span>`
    ).join('');
  }

  if (nextBtn) nextBtn.textContent = step.isLast ? "Let's Go!" : 'Next →';
  if (backBtn) backBtn.style.visibility = _sptStep === 0 ? 'hidden' : 'visible';

  _positionSpotlight(step);
}

function _positionSpotlight(step) {
  const hl    = document.getElementById('spotlight-hl');
  const wrap  = document.getElementById('spt-wrap');
  const cup   = document.getElementById('spt-caret-up');
  const cdown = document.getElementById('spt-caret-down');
  const pad   = step.padding ?? 10;
  const target = _sptResolveTarget(step);

  if (!target) {
    if (hl) { hl.style.transition = 'none'; hl.style.opacity = '0'; hl.classList.remove('active'); }
    if (wrap) { wrap.style.top = '50%'; wrap.style.left = '50%'; wrap.style.transform = 'translate(-50%, -50%)'; }
    if (cup)   cup.style.display   = 'none';
    if (cdown) cdown.style.display = 'none';
    return;
  }

  if (hl) hl.style.transition = '';
  target.scrollIntoView({ behavior: 'smooth', block: step.scrollBlock || 'nearest' });

  setTimeout(() => {
    const r  = target.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const wasHidden = !hl?.classList.contains('active');

    if (hl) {
      if (wasHidden) { hl.style.transition = 'none'; }
      hl.style.top    = `${r.top - pad}px`;
      hl.style.left   = `${r.left - pad}px`;
      hl.style.width  = `${r.width + pad * 2}px`;
      hl.style.height = `${r.height + pad * 2}px`;
      if (wasHidden) { void hl.offsetWidth; hl.style.transition = ''; }
      hl.style.opacity = '1';
      hl.classList.add('active');
    }

    if (!wrap) return;
    const tW  = wrap.offsetWidth || Math.min(300, vw - 24);
    const tH  = document.getElementById('spt-card')?.offsetHeight || 240;
    const gap = 12;
    const left = Math.max(12, Math.min(r.left + r.width / 2 - tW / 2, vw - tW - 12));
    const caretLeft = Math.max(12, Math.min(r.left + r.width / 2 - left - 9, tW - 28));
    const placeBelow = (r.bottom + pad + gap + tH < vh) || (r.top - pad - gap - tH <= 0);

    wrap.style.transform = 'none';
    wrap.style.left = `${left}px`;

    let preferredTop;
    if (placeBelow) {
      preferredTop = r.bottom + pad + gap;
      if (cup)   { cup.style.display   = 'block'; cup.style.left = `${caretLeft}px`; }
      if (cdown)   cdown.style.display = 'none';
    } else {
      preferredTop = r.top - pad - gap - tH;
      if (cdown) { cdown.style.display = 'block'; cdown.style.left = `${caretLeft}px`; }
      if (cup)     cup.style.display   = 'none';
    }
    const clampedTop = Math.max(12, Math.min(vh - tH - 12, preferredTop));
    if (clampedTop !== preferredTop) {
      if (cup)   cup.style.display = 'none';
      if (cdown) cdown.style.display = 'none';
    }
    wrap.style.top = `${clampedTop}px`;
  }, 350);
}

// ── LIGHTBOX ──
let _lbPhotos = [], _lbIndex = 0;

function _formatLightboxPhotoMeta(photo) {
  if (!photo || typeof photo !== 'object') return '';
  const raw = photo.takenAt || photo.uploadedAt || photo.createdAt || photo.timestamp || '';
  if (!raw) return '';
  const d = raw?.toDate ? raw.toDate() : new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const label = photo.takenAt ? 'Taken' : 'Uploaded';
  return `${label}: ${d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function _lbShow(idx) {
  _lbIndex = (idx % _lbPhotos.length + _lbPhotos.length) % _lbPhotos.length;
  const current = _lbPhotos[_lbIndex] || {};
  const src = typeof current === 'string' ? current : (current.url || current.downloadURL || current.dataUrl || '');
  document.getElementById('lightbox-img').src = src;
  const multi = _lbPhotos.length > 1;
  document.getElementById('lightbox-prev').style.display = multi ? '' : 'none';
  document.getElementById('lightbox-next').style.display = multi ? '' : 'none';
  document.getElementById('lightbox-counter').textContent = multi ? `${_lbIndex + 1} / ${_lbPhotos.length}` : '';
  const meta = document.getElementById('lightbox-meta');
  if (meta) meta.textContent = _formatLightboxPhotoMeta(current);
}

window.openLightbox = (indexOrSrc, issueIdOrPhotos) => {
  if (typeof issueIdOrPhotos === 'string') {
    // Called as openLightbox(index, issueId)
    _lbPhotos = (window._issuePhotos && window._issuePhotos[issueIdOrPhotos]) || [];
    _lbIndex = indexOrSrc;
  } else if (Array.isArray(issueIdOrPhotos)) {
    // Legacy array call
    _lbPhotos = issueIdOrPhotos.map(item => typeof item === 'string' ? ({ url: item }) : item).filter(Boolean);
    _lbIndex = indexOrSrc;
  } else {
    // Legacy single-src call
    _lbPhotos = [{ url: indexOrSrc }];
    _lbIndex = 0;
  }
  _lbShow(_lbIndex);
  document.getElementById('lightbox').classList.add('visible');
};

window.closeLightbox = () => {
  document.getElementById('lightbox').classList.remove('visible');
  _lbPhotos = [];
};

window.lightboxNav = dir => _lbShow(_lbIndex + dir);

// Close on backdrop click (not on nav buttons or img)
document.getElementById('lightbox').addEventListener('click', e => {
  if (!e.target.closest('.lightbox-nav') && !e.target.matches('#lightbox-img') && !e.target.matches('.lightbox-close')) {
    closeLightbox();
  }
});

// Keyboard navigation
document.addEventListener('keydown', e => {
  if (!document.getElementById('lightbox').classList.contains('visible')) return;
  if (e.key === 'ArrowRight') lightboxNav(1);
  else if (e.key === 'ArrowLeft') lightboxNav(-1);
  else if (e.key === 'Escape') closeLightbox();
});

// Touch swipe in lightbox
{
  let lx0 = 0, lTracking = false;
  const lb = document.getElementById('lightbox');
  lb.addEventListener('touchstart', e => {
    if (e.target.closest('.lightbox-nav, .lightbox-close')) return;
    lx0 = e.touches[0].clientX; lTracking = true;
  }, { passive: true });
  lb.addEventListener('touchend', e => {
    if (!lTracking) return; lTracking = false;
    const dx = e.changedTouches[0].clientX - lx0;
    if (Math.abs(dx) > 40) lightboxNav(dx < 0 ? 1 : -1);
  }, { passive: true });
}

function fmtShortDate(val) {
  const d = new Date(val + 'T00:00:00');
  if (isNaN(d.getTime())) return val || 'Date';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function updateCalLabel(val, isActive) {
  const lbl = document.getElementById('cal-date-lbl');
  if (!lbl) return;
  lbl.textContent = (isActive && val) ? fmtShortDate(val) : 'Date';
  lbl.style.opacity = isActive ? '1' : '0.45';
}

function updatePeriodTriggerLabel(modeOrValue) {
  const lbl = document.getElementById('period-trigger-label');
  if (!lbl) return;
  const presetLabels = {
    today: 'Today',
    '24h': '24h',
    week: 'Week',
    month: 'Month',
    all: 'All',
  };
  lbl.textContent = presetLabels[modeOrValue] || (modeOrValue ? fmtShortDate(modeOrValue) : 'Date');
}

function closeMobilePeriodMenu() {
  const menu = document.querySelector('.mobile-period-menu');
  if (!menu) return;
  menu.classList.remove('open');
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' '+
    d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
}

function toggleUserDropdown() {
  const pill=document.getElementById('user-pill');
  const dropdown=document.getElementById('user-dropdown');
  closeHeaderQuickMenu();
  const isOpen=dropdown.classList.contains('visible');
  dropdown.classList.toggle('visible',!isOpen);
  pill.classList.toggle('open',!isOpen);
  if (isOpen) {
    document.getElementById('theme-select-grid')?.classList.remove('open');
    document.getElementById('theme-select-toggle')?.classList.remove('open');
    document.getElementById('theme-select-toggle')?.setAttribute('aria-expanded', 'false');
  }
}
const _pillWrap = document.getElementById('user-pill-wrap');
if (_pillWrap) {
  _pillWrap.addEventListener('pointerdown', function(e) {
    if (e.target.closest('#user-pill')) {
      toggleUserDropdown();
      e.stopPropagation();
    }
  });
}

function toggleHeaderQuickMenu() {
  const btn = document.getElementById('header-quick-menu-btn');
  const menu = document.getElementById('header-quick-menu');
  if (!btn || !menu) return;
  closeUserDropdownOnly();
  const isOpen = menu.classList.contains('visible');
  menu.classList.toggle('visible', !isOpen);
  btn.classList.toggle('open', !isOpen);
  btn.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
}

function closeHeaderQuickMenu() {
  const btn = document.getElementById('header-quick-menu-btn');
  const menu = document.getElementById('header-quick-menu');
  if (!btn || !menu) return;
  menu.classList.remove('visible');
  btn.classList.remove('open');
  btn.setAttribute('aria-expanded', 'false');
}

function closeUserMenus() {
  document.getElementById('user-dropdown')?.classList.remove('visible');
  document.getElementById('user-pill')?.classList.remove('open');
  closeHeaderQuickMenu();
  document.getElementById('theme-select-grid')?.classList.remove('open');
  document.getElementById('theme-select-toggle')?.classList.remove('open');
  document.getElementById('theme-select-toggle')?.setAttribute('aria-expanded', 'false');
}

const TOOL_MODAL_ORDER = ['wiki', 'notes', 'todos', 'messages', 'alerts'];
const _toolModalScrollState = {
  wiki: { shellTop: 0 },
  notes: { listTop: 0, editorTop: 0 },
  todos: { listTop: 0 },
  messages: { listTop: 0, threadTop: 0 },
  alerts: { listTop: 0 }
};

function _toolModalCurrentKey() {
  if (document.getElementById('role-alerts-modal')?.classList.contains('visible')) return 'alerts';
  if (document.getElementById('messaging-modal')?.classList.contains('visible')) return 'messages';
  if (document.getElementById('todos-modal')?.classList.contains('visible')) return 'todos';
  if (document.getElementById('press-wiki-modal')?.classList.contains('visible')) return 'wiki';
  if (document.getElementById('notes-editor-modal')?.classList.contains('visible') || document.getElementById('notes-modal')?.classList.contains('visible')) return 'notes';
  return null;
}

function _toolModalHasState(key) {
  switch (key) {
    case 'wiki':
      return Boolean(_pressWikiModalPressId || _pressWikiSelectedPageId || _pressWikiExpandedPageIds?.size || _pressWikiKnownTreeNodeIds?.size);
    case 'notes':
      return Boolean(_notesState.notes.length || _notesState.currentNote?.id || _notesState.activeNoteId || _notesState.view === 'editor' || _notesState.search || _notesState.filter !== 'all' || _notesState.previewMode);
    case 'todos':
      return todosTool.hasState();
    case 'messages':
      return Boolean(_messagingState.conversations.length || _messagingState.activeConversationId || _messagingState.selectedPhoto || _messagingState.selectedDmUid || _messagingState.selectedGroupMembers?.size);
    case 'alerts':
      return Boolean(
        _roleAlertsCache.length ||
        _roleAlertsLoadToken > 0 ||
        document.getElementById('role-alerts-modal')?.classList.contains('visible')
      );
    default:
      return false;
  }
}

function _toolModalCaptureScrollState(key) {
  switch (key) {
    case 'wiki':
      _toolModalScrollState.wiki.shellTop = document.querySelector('#press-wiki-modal .notes-editor-panel')?.scrollTop || 0;
      break;
    case 'notes':
      _toolModalScrollState.notes.listTop = document.querySelector('#notes-list')?.scrollTop || 0;
      _toolModalScrollState.notes.editorTop = document.querySelector('#notes-editor-modal .notes-editor-panel')?.scrollTop || 0;
      break;
    case 'todos':
      _toolModalScrollState.todos.listTop = document.querySelector('#todos-list')?.scrollTop || 0;
      break;
    case 'messages':
      _toolModalScrollState.messages.listTop = document.querySelector('#messaging-conversations-list')?.scrollTop || 0;
      _toolModalScrollState.messages.threadTop = document.querySelector('#messaging-thread-messages')?.scrollTop || 0;
      break;
    case 'alerts':
      _toolModalScrollState.alerts.listTop = document.querySelector('#role-alerts-list')?.scrollTop || 0;
      break;
  }
}

function _toolModalRestoreScrollState(key) {
  const apply = () => {
    switch (key) {
      case 'wiki': {
        const shell = document.querySelector('#press-wiki-modal .notes-editor-panel');
        if (shell) shell.scrollTop = _toolModalScrollState.wiki.shellTop || 0;
        break;
      }
      case 'notes': {
        const list = document.querySelector('#notes-list');
        const editor = document.querySelector('#notes-editor-modal .notes-editor-panel');
        if (list) list.scrollTop = _toolModalScrollState.notes.listTop || 0;
        if (editor) editor.scrollTop = _toolModalScrollState.notes.editorTop || 0;
        break;
      }
      case 'todos': {
        const list = document.querySelector('#todos-list');
        if (list) list.scrollTop = _toolModalScrollState.todos.listTop || 0;
        break;
      }
      case 'messages': {
        const list = document.querySelector('#messaging-conversations-list');
        const thread = document.querySelector('#messaging-thread-messages');
        if (list) list.scrollTop = _toolModalScrollState.messages.listTop || 0;
        if (thread) thread.scrollTop = _toolModalScrollState.messages.threadTop || 0;
        break;
      }
      case 'alerts': {
        const list = document.querySelector('#role-alerts-list');
        if (list) list.scrollTop = _toolModalScrollState.alerts.listTop || 0;
        break;
      }
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(apply));
  setTimeout(apply, 80);
}

async function _closeToolModalByKey(key) {
  switch (key) {
    case 'wiki':
      window.closePressWikiModal?.({ preserveState: true });
      break;
    case 'notes':
      window.closeNotesModal?.({ preserveState: true });
      break;
    case 'todos':
      window.closeTodosModal?.({ preserveState: true });
      break;
    case 'messages':
      window.closeMessagingModal?.({ preserveState: true });
      break;
    case 'alerts':
      window.closeRoleAlertInboxModal?.();
      break;
  }
}

async function _openToolModalByKey(key) {
  const preserveState = _toolModalHasState(key);
  switch (key) {
    case 'wiki':
      await (preserveState
        ? window.openSharedLibraryWiki?.({ preserveState: true })
        : window.openSharedLibraryWiki?.());
      break;
    case 'notes':
      await (preserveState
        ? window.openNotesModal?.({}, { preserveState: true })
        : window.openNotesModal?.());
      break;
    case 'todos':
      await (preserveState
        ? window.openTodosModal?.({ preserveState: true })
        : window.openTodosModal?.());
      break;
    case 'messages':
      preserveState
        ? window.openMessagingModal?.({ preserveState: true })
        : window.openMessagingModal?.();
      break;
    case 'alerts':
      await (preserveState
        ? window.openRoleAlertInboxModal?.({ preserveState: true })
        : window.openRoleAlertInboxModal?.());
      break;
  }
}

async function _cycleToolModal(direction) {
  const currentKey = _toolModalCurrentKey();
  if (!currentKey) return;
  const currentIndex = TOOL_MODAL_ORDER.indexOf(currentKey);
  if (currentIndex < 0) return;
  const nextKey = TOOL_MODAL_ORDER[(currentIndex + direction + TOOL_MODAL_ORDER.length) % TOOL_MODAL_ORDER.length];
  if (!nextKey || nextKey === currentKey) return;
  _toolModalCaptureScrollState(currentKey);
  await _closeToolModalByKey(currentKey);
  await _openToolModalByKey(nextKey);
  _toolModalRestoreScrollState(nextKey);
}

function _handleToolModalShellClick(event) {
  const trigger = event?.target?.closest?.('[data-shell-action="cycle-tool-modal"]');
  if (!trigger) return false;
  event.preventDefault();
  event.stopPropagation();
  void _cycleToolModal(String(trigger.dataset.shellValue || '').toLowerCase() === 'prev' ? -1 : 1);
  return true;
}

function _bindToolModalShellNavigation() {
  const bindings = [
    ['press-wiki-modal'],
    ['notes-phone-frame'],
    ['notes-editor-frame'],
    ['todos-frame'],
    ['messaging-modal'],
    ['role-alerts-modal']
  ];
  bindings.forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.toolModalShellBound === '1') return;
    el.dataset.toolModalShellBound = '1';
    el.addEventListener('click', _handleToolModalShellClick);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bindToolModalShellNavigation, { once: true });
} else {
  _bindToolModalShellNavigation();
}

function closeUserDropdownOnly() {
  document.getElementById('user-dropdown')?.classList.remove('visible');
  document.getElementById('user-pill')?.classList.remove('open');
  document.getElementById('theme-select-grid')?.classList.remove('open');
  document.getElementById('theme-select-toggle')?.classList.remove('open');
  document.getElementById('theme-select-toggle')?.setAttribute('aria-expanded', 'false');
}

function handleShellAction(action, value, trigger, event) {
  switch (action) {
    case 'go-home':
      closeHeaderQuickMenu();
      closeUserMenus();
      closeSortDropdown();
      window.closeExportDropdown?.();
      window.closeMessagingModal?.();
      window.closePressWikiModal?.();
      window.closeNotesModal?.();
      window.closeTodosModal?.();
      window.closeExportModal?.();
      window.closeRoleAlertInboxModal?.();
      if (typeof closeMiniCard === 'function') closeMiniCard();
      window.clearMachineBreadcrumb?.();
      window.setMapMode?.('log');
      startListener();
      refreshVisibleData();
      break;
    case 'open-messages':
      closeHeaderQuickMenu();
      closeUserMenus();
      window.openMessagingModal?.();
      break;
    case 'open-shared-library':
      closeHeaderQuickMenu();
      closeUserMenus();
      window.openSharedLibraryWiki?.();
      break;
    case 'open-notes-modal':
      closeHeaderQuickMenu();
      closeUserMenus();
      window.openNotesModal?.();
      break;
    case 'open-todos-modal':
      closeHeaderQuickMenu();
      closeUserMenus();
      window.openTodosModal?.();
      break;
    case 'open-role-alerts':
      closeHeaderQuickMenu();
      closeUserMenus();
      window.openRoleAlertInboxModal?.();
      break;
    case 'open-role-prefs':
      closeUserMenus();
      window.openRolePreferencesModal?.();
      break;
    case 'open-tutorial':
      closeUserMenus();
      window.openTutorial?.();
      break;
    case 'toggle-plant-dropdown':
      window.togglePlantDropdown?.();
      break;
    case 'open-store':
      closeUserMenus();
      window.openStoreModal?.();
      break;
    case 'open-theme-editor':
      window.openThemeEditor?.();
      break;
    case 'toggle-game-drawer':
      closeUserMenus();
      if (String(value) === 'false') window.toggleGameDrawer?.(false);
      else window.toggleGameDrawer?.();
      break;
    case 'set-period':
      window.setPeriod?.(value);
      break;
    case 'set-scope':
      window.setScope?.(value);
      break;
    case 'toggle-filter-drawer':
      window.toggleFilterDrawer?.();
      break;
    case 'clear-all-filters':
      window.clearAllFilters?.();
      break;
    case 'toggle-stat-filter':
      window.toggleStatFilter?.(value);
      break;
    case 'set-shift-filter':
      window.setShiftFilter?.(value);
      break;
    case 'toggle-shift-dropdown':
      window.toggleShiftDropdown?.();
      break;
    case 'set-map-mode':
      window.setMapMode?.(value);
      completeDemoGuideStep('floor');
      break;
    case 'set-issue-row-scope':
      window.setIssueRowScope?.(value);
      break;
    case 'toggle-sort-dropdown':
      window.toggleSortDropdown?.();
      break;
    case 'toggle-header-quick-menu':
      toggleHeaderQuickMenu();
      break;
    case 'cycle-tool-modal':
      void _cycleToolModal(String(value || '').toLowerCase() === 'prev' ? -1 : 1);
      break;
    case 'toggle-export-dropdown':
      window.toggleExportDropdown?.();
      break;
    case 'open-export-modal':
      window.closeExportDropdown?.();
      window.openExportModal?.();
      break;
    case 'download-excel':
      window.closeExportDropdown?.();
      window.downloadExcel?.();
      break;
    case 'clear-machine-breadcrumb':
      window.clearMachineBreadcrumb?.();
      break;
    case 'close-messaging-sheets':
      window.hideMessagingSheets?.();
      break;
    default:
      return false;
  }
  if (event) event.preventDefault();
  return true;
}

window.handleShellAction = handleShellAction;

document.addEventListener('click', e => {
  const trigger = e.target.closest?.('[data-shell-action]');
  if (!trigger) return;
  handleShellAction(trigger.dataset.shellAction, trigger.dataset.shellValue, trigger, e);
});
document.addEventListener('click', e => {
  const guideReset = e.target.closest?.('[data-demo-guide-reset]');
  if (guideReset) {
    e.preventDefault();
    resetDemoGuideProgress();
    return;
  }
  const guideAction = e.target.closest?.('[data-demo-guide-action]');
  if (guideAction) {
    e.preventDefault();
    runDemoGuideAction(guideAction.dataset.demoGuideAction, guideAction.dataset.demoGuideKey || '');
    return;
  }
  const guidePrev = e.target.closest?.('[data-demo-guide-prev]');
  if (guidePrev) {
    e.preventDefault();
    window.currentDemoStepIndex = (window.currentDemoStepIndex - 1 + DEMO_GUIDE_STEPS.length) % DEMO_GUIDE_STEPS.length;
    renderDemoGuideProgress();
    return;
  }
  const guideNext = e.target.closest?.('[data-demo-guide-next]');
  if (guideNext) {
    e.preventDefault();
    window.currentDemoStepIndex = (window.currentDemoStepIndex + 1) % DEMO_GUIDE_STEPS.length;
    renderDemoGuideProgress();
    return;
  }
  const onboardingSubmit = e.target.closest?.('#demo-onboarding-submit-btn');
  if (onboardingSubmit) {
    e.preventDefault();
    handleOnboardingSubmit(onboardingSubmit);
    return;
  }
  const guideToggle = e.target.closest?.('[data-demo-guide-toggle]');
  if (guideToggle) {
    e.preventDefault();
    const guide = document.getElementById('demo-guide');
    if (!guide) return;
    const collapsed = !guide.classList.contains('collapsed');
    guide.classList.toggle('collapsed', collapsed);
    guideToggle.textContent = collapsed ? 'Show' : 'Hide';
    guideToggle.setAttribute('aria-expanded', String(!collapsed));
  }
});
document.addEventListener('click', e => {
  const wrap=document.getElementById('user-pill-wrap');
  if (wrap && !wrap.contains(e.target)) {
    closeUserDropdownOnly();
  }
});
document.addEventListener('click', e => {
  const wrap = document.getElementById('header-quick-wrap');
  if (wrap && !wrap.contains(e.target)) {
    closeHeaderQuickMenu();
  }
});
const signoutBtn=document.getElementById('signout-btn');
if (signoutBtn) signoutBtn.addEventListener('click', doSignOut);

// ── THEME SELECTION ──
const THEME_OPTIONS = BUILT_IN_THEME_DEFS.map(theme => ({
  key: theme.key,
  label: theme.label,
  mode: theme.mode,
  colors: theme.colors
}));
const THEME_KEYS = THEME_OPTIONS.map(theme => theme.key);

// Mirror of CSS vars for each built-in theme (used by the theme editor to seed pickers)
const THEME_VARS_MAP = BUILT_IN_THEME_DEFS.reduce((acc, theme) => {
  acc[theme.key] = { ...theme.vars };
  return acc;
}, {});

function getPublishedBuiltInThemeKeys() {
  const publishedKeys = new Set(
    (Array.isArray(storeItems) ? storeItems : [])
      .filter(item => item?.type === 'theme' && item?.isActive !== false && item?.themeKey)
      .map(item => item.themeKey)
  );
  if (!publishedKeys.size) {
    THEME_OPTIONS.forEach(theme => publishedKeys.add(theme.key));
  }
  return publishedKeys;
}

function getThemeCatalog() {
  const publishedBuiltInThemeKeys = getPublishedBuiltInThemeKeys();
  const builtIns = THEME_OPTIONS
    .filter(theme => publishedBuiltInThemeKeys.has(theme.key))
    .map((theme, idx) => {
      const storeItem = getStoreItemForTheme(theme.key);
      const isFree = !storeItem || Number(storeItem?.price || 0) <= 0;
      const vars = { ...(THEME_VARS_MAP[theme.key] || {}) };
      return {
        key: theme.key,
        source: 'builtin',
        label: theme.label,
        shortLabel: themeLabelSansIcon(theme.label),
        colors: normalizeThemeColors(theme.colors, vars),
        vars,
        mode: theme.mode,
        storeItemId: storeItem?.id || null,
        sortOrder: Number(storeItem?.order ?? 9999),
        price: Math.max(0, Number(storeItem?.price || 0)),
        isFree,
        isOwned: isFree || !storeItem || isItemUnlocked(storeItem.id),
      };
    });

  const storeCustomThemes = storeItems
    .filter(item => item.type === 'theme' && item.isActive !== false && !item.themeKey && item.customVars)
    .map(item => {
      const vars = normalizeThemeVars(item.customVars);
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
        price: Math.max(0, Number(item.price || 0)),
        isFree: Number(item.price || 0) <= 0,
        isOwned: Number(item.price || 0) <= 0 || isItemUnlocked(item.id),
      };
    });

  const savedCustomThemesRaw = _loadCustomThemes().customThemes;
  const savedCustomThemes = (Array.isArray(savedCustomThemesRaw) ? savedCustomThemesRaw : [])
    .slice()
    .reverse()
    .filter(theme => theme && typeof theme === 'object')
    .map((theme, idx) => {
      const vars = normalizeThemeVars(theme.vars || {});
      return {
        key: `custom_${theme.id}`,
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
        isOwned: true,
      };
    })
    .filter(theme => !!theme.key && !!theme.vars);

  return [...builtIns, ...savedCustomThemes, ...storeCustomThemes]
    .filter(theme => theme && typeof theme === 'object' && !!theme.key)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
    .map(theme => ({ ...theme, colors: normalizeThemeColors(theme.colors, theme.vars) }));
}

function getThemeCatalogEntry(key) {
  return getThemeCatalog().find(theme => theme.key === key) || null;
}

function renderThemeSwatches(theme) {
  return getThemePreviewColors(theme)
    .map(color => `<span class="te-saved-swatch" style="background:${esc(color)}"></span>`)
    .join('');
}

// ── THEME EDITOR ──
const CUSTOM_THEMES_KEY = 'apTracker_customThemes';

let _appliedCustomVarKeys = new Set();


function clearCustomThemeVars() {
  clearThemeVarsFromEngine([..._appliedCustomVarKeys]);
  _appliedCustomVarKeys = new Set();
}

function applyCustomThemeVars(vars) {
  const normalized = applyThemeVarsFromEngine(vars, {
    themeKeys: THEME_KEYS,
    mode: inferThemeModeFromVars(vars),
    clearExtraKeys: [..._appliedCustomVarKeys]
  });
  _appliedCustomVarKeys = new Set(Object.keys(normalized || {}));
  return normalized;
}

function _teSetVarAndSync(cssVar, val) {
  _teCurrentVars = _teCurrentVars || {};
  if (val === undefined || val === null) {
    delete _teCurrentVars[cssVar];
  } else {
    _teCurrentVars[cssVar] = val;
  }
  
  // Sync legacy -> modern
  const modernKey = THEME_TOKEN_MAP[cssVar] || THEME_SOFT_TOKEN_MAP[cssVar];
  if (modernKey) {
    if (val === undefined || val === null) {
      delete _teCurrentVars[modernKey];
    } else {
      _teCurrentVars[modernKey] = val;
    }
    const inputEl = document.getElementById(`te-var-${modernKey.slice(2)}`);
    if (inputEl) {
      inputEl.value = val || '';
      const colorEl = inputEl.nextElementSibling;
      if (colorEl && colorEl.classList.contains('te-var-color')) {
        const nextHex = _teToHexIfColor(val);
        colorEl.style.visibility = nextHex ? 'visible' : 'hidden';
        if (nextHex) colorEl.value = nextHex;
      }
    }
  }
  
  // Sync modern -> legacy
  const legacyKey = Object.entries(THEME_TOKEN_MAP).find(([, token]) => token === cssVar)?.[0] ||
                    Object.entries(THEME_SOFT_TOKEN_MAP).find(([, token]) => token === cssVar)?.[0];
  if (legacyKey) {
    if (val === undefined || val === null) {
      delete _teCurrentVars[legacyKey];
    } else {
      _teCurrentVars[legacyKey] = val;
    }
    const picker = document.getElementById(`te-color-${legacyKey.slice(2)}`);
    if (picker) {
      picker.value = _teToHexIfColor(val) || '#000000';
      const labelId = picker.id.replace('te-color-', 'te-hex-');
      const labelEl = document.getElementById(labelId);
      if (labelEl) labelEl.textContent = val || '';
    }
    const inputEl = document.getElementById(`te-var-${legacyKey.slice(2)}`);
    if (inputEl) {
      inputEl.value = val || '';
      const colorEl = inputEl.nextElementSibling;
      if (colorEl && colorEl.classList.contains('te-var-color')) {
        const nextHex = _teToHexIfColor(val);
        colorEl.style.visibility = nextHex ? 'visible' : 'hidden';
        if (nextHex) colorEl.value = nextHex;
      }
    }
  }
}

function _teGetAllVariables() {
  const vars = new Set(THEME_EDITOR_CORE_VARS);

  Object.values(THEME_VARS_MAP).forEach(themeVars => {
    Object.keys(themeVars || {}).forEach(k => { if (k.startsWith('--')) vars.add(k); });
  });

  getThemeCatalog().forEach(theme => {
    Object.keys(theme?.vars || {}).forEach(k => { if (k.startsWith('--')) vars.add(k); });
  });

  Array.from(document.styleSheets || []).forEach(sheet => {
    try {
      Array.from(sheet.cssRules || []).forEach(rule => {
        const style = rule.style;
        if (!style) return;
        Array.from(style).forEach(prop => {
          if (String(prop).startsWith('--')) vars.add(prop);
        });
      });
    } catch (e) { /* ignore inaccessible stylesheet */ }
  });

  const rootStyle = getComputedStyle(document.documentElement);
  for (let i = 0; i < rootStyle.length; i++) {
    const prop = rootStyle[i];
    if (String(prop).startsWith('--')) vars.add(prop);
  }

  const core = THEME_EDITOR_CORE_VARS.filter(v => vars.has(v));
  const other = Array.from(vars).filter(v => !THEME_EDITOR_CORE_VARS.includes(v)).sort((a, b) => a.localeCompare(b));
  return [...core, ...other];
}

function _teToHexIfColor(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) return '#' + v.slice(1).split('').map(ch => ch + ch).join('').toLowerCase();
  const probe = document.createElement('span');
  probe.style.color = '';
  probe.style.color = v;
  if (!probe.style.color) return null;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return null;
  const toHex = (n) => Number(n).toString(16).padStart(2, '0');
  return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
}

function normalizeCustomThemeStorage(data = {}) {
  const customThemes = (Array.isArray(data.customThemes) ? data.customThemes : [])
    .filter(theme => theme && typeof theme === 'object')
    .map(theme => ({
      ...theme,
      id: String(theme.id || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      name: String(theme.name || 'Custom Theme'),
      vars: normalizeThemeVars(theme.vars || {}),
      createdAt: Number(theme.createdAt || Date.now())
    }));
  const activeCustomId = data.activeCustomId && customThemes.some(theme => theme.id === data.activeCustomId)
    ? data.activeCustomId
    : null;
  return { customThemes, activeCustomId };
}

function _loadCustomThemes() {
  try { return normalizeCustomThemeStorage(JSON.parse(localStorage.getItem(CUSTOM_THEMES_KEY) || '{"customThemes":[],"activeCustomId":null}')); }
  catch(e) { return normalizeCustomThemeStorage(); }
}

function _saveCustomThemesStorage(data) {
  const normalized = normalizeCustomThemeStorage(data);
  try { localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(normalized)); } catch(e) {}
  _syncThemePrefsToFirestore();
  return normalized;
}

let _themePrefsSyncTimer = null;
let _lastThemePrefsSyncSig = null;

function _themePrefsPayloadSignature(uid, payload) {
  return `${uid}:${JSON.stringify(payload)}`;
}

function _syncThemePrefsToFirestore() {
  if (!currentUser) return;
  try {
    const uid = currentUser.uid;
    const activeTheme = readSavedTheme('midnight');
    const { customThemes } = _loadCustomThemes();
    const payload = { activeTheme, customThemes };
    const signature = _themePrefsPayloadSignature(uid, payload);
    if (signature === _lastThemePrefsSyncSig) return;
    if (_themePrefsSyncTimer) clearTimeout(_themePrefsSyncTimer);
    _themePrefsSyncTimer = setTimeout(() => {
      const persist = shouldUseSqlBootstrap()
        ? dataApi.updateCurrentUserContext({ themePrefs: payload })
        : setDoc(doc(db, 'users', uid), {
            themePrefs: payload
          }, { merge: true });
      Promise.resolve(persist)
        .then(() => { _lastThemePrefsSyncSig = signature; })
        .catch(() => {});
    }, 350);
  } catch(e) {}
}

function _applyFirestoreThemePrefs(prefs) {
  if (!prefs) return;
  try {
    if (Array.isArray(prefs.customThemes)) {
      const local = _loadCustomThemes();
      const normalized = normalizeCustomThemeStorage({ ...local, customThemes: prefs.customThemes });
      try { localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(normalized)); } catch(e) {}
      renderAppearanceCustomThemes();
    }
    if (prefs.activeTheme) applyTheme(prefs.activeTheme);
  } catch(e) {}
}

function renderThemeChoices() {
  const grid = document.getElementById('theme-select-grid');
  if (!grid) return;
  const availableThemes = getThemeCatalog().filter(theme => theme.isOwned);
  grid.innerHTML = availableThemes.map(theme => {
    const [bg, accent, textColor] = getThemePreviewColors(theme);
    return `
    <button class="theme-choice" type="button" data-theme="${theme.key}" title="${theme.label}" aria-label="${theme.label}" aria-pressed="false">
      <span class="theme-choice-name">${esc(theme.shortLabel || themeLabelSansIcon(theme.label))}</span>
      <span class="theme-choice-sub">${esc(theme.isFree ? (theme.source === 'saved-custom' ? 'Saved theme' : 'Always available') : 'Owned unlock')}</span>
      <span class="theme-choice-swatches">
        <span class="theme-swatch" style="background:${bg}"></span>
        <span class="theme-swatch" style="background:${accent}"></span>
        <span class="theme-swatch" style="background:${textColor}"></span>
      </span>
    </button>`;
  }).join('');
}

function renderAppearanceCustomThemes() {
  const list = document.getElementById('appearance-custom-list');
  const empty = document.getElementById('appearance-custom-empty');
  if (!list || !empty) return;
  const data = _loadCustomThemes();
  if (!data.customThemes.length) {
    list.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = '';
  data.customThemes.slice().reverse().forEach(theme => {
    const item = document.createElement('div');
    item.className = 'appearance-custom-item';
    const safeName = esc(theme.name);
    item.innerHTML = `
      <span class="te-saved-name">${safeName}</span>
      <span class="te-saved-swatches">${renderThemeSwatches(theme)}</span>
      <button class="te-saved-apply" data-id="${theme.id}">Apply</button>
      <button class="te-saved-delete" data-id="${theme.id}" title="Delete">🗑</button>`;
    list.appendChild(item);
  });
}

function updateActiveThemeChoice(theme) {
  const savedTheme = theme ?? readSavedTheme('midnight');
  const currentTheme = getThemeCatalogEntry(savedTheme);
  const currentLabel = document.getElementById('theme-select-current');
  if (currentLabel) {
    currentLabel.textContent = currentTheme?.shortLabel || 'Custom';
  }
  document.querySelectorAll('.theme-choice').forEach(btn => {
    const isActive = btn.dataset.theme === savedTheme;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.appearance-custom-item').forEach(item => {
    const applyBtn = item.querySelector('.te-saved-apply');
    item.classList.toggle('active', savedTheme === `custom_${applyBtn?.dataset?.id || ''}`);
  });
}

document.getElementById('theme-select-toggle')?.addEventListener('click', () => {
  const grid = document.getElementById('theme-select-grid');
  const toggle = document.getElementById('theme-select-toggle');
  if (!grid || !toggle) return;
  renderThemeChoices();
  const nextOpen = !grid.classList.contains('open');
  grid.classList.toggle('open', nextOpen);
  toggle.classList.toggle('open', nextOpen);
  toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
});

document.getElementById('theme-select-grid')?.addEventListener('click', e => {
  const btn = e.target.closest('.theme-choice');
  if (!btn?.dataset?.theme) return;
  applyTheme(btn.dataset.theme);
});

function updateThemeModeUI() {
  const isDark = (document.body.dataset.themeMode || 'dark') !== 'light';
  const toggle = document.getElementById('theme-quick-toggle');
  const label = document.getElementById('ud-mode-label');
  const moonIcon = document.getElementById('ud-moon-icon');
  const sunIcon = document.getElementById('ud-sun-icon');
  if (toggle) toggle.classList.toggle('on', isDark);
  if (label) label.textContent = isDark ? 'Dark mode' : 'Light mode';
  if (moonIcon) moonIcon.style.display = isDark ? '' : 'none';
  if (sunIcon) sunIcon.style.display = isDark ? 'none' : '';
}

function applyTheme(theme) {
  const legacyThemeMap = { dark: 'midnight', light: 'arctic' };
  const resolvedTheme = legacyThemeMap[theme] || theme;
  if (resolvedTheme && resolvedTheme.startsWith(STORE_THEME_ITEM_PREFIX)) {
    const itemId = resolvedTheme.slice(STORE_THEME_ITEM_PREFIX.length);
    const item = storeItems.find(i => i.id === itemId && i.type === 'theme' && i.isActive !== false);
    if (item?.customVars) {
      clearCustomThemeVars();
      removeThemeClasses(THEME_KEYS);
      applyCustomThemeVars(item.customVars);
      document.body.dataset.themeMode = inferThemeModeFromVars(item.customVars);
      saveThemeSelection(resolvedTheme);
      updateActiveThemeChoice(null);
      _syncThemePrefsToFirestore();
      updateThemeModeUI();
      return;
    }
  }
  // Handle custom theme keys (stored as "custom_<id>")
  if (resolvedTheme && resolvedTheme.startsWith('custom_')) {
    const data = _loadCustomThemes();
    const found = data.customThemes.find(t => 'custom_' + t.id === resolvedTheme);
    if (found) {
      removeThemeClasses(THEME_KEYS);
      applyCustomThemeVars(found.vars);
      document.body.dataset.themeMode = 'dark';
      saveThemeSelection(resolvedTheme);
      updateActiveThemeChoice(null);
      _syncThemePrefsToFirestore();
      updateThemeModeUI();
      return;
    }
  }
  if (resolvedTheme && resolvedTheme.startsWith('storetheme_')) {
    const storeTheme = getThemeCatalogEntry(resolvedTheme);
    if (storeTheme) {
      if (!storeTheme.isOwned) {
        openStoreModal();
        return;
      }
      removeThemeClasses(THEME_KEYS);
      applyCustomThemeVars(storeTheme.vars || {});
      document.body.dataset.themeMode = storeTheme.mode || 'dark';
      saveThemeSelection(resolvedTheme);
      updateActiveThemeChoice(resolvedTheme);
      _syncThemePrefsToFirestore();
      updateThemeModeUI();
      return;
    }
  }
  clearCustomThemeVars(); // strip any inline custom vars before applying a CSS class theme
  const normalizedTheme = THEME_KEYS.includes(resolvedTheme) ? resolvedTheme : 'midnight';
  if (isThemeLocked(normalizedTheme)) {
    openStoreModal();
    return;
  }
  const selectedTheme = THEME_OPTIONS.find(opt => opt.key === normalizedTheme) || THEME_OPTIONS[0];
  applyThemeVarsFromEngine(THEME_VARS_MAP[normalizedTheme] || THEME_VARS_MAP.midnight || {}, {
    themeKeys: THEME_KEYS,
    classThemeKey: normalizedTheme,
    mode: selectedTheme.mode,
    clearExtraKeys: [..._appliedCustomVarKeys]
  });
  _appliedCustomVarKeys = new Set();
  updateActiveThemeChoice(normalizedTheme);
  saveThemeSelection(normalizedTheme);
  _syncThemePrefsToFirestore();
  updateThemeModeUI();
}
window.applyTheme = applyTheme;

// Load saved theme (handles both built-in keys and custom_<id>)
try {
  const saved = readSavedTheme('');
  if (saved && saved.startsWith('custom_')) {
    const data = _loadCustomThemes();
    const found = data.customThemes.find(t => 'custom_' + t.id === saved);
    if (found) { removeThemeClasses(THEME_KEYS); applyCustomThemeVars(found.vars); document.body.dataset.themeMode = 'dark'; updateActiveThemeChoice(null); }
    else applyTheme('midnight');
  } else if (saved && saved.startsWith('storetheme_')) {
    applyTheme(saved);
  } else {
    applyTheme(saved || 'midnight');
  }
} catch(e) { applyTheme('midnight'); }
updateThemeModeUI();
renderThemeChoices();
renderAppearanceCustomThemes();
updateActiveThemeChoice(readSavedTheme('midnight'));


document.getElementById('appearance-custom-list')?.addEventListener('click', e => {
  const applyBtn = e.target.closest('.te-saved-apply');
  const deleteBtn = e.target.closest('.te-saved-delete');
  if (applyBtn?.dataset?.id) {
    applyTheme('custom_' + applyBtn.dataset.id);
    updateActiveThemeChoice(null);
    renderThemeChoices();
    renderStoreModal();
    return;
  }
  if (deleteBtn?.dataset?.id) {
    const d = _loadCustomThemes();
    d.customThemes = d.customThemes.filter(t => t.id !== deleteBtn.dataset.id);
    if (d.activeCustomId === deleteBtn.dataset.id) d.activeCustomId = null;
    _saveCustomThemesStorage(d);
    if (readSavedTheme('') === 'custom_' + deleteBtn.dataset.id) applyTheme('midnight');
    renderAppearanceCustomThemes();
    renderThemeChoices();
    renderStoreModal();
    updateActiveThemeChoice(readSavedTheme('midnight'));
  }
});

document.getElementById('theme-quick-toggle')?.addEventListener('click', () => {
  const mode = document.body.dataset.themeMode || 'dark';
  const targetMode = mode === 'light' ? 'dark' : 'light';
  const ownedThemes = getThemeCatalog().filter(theme => theme?.isOwned);
  const preferredThemeKey = targetMode === 'light' ? 'arctic' : 'midnight';
  const targetTheme = ownedThemes.find(theme => theme.key === preferredThemeKey)
    || ownedThemes.find(theme => theme.mode === targetMode);

  if (targetTheme?.key) {
    applyTheme(targetTheme.key);
    return;
  }

  // Fallback: still flip mode even if no owned theme exists in the target mode.
  document.body.dataset.themeMode = targetMode;
  updateThemeModeUI();
  _syncThemePrefsToFirestore();
});

window.openAppearanceModal = function() {
  document.getElementById('user-dropdown').classList.remove('visible');
  document.getElementById('user-pill').classList.remove('open');
  renderThemeChoices();
  renderAppearanceCustomThemes();
  updateActiveThemeChoice(readSavedTheme('midnight'));
  document.getElementById('appearance-modal').classList.add('visible');
  document.body.classList.add('appearance-open');
};

window.closeAppearanceModal = function() {
  document.getElementById('appearance-modal').classList.remove('visible');
  document.body.classList.remove('appearance-open');
};

// ── THEME EDITOR (modal interaction) ──
let _teCurrentVars = null;
let _tePrevThemeKey = null;
let _teEditingId = null;
let _teIgnoreBackdropClickUntil = 0;
let _teColorPickerInteracting = false;
let _teColorPickerPointerActive = false;

function _teQueueColorPickerInteractionRelease(delay = 250) {
  setTimeout(() => {
    if (_teColorPickerPointerActive) return;
    _teColorPickerInteracting = false;
  }, delay);
}

const _teHandleColorPickerPointerRelease = () => {
  if (!_teColorPickerInteracting && !_teColorPickerPointerActive) return;
  _teColorPickerPointerActive = false;
  _teIgnoreBackdropClickUntil = Math.max(_teIgnoreBackdropClickUntil, Date.now() + 1200);
  _teQueueColorPickerInteractionRelease(250);
};

document.addEventListener('pointerup', _teHandleColorPickerPointerRelease, true);
document.addEventListener('pointercancel', _teHandleColorPickerPointerRelease, true);
document.addEventListener('touchend', _teHandleColorPickerPointerRelease, true);
document.addEventListener('touchcancel', _teHandleColorPickerPointerRelease, true);

const VAR_GROUPS = {
  "Core Backgrounds": ['--color-bg', '--color-surface', '--color-surface-raised', '--color-border', '--bg', '--bg2', '--bg3', '--border'],
  "Typography": ['--color-text', '--color-text-muted', '--color-text-subtle', '--text', '--text2', '--text3'],
  "Accents & Focus": ['--color-accent', '--color-accent-strong', '--focus-ring', '--accent', '--accent2', '--accent-glow'],
  "Alert States": ['--color-success', '--color-danger', '--color-info', '--color-warning', '--green', '--red', '--blue', '--yellow'],
  "Badge/Mascot Colors": ['--color-orange', '--color-purple', '--color-teal', '--color-babyblue', '--orange', '--purple', '--teal', '--babyblue'],
  "Soft Alert Backdrops": [
    '--color-success-soft',
    '--color-danger-soft',
    '--color-info-soft',
    '--color-warning-soft',
    '--color-orange-soft',
    '--color-purple-soft',
    '--color-teal-soft',
    '--color-babyblue-soft',
    '--green-dim',
    '--red-dim',
    '--blue-dim',
    '--yellow-dim',
    '--orange-dim',
    '--purple-dim',
    '--teal-dim',
    '--babyblue-dim'
  ]
};

const SVG_PRESETS = {
  grid: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" opacity="0.1"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--color-accent, #f97316)" stroke-width="0.5"/></svg>`,
  dots: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" opacity="0.15"><circle cx="2" cy="2" r="1" fill="var(--color-accent, #f97316)"/></svg>`,
  scanlines: `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" opacity="0.08"><rect width="4" height="2" fill="var(--color-text, #ffffff)"/><rect y="2" width="4" height="2" fill="transparent"/></svg>`,
  diagonal: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" opacity="0.05"><path d="M 0 40 L 40 0 M -10 10 L 10 -10 M 30 50 L 50 30" fill="none" stroke="var(--color-text, #ffffff)" stroke-width="1"/></svg>`
};

function renderAppearanceThemeGrid() {
  const grid = document.getElementById('appearance-theme-grid');
  if (!grid) return;
  const availableThemes = getThemeCatalog().filter(theme => theme.isOwned && theme.source === 'builtin');
  const activeSelection = readSavedTheme('midnight');
  
  grid.innerHTML = availableThemes.map(theme => {
    const [bg, accent, textColor] = getThemePreviewColors(theme);
    const isActive = theme.key === activeSelection;
    const nameOnly = theme.shortLabel || themeLabelSansIcon(theme.label);
    
    return `
      <div class="store-theme-card ${isActive ? 'stc-active' : ''}" role="button" onclick="applyAppearanceTheme('${theme.key}')">
        <div class="stc-preview" style="--stc-bg:${bg}; --stc-accent:${accent}; --stc-text:${textColor}">
          <div class="stc-preview-bg"></div>
          <div class="stc-preview-stripe"></div>
          <div class="stc-preview-ui">
            <!-- Header -->
            <div class="stc-ui-header" style="background:${accent}25; border-bottom: 1.5px solid ${textColor}15;">
              <div class="stc-ui-dot stc-ui-dot-sm" style="background:${accent}"></div>
              <div class="stc-ui-line-sm" style="background:${textColor}; opacity: 0.6; width: 45%;"></div>
            </div>
            <!-- Cards List -->
            <div class="stc-ui-body">
              <div class="stc-ui-card" style="background:${textColor}0a; border: 1px solid ${textColor}15;">
                <div class="stc-ui-row">
                  <div class="stc-ui-dot stc-ui-dot-sm" style="background:${accent}"></div>
                  <div class="stc-ui-line-sm" style="background:${textColor}; opacity: 0.8; width: 55%;"></div>
                </div>
                <div class="stc-ui-line-sm" style="background:${textColor}; opacity: 0.35; width: 85%;"></div>
              </div>
              <div class="stc-ui-card" style="background:${textColor}05; border: 1px solid ${textColor}0c; opacity: 0.8;">
                <div class="stc-ui-row">
                  <div class="stc-ui-line-sm" style="background:${textColor}; opacity: 0.5; width: 35%;"></div>
                </div>
              </div>
            </div>
            <!-- Navigation -->
            <div class="stc-ui-nav" style="background:${bg}; border-top: 1.5px solid ${textColor}15;">
              <div class="stc-ui-dot stc-ui-dot-sm" style="background:${accent}"></div>
              <div class="stc-ui-dot stc-ui-dot-sm" style="background:${textColor}; opacity: 0.3;"></div>
              <div class="stc-ui-dot stc-ui-dot-sm" style="background:${textColor}; opacity: 0.3;"></div>
            </div>
          </div>
          ${isActive ? '<div class="stc-active-check">✓</div>' : ''}
        </div>
        <div class="stc-footer" style="padding:6px 8px;">
          <span class="stc-name" style="font-size:11px;">${esc(nameOnly)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function updateLiveContrastBadge() {
  const display = document.getElementById('te-contrast-display');
  if (!display) return;
  
  const baseKey = document.getElementById('te-base-select')?.value || 'midnight';
  const baseVars = THEME_VARS_MAP[baseKey] || THEME_VARS_MAP.midnight || {};
  
  const bg = _teCurrentVars?.['--color-bg'] || _teCurrentVars?.['--bg'] || baseVars['--color-bg'] || baseVars['--bg'] || '#0d1117';
  const text = _teCurrentVars?.['--color-text'] || _teCurrentVars?.['--text'] || baseVars['--color-text'] || baseVars['--text'] || '#e6edf3';
  
  try {
    const ratio = getContrastRatio(bg, text);
    const pass = ratio >= 4.5;
    display.textContent = `${ratio.toFixed(1)}:1 ${pass ? 'Pass' : 'Fail'}`;
    display.className = `te-contrast-badge ${pass ? 'te-contrast-pass' : 'te-contrast-fail'}`;
    display.title = pass ? 'WCAG 2.0 AA Contrast Compliant' : 'Low Contrast Warning: Text may be hard to read';
  } catch (e) {
    display.textContent = 'N/A';
    display.className = 'te-contrast-badge te-contrast-fail';
  }
}

window.applyAppearanceTheme = function(themeKey) {
  applyTheme(themeKey);
  const baseKey = THEME_KEYS.includes(themeKey) ? themeKey : 'midnight';
  const sel = document.getElementById('te-base-select');
  if (sel) sel.value = baseKey;
  _teCurrentVars = { ...(THEME_VARS_MAP[baseKey] || THEME_VARS_MAP.midnight) };
  
  _teEditingId = null;
  const saveBtn = document.getElementById('te-save-btn');
  if (saveBtn) saveBtn.textContent = '💾 Save';
  const themeNameInput = document.getElementById('te-theme-name');
  if (themeNameInput) themeNameInput.value = '';

  removeThemeClasses(THEME_KEYS);
  applyCustomThemeVars(_teCurrentVars);

  _renderTEVarsList();
  renderAppearanceThemeGrid();
  renderAppearanceCustomThemes();
  
  const svgField = document.getElementById('te-bg-svg-input');
  if (svgField) svgField.value = _teCurrentVars['--bg-svg'] || '';
  updateLiveContrastBadge();
  _teSyncDesignTabFromCurrentVars();
};

window.resetThemeToBase = function() {
  const baseKey = document.getElementById('te-base-select')?.value || 'midnight';
  const base = THEME_VARS_MAP[baseKey];
  if (base) {
    _teCurrentVars = { ...base };
    _teEditingId = null;
    const saveBtn = document.getElementById('te-save-btn');
    if (saveBtn) saveBtn.textContent = '💾 Save';
    const themeNameInput = document.getElementById('te-theme-name');
    if (themeNameInput) themeNameInput.value = '';
    
    const svgField = document.getElementById('te-bg-svg-input');
    if (svgField) svgField.value = _teCurrentVars['--bg-svg'] || '';
    const svgPreset = document.getElementById('te-bg-svg-preset');
    if (svgPreset) {
      const currentSvg = _teCurrentVars['--bg-svg'] || '';
      svgPreset.value = Object.keys(SVG_PRESETS).find(key => SVG_PRESETS[key] === currentSvg) || '';
    }

    applyCustomThemeVars(_teCurrentVars);
    _renderTEVarsList();
    updateLiveContrastBadge();
    showGameToast('↺ Reset variables to base defaults');
    _teSyncDesignTabFromCurrentVars();
  }
};

window.exportCurrentTheme = function() {
  const nameEl = document.getElementById('te-theme-name');
  const name = (nameEl ? nameEl.value.trim() : '') || 'My Custom Theme';
  const dataToExport = {
    name,
    vars: normalizeThemeVars(_teCurrentVars || {})
  };
  try {
    const payload = btoa(JSON.stringify(dataToExport));
    navigator.clipboard.writeText(payload).then(() => {
      showGameToast('📋 Theme code copied to clipboard!');
    }).catch(() => {
      alert(`Here is your theme code:\n\n${payload}`);
    });
  } catch (e) {
    showGameToast('❌ Failed to export theme');
  }
};

window.importThemeCode = function() {
  const code = prompt('Paste your theme code (base64) here:');
  if (!code) return;
  try {
    const parsed = JSON.parse(atob(code.trim()));
    if (!parsed || typeof parsed !== 'object' || !parsed.name || !parsed.vars) {
      alert('Invalid theme code format.');
      return;
    }
    
    const data = _loadCustomThemes();
    const id = 'custom_' + Date.now();
    data.customThemes.push({
      id,
      name: parsed.name,
      vars: normalizeThemeVars(parsed.vars),
      createdAt: Date.now()
    });
    data.activeCustomId = id;
    _saveCustomThemesStorage(data);
    applyTheme('custom_' + id);
    
    _teEditingId = id;
    _teCurrentVars = { ...parsed.vars };
    const themeNameInput = document.getElementById('te-theme-name');
    if (themeNameInput) themeNameInput.value = parsed.name;
    const saveBtn = document.getElementById('te-save-btn');
    if (saveBtn) saveBtn.textContent = '💾 Update';
    
    _renderTEVarsList();
    renderAppearanceThemeGrid();
    renderAppearanceCustomThemes();
    renderThemeChoices();
    renderStoreModal();
    updateLiveContrastBadge();
    _teSyncDesignTabFromCurrentVars();
    
    showGameToast('🎉 Theme imported successfully!');
  } catch (e) {
    alert('Failed to parse theme code. Make sure it was copied correctly.');
  }
};

function _teSyncDesignTabFromCurrentVars() {
  if (!_teCurrentVars) return;
  // Sync color pickers
  const designPickers = document.querySelectorAll('#te-panel-design input[type="color"]');
  designPickers.forEach(picker => {
    const cssVar = picker.dataset.var;
    const currentVal = _teCurrentVars[cssVar] || '';
    picker.value = _teToHexIfColor(currentVal) || '#000000';
    const labelId = picker.id.replace('te-color-', 'te-hex-');
    const labelEl = document.getElementById(labelId);
    if (labelEl) labelEl.textContent = picker.value;
  });
  
  // Sync font pairings
  const fontBtns = document.querySelectorAll('#te-panel-design .te-font-btn');
  const activeFont = _teCurrentVars['--font-body'] || "'Nunito', sans-serif";
  let fontKey = 'sans';
  if (activeFont.includes('Space Grotesk')) fontKey = 'grotesk';
  else if (activeFont.includes('Playfair')) fontKey = 'serif';
  else if (activeFont.includes('Share Tech Mono')) fontKey = 'mono';
  fontBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.font === fontKey);
  });
  
  // Sync border radius
  const radiusBtns = document.querySelectorAll('#te-group-radius .te-btn-grp-opt');
  const activeRadiusVal = _teCurrentVars['--radius-card'] || '14px';
  let radKey = 'md';
  if (activeRadiusVal === '0px') radKey = 'none';
  else if (activeRadiusVal === '6px') radKey = 'sm';
  else if (activeRadiusVal === '22px') radKey = 'lg';
  else if (activeRadiusVal === '36px') radKey = 'full';
  
  const radLabels = { none: 'None', sm: 'Slight', md: 'Rounded', lg: 'Curvy', full: 'Extreme' };
  const radLabelEl = document.getElementById('te-lbl-radius');
  if (radLabelEl) radLabelEl.textContent = radLabels[radKey];
  radiusBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === radKey);
  });
  
  // Sync drop shadows
  const shadowBtns = document.querySelectorAll('#te-group-shadow .te-btn-grp-opt');
  const activeShadow = _teCurrentVars['--shadow-card'] || '0 2px 12px rgba(0,0,0,0.2)';
  let shdKey = 'md';
  if (activeShadow === 'none') shdKey = 'none';
  else if (activeShadow.includes('0.06')) shdKey = 'sm';
  else if (activeShadow.includes('0.22')) shdKey = 'lg';
  else if (activeShadow.includes('color-mix')) shdKey = 'colored';
  
  const shdLabels = { none: 'None', sm: 'Aura', md: 'Elevated', lg: 'Deep', colored: 'Glow' };
  const shdLabelEl = document.getElementById('te-lbl-shadow');
  if (shdLabelEl) shdLabelEl.textContent = shdLabels[shdKey];
  shadowBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === shdKey);
  });
  
  // Sync glassmorphism
  const toggleGlass = document.getElementById('te-toggle-glass');
  const sliderGlass = document.getElementById('te-slider-glass-strength');
  const rowGlassStrength = document.getElementById('te-row-glass-strength');
  const lblGlassStrength = document.getElementById('te-lbl-glass-strength');
  
  const glassBlurVal = _teCurrentVars['--glass-blur'] || '0px';
  const isGlassActive = glassBlurVal !== '0px';
  const glassStrengthVal = _teCurrentVars['--glass-strength'] || '4';
  
  if (toggleGlass) toggleGlass.checked = isGlassActive;
  if (sliderGlass) sliderGlass.value = glassStrengthVal;
  if (lblGlassStrength) lblGlassStrength.textContent = `${glassStrengthVal}/10`;
  if (rowGlassStrength) rowGlassStrength.style.display = isGlassActive ? 'block' : 'none';
  
  // Sync nav style class
  const navBtns = document.querySelectorAll('#te-group-nav .te-btn-grp-opt');
  const activeNav = _teCurrentVars['--nav-style'] || 'bottom';
  const phoneScreen = document.getElementById('te-phone-screen');
  
  if (phoneScreen) {
    phoneScreen.classList.remove('nav-top', 'nav-floating');
    if (activeNav === 'top') phoneScreen.classList.add('nav-top');
    else if (activeNav === 'floating') phoneScreen.classList.add('nav-floating');
  }
  
  const navLabels = { bottom: 'Bottom Bar', top: 'Top Header', floating: 'Floating Pill' };
  const navLabelEl = document.getElementById('te-lbl-nav');
  if (navLabelEl) navLabelEl.textContent = navLabels[activeNav];
  navBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === activeNav);
  });
}

function _teAutoSaveCurrentVars() {
  if (!_teCurrentVars) return;
  const activeTheme = readSavedTheme('midnight');
  if (activeTheme.startsWith('custom_')) {
    const customThemeId = activeTheme.slice('custom_'.length);
    const data = _loadCustomThemes();
    const idx = data.customThemes.findIndex(t => t.id === customThemeId);
    if (idx >= 0) {
      data.customThemes[idx].vars = normalizeThemeVars({ ..._teCurrentVars });
      _saveCustomThemesStorage(data);
      _renderTESavedList();
      renderAppearanceCustomThemes();
    }
  } else {
    // Auto-fork built-in theme
    const data = _loadCustomThemes();
    const baseName = THEME_OPTIONS.find(t => t.key === activeTheme)?.label || 'Custom Theme';
    const cleanName = 'Custom ' + baseName.replace(/^[^\w\s]*/, '').trim();
    const id = 'custom_' + Date.now();
    const vars = normalizeThemeVars({ ..._teCurrentVars });
    data.customThemes.push({ id, name: cleanName, vars, createdAt: Date.now() });
    data.activeCustomId = id;
    _saveCustomThemesStorage(data);
    saveThemeSelection('custom_' + id);
    _teEditingId = id;
    
    // Update input fields
    const themeNameInput = document.getElementById('te-theme-name');
    if (themeNameInput) themeNameInput.value = cleanName;
    const saveBtn = document.getElementById('te-save-btn');
    if (saveBtn) saveBtn.textContent = '💾 Update';
    
    _renderTESavedList();
    renderAppearanceCustomThemes();
    renderThemeChoices();
  }
}

window.openThemeEditor = function() {
  const themeEditorModal = document.getElementById('theme-editor-modal');
  const appearanceModal = document.getElementById('appearance-modal');
  if (!themeEditorModal || !appearanceModal) return;
  document.getElementById('user-dropdown')?.classList.remove('visible');
  document.getElementById('user-pill')?.classList.remove('open');
  _tePrevThemeKey = readSavedTheme('midnight');
  _teEditingId = null;
  const saveBtn = document.getElementById('te-save-btn');
  if (saveBtn) saveBtn.textContent = '💾 Save';
  document.body.classList.add('appearance-open');

  // Populate base select
  const sel = document.getElementById('te-base-select');
  if (sel) sel.innerHTML = THEME_OPTIONS.map(t => `<option value="${t.key}">${t.label}</option>`).join('');

  // Seed vars from current theme (custom or built-in)
  if (_tePrevThemeKey.startsWith('custom_')) {
    const data = _loadCustomThemes();
    const found = data.customThemes.find(t => 'custom_' + t.id === _tePrevThemeKey);
    _teCurrentVars = found ? { ...found.vars } : { ...THEME_VARS_MAP.midnight };
    if (sel) sel.value = 'midnight';
    if (found) {
      _teEditingId = found.id;
      if (saveBtn) saveBtn.textContent = '💾 Update';
      const themeNameInput = document.getElementById('te-theme-name');
      if (themeNameInput) themeNameInput.value = found.name;
    }
  } else if (_tePrevThemeKey.startsWith('storetheme_')) {
    const storeTheme = getThemeCatalogEntry(_tePrevThemeKey);
    _teCurrentVars = storeTheme?.vars ? { ...storeTheme.vars } : { ...THEME_VARS_MAP.midnight };
    if (sel) sel.value = 'midnight';
  } else {
    const baseKey = THEME_KEYS.includes(_tePrevThemeKey) ? _tePrevThemeKey : 'midnight';
    if (sel) sel.value = baseKey;
    _teCurrentVars = { ...(THEME_VARS_MAP[baseKey] || THEME_VARS_MAP.midnight) };
  }

  // Remove CSS class theme so inline vars on :root are not overridden, enabling live preview
  removeThemeClasses(THEME_KEYS);
  applyCustomThemeVars(_teCurrentVars);

  const svgPreset = document.getElementById('te-bg-svg-preset');
  if (svgPreset) {
    const currentSvg = _teCurrentVars['--bg-svg'] || '';
    svgPreset.value = Object.keys(SVG_PRESETS).find(key => SVG_PRESETS[key] === currentSvg) || '';
    if (!svgPreset.dataset.hasListener) {
      svgPreset.addEventListener('change', e => {
        const val = e.target.value;
        const input = document.getElementById('te-bg-svg-input');
        if (val && SVG_PRESETS[val]) {
          const svgMarkup = SVG_PRESETS[val];
          if (input) {
            input.value = svgMarkup;
            _teCurrentVars = _teCurrentVars || {};
            _teCurrentVars['--bg-svg'] = svgMarkup;
            applyCustomThemeVars(_teCurrentVars);
            _teAutoSaveCurrentVars();
          }
        } else if (!val) {
          if (input) {
            input.value = '';
            _teCurrentVars = _teCurrentVars || {};
            _teCurrentVars['--bg-svg'] = '';
            applyCustomThemeVars(_teCurrentVars);
            _teAutoSaveCurrentVars();
          }
        }
      });
      svgPreset.dataset.hasListener = "true";
    }
  }

  // Initialize tabs switching logic
  const tabs = document.querySelectorAll('#theme-editor-modal .te-tab');
  tabs.forEach(tab => {
    if (tab.dataset.hasTabListener) return;
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.teTab;
      document.querySelectorAll('#theme-editor-modal .te-tab-panel').forEach(panel => {
        panel.classList.remove('active');
      });
      document.getElementById(`te-panel-${target}`)?.classList.add('active');
    });
    tab.dataset.hasTabListener = "true";
  });

  // Color Pickers on the Design Tab
  const designPickers = document.querySelectorAll('#te-panel-design input[type="color"]');
  designPickers.forEach(picker => {
    const cssVar = picker.dataset.var;
    const labelId = picker.id.replace('te-color-', 'te-hex-');
    const labelEl = document.getElementById(labelId);
    
    if (picker.dataset.hasListener) return;
    picker.addEventListener('input', (e) => {
      const val = e.target.value;
      _teSetVarAndSync(cssVar, val);
      if (labelEl) labelEl.textContent = val;
      applyCustomThemeVars(_teCurrentVars);
      updateLiveContrastBadge();
      _teAutoSaveCurrentVars();
    });
    picker.dataset.hasListener = "true";
  });

  // Font pairing buttons
  const fontBtns = document.querySelectorAll('#te-panel-design .te-font-btn');
  fontBtns.forEach(btn => {
    if (btn.dataset.hasListener) return;
    btn.addEventListener('click', () => {
      fontBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const font = btn.dataset.font;
      let bodyFont = "'Nunito', sans-serif";
      let headFont = "'Rajdhani', sans-serif";
      if (font === 'grotesk') {
        bodyFont = "'Space Grotesk', sans-serif";
        headFont = "'Space Grotesk', sans-serif";
      } else if (font === 'serif') {
        bodyFont = "'Playfair Display', serif";
        headFont = "'Playfair Display', serif";
      } else if (font === 'mono') {
        bodyFont = "'Share Tech Mono', monospace";
        headFont = "'Share Tech Mono', monospace";
      }
      _teCurrentVars['--font-body'] = bodyFont;
      _teCurrentVars['--font-headings'] = headFont;
      applyCustomThemeVars(_teCurrentVars);
      _teAutoSaveCurrentVars();
    });
    btn.dataset.hasListener = "true";
  });

  // Border radius buttons
  const radiusBtns = document.querySelectorAll('#te-group-radius .te-btn-grp-opt');
  const radLabels = { none: 'None', sm: 'Slight', md: 'Rounded', lg: 'Curvy', full: 'Extreme' };
  const radLabelEl = document.getElementById('te-lbl-radius');
  radiusBtns.forEach(btn => {
    if (btn.dataset.hasListener) return;
    btn.addEventListener('click', () => {
      radiusBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = btn.dataset.val;
      if (radLabelEl) radLabelEl.textContent = radLabels[val];
      let cardRad = '14px', btnRad = '8px';
      if (val === 'none') { cardRad = '0px'; btnRad = '0px'; }
      else if (val === 'sm') { cardRad = '6px'; btnRad = '4px'; }
      else if (val === 'lg') { cardRad = '22px'; btnRad = '12px'; }
      else if (val === 'full') { cardRad = '36px'; btnRad = '20px'; }
      _teCurrentVars['--radius-card'] = cardRad;
      _teCurrentVars['--radius-btn'] = btnRad;
      applyCustomThemeVars(_teCurrentVars);
      _teAutoSaveCurrentVars();
    });
    btn.dataset.hasListener = "true";
  });

  // Drop shadow buttons
  const shadowBtns = document.querySelectorAll('#te-group-shadow .te-btn-grp-opt');
  const shdLabels = { none: 'None', sm: 'Aura', md: 'Elevated', lg: 'Deep', colored: 'Glow' };
  const shdLabelEl = document.getElementById('te-lbl-shadow');
  shadowBtns.forEach(btn => {
    if (btn.dataset.hasListener) return;
    btn.addEventListener('click', () => {
      shadowBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = btn.dataset.val;
      if (shdLabelEl) shdLabelEl.textContent = shdLabels[val];
      let shdVal = '0 2px 12px rgba(0,0,0,0.2)';
      if (val === 'none') shdVal = 'none';
      else if (val === 'sm') shdVal = '0 4px 16px rgba(0, 0, 0, 0.06)';
      else if (val === 'lg') shdVal = '0 20px 48px rgba(0, 0, 0, 0.22)';
      else if (val === 'colored') shdVal = '0 12px 24px color-mix(in srgb, var(--accent) 30%, transparent)';
      _teCurrentVars['--shadow-card'] = shdVal;
      applyCustomThemeVars(_teCurrentVars);
      _teAutoSaveCurrentVars();
    });
    btn.dataset.hasListener = "true";
  });

  // Glassmorphism controls
  const toggleGlass = document.getElementById('te-toggle-glass');
  const sliderGlass = document.getElementById('te-slider-glass-strength');
  const rowGlassStrength = document.getElementById('te-row-glass-strength');
  const lblGlassStrength = document.getElementById('te-lbl-glass-strength');
  const updateGlassParams = () => {
    const active = toggleGlass.checked;
    const strength = parseInt(sliderGlass.value);
    if (rowGlassStrength) rowGlassStrength.style.display = active ? 'block' : 'none';
    if (lblGlassStrength) lblGlassStrength.textContent = `${strength}/10`;
    _teCurrentVars['--glass-strength'] = String(strength);
    if (active) {
      _teCurrentVars['--glass-blur'] = 'calc(var(--glass-strength) * 2px)';
      _teCurrentVars['--glass-bg'] = 'color-mix(in srgb, var(--bg2) calc(100% - var(--glass-strength) * 8%), transparent)';
      _teCurrentVars['--glass-border'] = 'color-mix(in srgb, var(--border) calc(20% + var(--glass-strength) * 5%), transparent)';
    } else {
      _teCurrentVars['--glass-blur'] = '0px';
      _teCurrentVars['--glass-bg'] = 'var(--bg2)';
      _teCurrentVars['--glass-border'] = 'var(--border)';
    }
    applyCustomThemeVars(_teCurrentVars);
    _teAutoSaveCurrentVars();
  };
  if (toggleGlass && !toggleGlass.dataset.hasListener) {
    toggleGlass.addEventListener('change', updateGlassParams);
    toggleGlass.dataset.hasListener = "true";
  }
  if (sliderGlass && !sliderGlass.dataset.hasListener) {
    sliderGlass.addEventListener('input', updateGlassParams);
    sliderGlass.dataset.hasListener = "true";
  }

  // Nav Style buttons
  const navBtns = document.querySelectorAll('#te-group-nav .te-btn-grp-opt');
  const navLabels = { bottom: 'Bottom Bar', top: 'Top Header', floating: 'Floating Pill' };
  const navLabelEl = document.getElementById('te-lbl-nav');
  navBtns.forEach(btn => {
    if (btn.dataset.hasListener) return;
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = btn.dataset.val;
      if (navLabelEl) navLabelEl.textContent = navLabels[val];
      _teCurrentVars['--nav-style'] = val;
      const phoneScreen = document.getElementById('te-phone-screen');
      if (phoneScreen) {
        phoneScreen.classList.remove('nav-top', 'nav-floating');
        if (val === 'top') phoneScreen.classList.add('nav-top');
        else if (val === 'floating') phoneScreen.classList.add('nav-floating');
      }
      applyCustomThemeVars(_teCurrentVars);
      _teAutoSaveCurrentVars();
    });
    btn.dataset.hasListener = "true";
  });

  _renderTEVarsList();
  _renderTESavedList();
  renderAppearanceThemeGrid();
  updateLiveContrastBadge();
  _teSyncDesignTabFromCurrentVars();

  const themeNameInput = document.getElementById('te-theme-name');
  if (themeNameInput) themeNameInput.value = '';
  const svgField = document.getElementById('te-bg-svg-input');
  if (svgField) svgField.value = _teCurrentVars['--bg-svg'] || '';
  appearanceModal.classList.add('visible');
  themeEditorModal.classList.add('visible');
};

window.closeThemeEditor = function() {
  const themeEditorModal = document.getElementById('theme-editor-modal');
  const appearanceModal = document.getElementById('appearance-modal');
  if (!themeEditorModal || !appearanceModal) return;
  themeEditorModal.classList.remove('visible');
  appearanceModal.classList.remove('visible');
  document.body.classList.remove('appearance-open');
  // Revert to what was active before editor opened
  const saved = readSavedTheme('midnight');
  if (saved.startsWith('custom_')) {
    const data = _loadCustomThemes();
    const found = data.customThemes.find(t => 'custom_' + t.id === saved);
    if (found) { applyCustomThemeVars(found.vars); return; }
  }
  applyTheme(saved);
};

document.getElementById('te-base-select')?.addEventListener('change', e => {
  const base = THEME_VARS_MAP[e.target.value];
  if (base) {
    _teCurrentVars = { ...base };
    _teEditingId = null;
    const saveBtn = document.getElementById('te-save-btn');
    if (saveBtn) saveBtn.textContent = '💾 Save';
    const themeNameInput = document.getElementById('te-theme-name');
    if (themeNameInput) themeNameInput.value = '';
    _renderTEVarsList();
    applyCustomThemeVars(_teCurrentVars);
    updateLiveContrastBadge();
    _teSyncDesignTabFromCurrentVars();
  }
});

document.getElementById('te-theme-search')?.addEventListener('input', () => _renderTEVarsList());

function _renderTEVarsList() {
  const container = document.getElementById('te-vars-list');
  if (!container) return;
  const baseKey = document.getElementById('te-base-select')?.value || 'midnight';
  const baseVars = THEME_VARS_MAP[baseKey] || THEME_VARS_MAP.midnight || {};
  const search = String(document.getElementById('te-theme-search')?.value || '').trim().toLowerCase();
  
  const allVars = _teGetAllVariables().filter(cssVar => !search || cssVar.toLowerCase().includes(search));
  const countEl = document.getElementById('te-var-count');
  if (countEl) countEl.textContent = `${allVars.length} var${allVars.length === 1 ? '' : 's'}`;

  container.innerHTML = '';
  if (!allVars.length) {
    container.innerHTML = `<div class="te-empty-vars">No CSS variables match your search.</div>`;
    return;
  }

  const groupAssignments = {};
  allVars.forEach(v => {
    let assigned = false;
    for (const [groupName, varList] of Object.entries(VAR_GROUPS)) {
      if (varList.includes(v)) {
        if (!groupAssignments[groupName]) groupAssignments[groupName] = [];
        groupAssignments[groupName].push(v);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      if (!groupAssignments["Other / Custom"]) groupAssignments["Other / Custom"] = [];
      groupAssignments["Other / Custom"].push(v);
    }
  });

  Object.entries(groupAssignments).forEach(([groupName, groupVars], gIdx) => {
    if (!groupVars.length) return;
    
    const accordion = document.createElement('div');
    accordion.className = 'te-accordion' + (search || gIdx === 0 ? ' open' : '');
    
    const header = document.createElement('div');
    header.className = 'te-accordion-header';
    header.innerHTML = `<span>${groupName} (${groupVars.length})</span><span class="te-accordion-icon">▶</span>`;
    header.onclick = () => accordion.classList.toggle('open');
    
    const content = document.createElement('div');
    content.className = 'te-accordion-content';
    
    groupVars.forEach(cssVar => {
      const currentVal = _teCurrentVars?.[cssVar] || baseVars[cssVar] || getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim() || '';
      const baseVal = baseVars[cssVar] || '';
      const row = document.createElement('div');
      row.className = 'te-var-item';
      row.setAttribute('role', 'listitem');
      const safeCurrent = esc(currentVal);
      row.innerHTML = `
        <div class="te-var-item-header">
          <label class="te-var-name" for="te-var-${cssVar.slice(2)}">${cssVar}</label>
          <span class="te-var-hint">${baseVal ? 'base: ' + esc(baseVal) : 'custom variable'}</span>
        </div>
        <div class="te-var-controls">
          <input id="te-var-${cssVar.slice(2)}" class="te-var-text" type="text" value="${safeCurrent}" aria-label="${cssVar} value">
          <input class="te-var-color" type="color" aria-label="${cssVar} color picker">
          <button class="te-var-reset" type="button">Reset</button>
        </div>`;

      const textInput = row.querySelector('.te-var-text');
      const colorInput = row.querySelector('.te-var-color');
      const resetBtn = row.querySelector('.te-var-reset');
      const colorHex = _teToHexIfColor(currentVal);
      colorInput.value = colorHex || '#000000';
      colorInput.style.visibility = colorHex ? 'visible' : 'hidden';

      textInput.addEventListener('input', e => {
        _teSetVarAndSync(cssVar, e.target.value.trim());
        const nextHex = _teToHexIfColor(_teCurrentVars[cssVar]);
        colorInput.style.visibility = nextHex ? 'visible' : 'hidden';
        if (nextHex) colorInput.value = nextHex;
        applyCustomThemeVars(_teCurrentVars);
        updateLiveContrastBadge();
        _teAutoSaveCurrentVars();
      });

      const extendBackdropGuard = (ms = 400) => { _teIgnoreBackdropClickUntil = Date.now() + ms; };
      colorInput.addEventListener('pointerdown', () => {
        _teColorPickerPointerActive = true;
        _teColorPickerInteracting = true;
        extendBackdropGuard(5000);
      });
      colorInput.addEventListener('input', e => {
        _teColorPickerInteracting = true;
        extendBackdropGuard(5000);
        _teSetVarAndSync(cssVar, e.target.value);
        textInput.value = e.target.value;
        applyCustomThemeVars(_teCurrentVars);
        updateLiveContrastBadge();
        _teAutoSaveCurrentVars();
      });
      colorInput.addEventListener('change', () => {
        extendBackdropGuard(1500);
        _teQueueColorPickerInteractionRelease(300);
      });
      colorInput.addEventListener('blur', () => {
        extendBackdropGuard(1500);
        _teQueueColorPickerInteractionRelease(350);
      });

      resetBtn.addEventListener('click', () => {
        if (baseVal) {
          _teSetVarAndSync(cssVar, baseVal);
          textInput.value = baseVal;
        } else {
          _teSetVarAndSync(cssVar, undefined);
          textInput.value = '';
        }
        const nextHex = _teToHexIfColor(textInput.value);
        colorInput.style.visibility = nextHex ? 'visible' : 'hidden';
        if (nextHex) colorInput.value = nextHex;
        applyCustomThemeVars(_teCurrentVars);
        updateLiveContrastBadge();
        _teAutoSaveCurrentVars();
      });

      content.appendChild(row);
    });
    
    accordion.appendChild(header);
    accordion.appendChild(content);
    container.appendChild(accordion);
  });
}



document.getElementById('te-bg-svg-input')?.addEventListener('input', e => {
  _teCurrentVars = _teCurrentVars || {};
  _teCurrentVars['--bg-svg'] = e.target.value || '';
  applyCustomThemeVars(_teCurrentVars);
  _teAutoSaveCurrentVars();
});

window.saveCustomTheme = function() {
  const nameEl = document.getElementById('te-theme-name');
  if (!nameEl) return;
  const name = nameEl.value.trim();
  if (!name) { nameEl.focus(); return; }
  const data = _loadCustomThemes();
  if (_teEditingId) {
    const idx = data.customThemes.findIndex(t => t.id === _teEditingId);
    if (idx >= 0) data.customThemes[idx] = { ...data.customThemes[idx], name, vars: normalizeThemeVars(_teCurrentVars || {}) };
    _saveCustomThemesStorage(data);
    applyTheme('custom_' + _teEditingId);
    _teEditingId = null;
    const saveBtn = document.getElementById('te-save-btn');
    if (saveBtn) saveBtn.textContent = '💾 Save';
  } else {
    const id = 'custom_' + Date.now();
    data.customThemes.push({ id, name, vars: normalizeThemeVars(_teCurrentVars || {}), createdAt: Date.now() });
    data.activeCustomId = id;
    _saveCustomThemesStorage(data);
    applyTheme('custom_' + id);
  }
  nameEl.value = '';
  _renderTESavedList();
  renderAppearanceCustomThemes();
  renderThemeChoices();
  renderStoreModal();
};

function _renderTESavedList() {
  const data = _loadCustomThemes();
  const section = document.getElementById('te-saved-section');
  const list = document.getElementById('te-saved-list');
  if (!section || !list) return;
  if (!data.customThemes.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = '';
  data.customThemes.slice().reverse().forEach(theme => {
    const item = document.createElement('div');
    item.className = 'te-saved-item';
    const safeName = esc(theme.name);
    item.innerHTML = `
      <span class="te-saved-name">${safeName}</span>
      <span class="te-saved-swatches">${renderThemeSwatches(theme)}</span>
      <button class="te-saved-apply" data-id="${theme.id}">Apply</button>
      <button class="te-saved-delete" data-id="${theme.id}" title="Delete">🗑</button>`;
    item.querySelector('.te-saved-apply').addEventListener('click', () => {
      _teEditingId = theme.id;
      _teCurrentVars = { ...theme.vars };
      const themeNameInput = document.getElementById('te-theme-name');
      if (themeNameInput) themeNameInput.value = theme.name;
      const saveBtn = document.getElementById('te-save-btn');
      if (saveBtn) saveBtn.textContent = '💾 Update';
      _renderTEVarsList();
      const d = _loadCustomThemes(); d.activeCustomId = theme.id; _saveCustomThemesStorage(d);
      applyTheme('custom_' + theme.id);
      updateActiveThemeChoice(null);
      renderAppearanceCustomThemes();
      renderThemeChoices();
      renderStoreModal();
    });
    item.querySelector('.te-saved-delete').addEventListener('click', () => {
      const d = _loadCustomThemes();
      d.customThemes = d.customThemes.filter(t => t.id !== theme.id);
      if (d.activeCustomId === theme.id) d.activeCustomId = null;
      _saveCustomThemesStorage(d);
      if (readSavedTheme('') === 'custom_' + theme.id) applyTheme('midnight');
      _renderTESavedList();
      renderAppearanceCustomThemes();
      renderThemeChoices();
      renderStoreModal();
    });
    list.appendChild(item);
  });
}

// ── FILTER DRAWER ──
let filterDrawerOpen = false;

window.toggleFilterDrawer = () => {
  filterDrawerOpen = !filterDrawerOpen;
  document.getElementById('filter-drawer').classList.toggle('open', filterDrawerOpen);
  document.getElementById('filter-toggle-btn').classList.toggle('active', filterDrawerOpen);
};

function updateFilterBadge() {
  const mf = document.getElementById('machine-filter').value;
  const sf = document.getElementById('status-filter').value;
  const search = document.getElementById('search-input').value;
  let count = 0;
  if (mf) count++;
  if (sf) count++;
  if (search) count++;
  if (issueShiftFilter !== 'all') count++;
  const badge = document.getElementById('filter-active-badge');
  badge.style.display = count > 0 ? 'inline-flex' : 'none';
  badge.textContent = count;
}

window.clearAllFilters = (options = {}) => {
  searchPeriodSnapshot = null;
  issueScope = 'all';
  issueShiftFilter = 'all';
  issuePeriod = 'today';
  issueRowScope = 'all';
  currentSort = 'newest';

  ['all','mine'].forEach(x => document.getElementById('scope-'+x)?.classList.toggle('active', x === 'all'));
  ['today','24h','week','month','all'].forEach(x => document.getElementById('period-'+x)?.classList.toggle('active', x === 'today'));
  document.getElementById('period-date')?.classList.remove('active');
  document.getElementById('scope-view-all')?.classList.toggle('active', true);
  document.getElementById('scope-view-active')?.classList.toggle('active', false);

  const today = localDateStr(new Date());
  const dateFilter = document.getElementById('date-filter');
  if (dateFilter) dateFilter.value = today;
  syncShiftFilterUi();
  closeShiftDropdown();
  updatePeriodTriggerLabel('today');
  updateCalLabel(today, false);

  const machineFilter = document.getElementById('machine-filter');
  const statusFilter = document.getElementById('status-filter');
  const searchBox = document.getElementById('search-input');
  const sortSelect = document.getElementById('sort-select');
  if (machineFilter) machineFilter.value = '';
  if (statusFilter) statusFilter.value = '';
  if (searchBox) searchBox.value = '';
  if (sortSelect) sortSelect.value = 'newest';
  const sortLabel = document.getElementById('sort-label');
  if (sortLabel) sortLabel.textContent = SORT_OPTIONS.find(o => o.value === 'newest')?.label || 'Newest';

  const bc = document.getElementById('machine-breadcrumb');
  if (bc) bc.classList.remove('visible');
  updateStatPillStyles();
  closeSortDropdown();
  buildSortDropdown();
  renderIssues();
  updatePressStates();
  updateStats();
  updateFilterBadge();
  loadDailyScheduledPresses(scheduleDateForLookup());
  if (!options.silentDemoGuide) completeDemoGuideStep('filters');
};

function scrollToSearchResultsIfNeeded() {
  const searchValue = String(document.getElementById('search-input')?.value || '').trim();
  if (!searchValue) return;
  const firstResult = document.querySelector('#issues-list .issue-card');
  if (firstResult) {
    firstResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  document.querySelector('.issues-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let searchPeriodSnapshot = null;

function captureSearchPeriodSnapshot() {
  if (searchPeriodSnapshot) return;
  searchPeriodSnapshot = {
    period: issuePeriod,
    dateValue: document.getElementById('date-filter')?.value || ''
  };
}

function restoreSearchPeriodSnapshot() {
  if (!searchPeriodSnapshot) return false;
  const snapshot = searchPeriodSnapshot;
  searchPeriodSnapshot = null;
  if (snapshot.period === 'date' && snapshot.dateValue) {
    document.getElementById('date-filter').value = snapshot.dateValue;
    window.onCalendarPick(snapshot.dateValue);
  } else {
    window.setPeriod(snapshot.period || 'all');
  }
  updateFilterBadge();
  return true;
}

function syncSearchPeriodWithQuery() {
  const searchValue = String(document.getElementById('search-input')?.value || '').trim();
  if (searchValue) {
    if (!searchPeriodSnapshot && issuePeriod !== 'all') captureSearchPeriodSnapshot();
    if (issuePeriod !== 'all') {
      window.setPeriod('all');
      updateFilterBadge();
      return true;
    }
    return false;
  }
  return restoreSearchPeriodSnapshot();
}

const searchInput = document.getElementById('search-input');
searchInput?.addEventListener('input', () => {
  const periodChanged = syncSearchPeriodWithQuery();
  if (!periodChanged) {
    renderIssues();
    updateFilterBadge();
  }
  completeDemoGuideStep('filters');
});
searchInput?.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const periodChanged = syncSearchPeriodWithQuery();
  if (!periodChanged) {
    renderIssues();
    updateFilterBadge();
  }
  if (String(searchInput.value || '').trim()) scrollToSearchResultsIfNeeded();
  completeDemoGuideStep('filters');
});
document.getElementById('machine-filter').addEventListener('change', () => {
  const mf = document.getElementById('machine-filter').value;
  const bc = document.getElementById('machine-breadcrumb');
  if (bc) {
    if (mf) { bc.classList.add('visible'); document.getElementById('breadcrumb-machine').textContent = 'Press ' + mf; }
    else { bc.classList.remove('visible'); }
  }
  renderIssues(); updateFilterBadge();
  completeDemoGuideStep('filters');
});
document.getElementById('status-filter').addEventListener('change', ()=>{ updateStatPillStyles(); renderIssues(); updateFilterBadge(); completeDemoGuideStep('filters'); });

// ── SORT DROPDOWN ──
const SORT_OPTIONS = [
  { value: 'newest',           label: 'Newest first' },
  { value: 'oldest',           label: 'Oldest first' },
  { value: 'machine',          label: 'By machine' },
  { value: 'status',           label: 'By status' },
  { value: 'longest-open',     label: 'Longest open' },
  { value: 'submitter',        label: 'By submitter' },
  { value: 'most-updates',     label: 'Most updates' },
  { value: 'recently-updated', label: 'Recently updated' },
];
let currentSort = 'newest';
const sortDropdown = createDropdownController({
  dropdownId: 'sort-dropdown',
  buttonId: 'sort-dropdown-btn',
  wrapId: 'sort-dropdown-wrap'
});
const exportDropdown = createDropdownController({
  dropdownId: 'export-dropdown',
  buttonId: 'export-menu-btn',
  wrapId: 'export-dropdown-wrap'
});

function buildSortDropdown() {
  const dd = document.getElementById('sort-dropdown');
  if (!dd) return;
  dd.innerHTML = '';
  SORT_OPTIONS.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'sort-opt' + (currentSort === opt.value ? ' active' : '');
    btn.innerHTML = `<span class="sort-opt-check">${currentSort === opt.value ? '✓' : ''}</span>${opt.label}`;
    btn.onclick = () => { setSort(opt.value); };
    dd.appendChild(btn);
  });
}

function setSort(val) {
  currentSort = val;
  document.getElementById('sort-label').textContent = SORT_OPTIONS.find(o=>o.value===val)?.label || 'Sort';
  // Sync the filter drawer select
  const sel = document.getElementById('sort-select');
  if (sel) sel.value = val;
  closeSortDropdown();
  buildSortDropdown();
  renderIssues();
  completeDemoGuideStep('filters');
}

// Sync from filter drawer select to header dropdown
document.getElementById('sort-select')?.addEventListener('change', function() {
  setSort(this.value);
});

window.toggleSortDropdown = sortDropdown.toggle;

function closeSortDropdown() {
  sortDropdown.close();
}

sortDropdown.bindOutsideClick();
shiftDropdown.bindOutsideClick();

syncShiftFilterUi();
buildSortDropdown();

window.toggleExportDropdown = exportDropdown.toggle;

window.closeExportDropdown = exportDropdown.close;

exportDropdown.bindOutsideClick();

// ── ACTIVE ROWS TOGGLE ──
let issueRowScope = 'all';

window.setIssueRowScope = s => {
  issueRowScope = s;
  document.getElementById('scope-view-all')?.classList.toggle('active', s === 'all');
  document.getElementById('scope-view-active')?.classList.toggle('active', s === 'active');
  renderIssues(); updateStats();
};

document.getElementById('add-modal').addEventListener('click',    e=>{if(e.target===document.getElementById('add-modal'))    closeModal();});
document.getElementById('edit-modal').addEventListener('click',   e=>{if(e.target===document.getElementById('edit-modal'))   closeEditModal();});
document.getElementById('resolve-modal').addEventListener('click',e=>{if(e.target===document.getElementById('resolve-modal'))closeResolveModal();});
document.getElementById('reopen-modal').addEventListener('click', e=>{if(e.target===document.getElementById('reopen-modal')) closeReopenModal();});
document.getElementById('edit-status-modal').addEventListener('click', e=>{if(e.target===document.getElementById('edit-status-modal')) closeEditStatusModal();});
document.getElementById('sms-compose-modal')?.addEventListener('click', e=>{ if(e.target===document.getElementById('sms-compose-modal')) closeSmsComposer(true); });

// Prevent modal content clicks from bubbling to overlay
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', e => e.stopPropagation());
});

const MOBILE_MODAL_SWIPE_BREAKPOINT = 700;
const MOBILE_MODAL_SWIPE_CLOSES = {
  'add-modal': () => window.closeModal?.(),
  'edit-modal': () => window.closeEditModal?.(),
  'resolve-modal': () => window.closeResolveModal?.(),
  'reopen-modal': () => window.closeReopenModal?.(),
  'issue-reminder-modal': () => window.closeIssueReminderModal?.(),
  'sms-compose-modal': () => window.closeSmsComposer?.(true),
  'edit-status-modal': () => window.closeEditStatusModal?.(),
  'export-modal': () => window.closeExportModal?.(),
  'serial-modal': () => window.closeSerialModal?.(),
  'press-wiki-modal': () => window.closePressWikiModal?.(),
  'notes-modal': () => window.closeNotesModal?.(),
  'notes-phone-frame': () => window.closeNotesModal?.(),
  'notes-editor-modal': () => window.closeNotesEditorModal?.(),
  'todos-modal': () => window.closeTodosModal?.(),
  'todos-frame': () => window.closeTodosModal?.(),
  'appearance-modal': () => window.closeAppearanceModal?.(),
  'theme-editor-modal': () => window.closeThemeEditor?.(),
  'role-prefs-modal': () => window.closeRolePreferencesModal?.(),
  'role-alerts-modal': () => window.closeRoleAlertInboxModal?.(),
  'subcategory-sheet': () => window.closeSubcategorySheet?.(),
  'subcategory-sheet-overlay': () => window.closeSubcategorySheet?.(),
  'notes-modal-a': () => window.closeNotesModal?.(),
  'notes-modal-b': () => window.closeNotesModal?.(),
  'notes-editor-frame': () => window.closeNotesEditorModal?.(),
  'store-modal': () => window.closeStoreModal?.(),
  'purchase-confirm-modal': () => window.closePurchaseConfirm?.(),
  'messaging-modal': () => window.closeMessagingModal?.(),
  'messaging-frame': () => window.closeMessagingModal?.(),
  'press-wiki-frame': () => window.closePressWikiModal?.(),
  'role-alerts-frame': () => window.closeRoleAlertInboxModal?.()
};

const MOBILE_MODAL_SWIPE_BLOCKERS = [
  'button',
  'input',
  'textarea',
  'select',
  'option',
  'label',
  'a',
  '[contenteditable="true"]',
  '[role="button"]',
  '[data-no-swipe]',
  '.btn',
  '.sort-dropdown-btn',
  '.scope-btn',
  '.photo-pick-btn',
  '.timer-chip',
  '.subcategory-item',
  '.subcategory-parent-pill',
  '.store-tab',
  '.msg-tab',
  '.msg-icon-btn',
  '.msg-close-btn',
  '.store-modal-close',
  '.notes-modal-close',
  '.notes-modal-a-close',
  '.notes-modal-b-close',
  '.role-alerts-close',
  '.role-alerts-retry-fab'
].join(',');

const _mobileModalSwipeState = {
  modal: null,
  close: null,
  pointerId: null,
  startX: 0,
  startY: 0,
  lastY: 0,
  dragging: false,
  dismissing: false,
  restoreTimer: null,
  startTransition: '',
  startTransform: '',
  startOpacity: ''
};

function _mobileModalSwipeViewportOk() {
  return window.matchMedia?.(`(max-width: ${MOBILE_MODAL_SWIPE_BREAKPOINT}px)`)?.matches || false;
}

function _mobileModalSwipeResetStyle(modal, restore = true) {
  if (!modal) return;
  if (restore) {
    modal.style.transition = _mobileModalSwipeState.startTransition || '';
    modal.style.transform = _mobileModalSwipeState.startTransform || '';
    modal.style.opacity = _mobileModalSwipeState.startOpacity || '';
  } else {
    modal.style.transition = '';
    modal.style.transform = '';
    modal.style.opacity = '';
  }
  modal.classList.remove('modal-swipe-active');
  document.body.classList.remove('modal-swipe-dragging');
}

function _mobileModalSwipeFinish(restore = true) {
  const modal = _mobileModalSwipeState.modal;
  if (_mobileModalSwipeState.restoreTimer) {
    clearTimeout(_mobileModalSwipeState.restoreTimer);
    _mobileModalSwipeState.restoreTimer = null;
  }
  if (modal) _mobileModalSwipeResetStyle(modal, restore);
  _mobileModalSwipeState.modal = null;
  _mobileModalSwipeState.close = null;
  _mobileModalSwipeState.pointerId = null;
  _mobileModalSwipeState.dragging = false;
  _mobileModalSwipeState.dismissing = false;
}

function _mobileModalSwipeCloseFor(modal) {
  if (!modal) return null;
  const modalId = modal.id || modal.closest('[id]')?.id || '';
  return MOBILE_MODAL_SWIPE_CLOSES[modalId] || null;
}

function _mobileModalSwipeCanStart(target) {
  if (!target || !target.closest) return null;
  if (target.closest(MOBILE_MODAL_SWIPE_BLOCKERS)) return null;
  return target.closest('.modal, .subcategory-sheet, .store-modal, .phone');
}

function _mobileModalSwipeStart(event) {
  if (event.button && event.button !== 0) return;
  if (!_mobileModalSwipeViewportOk()) return;
  if (event.pointerType && event.pointerType === 'mouse') return;
  if (_mobileModalSwipeState.modal) return;

  const modal = _mobileModalSwipeCanStart(event.target);
  if (!modal || modal.getClientRects().length === 0) return;

  const rect = modal.getBoundingClientRect();
  const topZone = Math.min(72, Math.max(48, rect.height * 0.18));
  const insideTopZone = event.clientY <= rect.top + topZone;
  if (!insideTopZone) return;

  const close = _mobileModalSwipeCloseFor(modal);
  if (!close) return;

  _mobileModalSwipeState.modal = modal;
  _mobileModalSwipeState.close = close;
  _mobileModalSwipeState.pointerId = event.pointerId;
  _mobileModalSwipeState.startX = event.clientX;
  _mobileModalSwipeState.startY = event.clientY;
  _mobileModalSwipeState.lastY = event.clientY;
  _mobileModalSwipeState.dragging = false;
  _mobileModalSwipeState.dismissing = false;
  _mobileModalSwipeState.startTransition = modal.style.transition || '';
  _mobileModalSwipeState.startTransform = modal.style.transform || '';
  _mobileModalSwipeState.startOpacity = modal.style.opacity || '';
  document.body.classList.add('modal-swipe-dragging');

  try { modal.setPointerCapture?.(event.pointerId); } catch (_) {}
}

function _mobileModalSwipeMove(event) {
  const modal = _mobileModalSwipeState.modal;
  if (!modal || event.pointerId !== _mobileModalSwipeState.pointerId) return;
  if (_mobileModalSwipeState.dismissing) {
    event.preventDefault();
    return;
  }

  const dx = event.clientX - _mobileModalSwipeState.startX;
  const dy = event.clientY - _mobileModalSwipeState.startY;
  _mobileModalSwipeState.lastY = event.clientY;

  if (!_mobileModalSwipeState.dragging) {
    if (dy < 8 || Math.abs(dy) < Math.abs(dx) * 1.1 || dy < 0) return;
    _mobileModalSwipeState.dragging = true;
    modal.classList.add('modal-swipe-active');
    modal.style.transition = 'none';
  }

  event.preventDefault();
  const dragY = Math.max(0, dy);
  const fade = Math.max(0.55, 1 - (dragY / 420));
  modal.style.transform = `translate3d(0, ${dragY}px, 0)`;
  modal.style.opacity = String(fade);
}

function _mobileModalSwipeEnd(event) {
  const modal = _mobileModalSwipeState.modal;
  if (!modal || event.pointerId !== _mobileModalSwipeState.pointerId) return;

  const dy = (event.clientY || _mobileModalSwipeState.lastY) - _mobileModalSwipeState.startY;
  const dx = (event.clientX || _mobileModalSwipeState.startX) - _mobileModalSwipeState.startX;
  const shouldDismiss = _mobileModalSwipeState.dragging && dy > 84 && dy > Math.abs(dx) * 1.15;

  if (shouldDismiss) {
    _mobileModalSwipeState.dismissing = true;
    modal.style.transition = 'transform 150ms ease, opacity 150ms ease';
    modal.style.transform = 'translate3d(0, 110%, 0)';
    modal.style.opacity = '0';
    _mobileModalSwipeState.restoreTimer = window.setTimeout(() => {
      _mobileModalSwipeState.close?.();
      _mobileModalSwipeFinish(false);
    }, 150);
    return;
  }

  if (_mobileModalSwipeState.dragging) {
    modal.style.transition = 'transform 140ms ease, opacity 140ms ease';
    modal.style.transform = _mobileModalSwipeState.startTransform || '';
    modal.style.opacity = _mobileModalSwipeState.startOpacity || '';
    _mobileModalSwipeState.restoreTimer = window.setTimeout(() => {
      _mobileModalSwipeFinish(true);
    }, 150);
    return;
  }

  _mobileModalSwipeFinish(true);
}

function _bindMobileModalSwipe(modal) {
  if (!modal || modal.dataset.mobileSwipeBound === '1') return;
  modal.dataset.mobileSwipeBound = '1';
  modal.addEventListener('pointerdown', _mobileModalSwipeStart, true);
}

document.querySelectorAll('.modal, .subcategory-sheet, .store-modal, .phone').forEach(_bindMobileModalSwipe);
document.addEventListener('pointermove', _mobileModalSwipeMove, true);
document.addEventListener('pointerup', _mobileModalSwipeEnd, true);
document.addEventListener('pointercancel', _mobileModalSwipeEnd, true);

document.addEventListener('keydown', e=>{ if(e.key==='Escape'){closeModal();closeEditModal();closeResolveModal();closeReopenModal();closeLightbox();closeSortDropdown();closeExportModal();closeSerialModal();closeEditStatusModal();closeNotesModal();closeSmsComposer(true);window.closeMessagingModal?.();window.closeConversation?.();closeAppearanceModal();closeThemeEditor();closeRolePreferencesModal();closeRoleAlertInboxModal();} });

document.getElementById('theme-editor-modal')?.addEventListener('click', e => {
  const modal = document.getElementById('theme-editor-modal');
  if (!modal || e.target !== modal) return;
  if (_teColorPickerInteracting) return;
  if (Date.now() < _teIgnoreBackdropClickUntil) return;
  closeThemeEditor();
});
document.getElementById('appearance-modal')?.addEventListener('click', e => { if (e.target === document.getElementById('appearance-modal')) closeAppearanceModal(); });
document.getElementById('role-prefs-modal')?.addEventListener('click', e => { if (e.target === document.getElementById('role-prefs-modal')) closeRolePreferencesModal(); });

// ── SERIAL NUMBER PROMPT ──
// Define which status+sub combos require a serial number
function requiresSerialNumber(statusKey, sub) {
  const statusDef = getStatusDef(statusKey);
  const statusKeyNorm = String(statusKey || '').trim().toLowerCase();
  const statusLabelNorm = String(statusDef?.label || '').trim().toLowerCase();
  const subNorm = String(sub || '').trim().toLowerCase();

  // Legacy/default flow: Materials → Needed
  if (statusKeyNorm === 'materials' && subNorm === 'needed') return true;

  // Requested + resilient flow: Need(s) → Material* (handles custom naming variants)
  const isNeedsFamily = statusKeyNorm.includes('need') || statusLabelNorm.includes('need');
  const isMaterialFamily = subNorm.includes('material');
  return isNeedsFamily && isMaterialFamily;
}


const SERIAL_MATERIAL_OPTIONS = {
  STK44875: { location:[1], rack:'1', quantity:0 },
  STK44880: { location:[1], rack:'1', quantity:0 },
  STK4140959PG: { location:[2], rack:'1', quantity:0 },
  STK44144: { location:[2,3,4], rack:'1', quantity:0 },
  STK44190: { location:[4,5], rack:'1', quantity:0 },
  STK44224: { location:[6,7], rack:'2', quantity:0 },
  STK44836: { location:[8,9], rack:'2', quantity:0 },
  STK4500STP: { location:[10], rack:'2', quantity:0 },
  STK44866: { location:[11], rack:'2', quantity:0 },
  STK44136: { location:[11], rack:'2', quantity:0 },
  STK44216: { location:[12,13], rack:'2', quantity:0 },
  STK44196: { location:[13], rack:'2', quantity:0 },
  STK44820: { location:[13], rack:'2', quantity:0 },
  STK44300: { location:[14], rack:'2', quantity:0 },
  STK44219: { location:[15], rack:'3', quantity:0 },
  STK47503: { location:[16], rack:'3', quantity:0 },
  STK3X5030: { location:[16], rack:'3', quantity:0 },
  STK3X758: { location:[16], rack:'3', quantity:0 },
  STK44138: { location:[17], rack:'3', quantity:0 },
  STK44193: { location:[17], rack:'3', quantity:0 },
  STK44864: { location:[17], rack:'3', quantity:0 },
  STK44222: { location:[18], rack:'3', quantity:0 },
  STK44851: { location:[18], rack:'3', quantity:0 },
  STK44182: { location:[19], rack:'3', quantity:0 },
  STK4140958: { location:[19], rack:'3', quantity:0 },
  STK44251: { location:[20], rack:'3', quantity:0 },
  STK44221: { location:[20], rack:'3', quantity:0 },
  STK44838: { location:[20], rack:'3', quantity:0 }
};

function populateSerialMaterialOptions() {
  const select = document.getElementById('serial-select');
  if (!select) return;
  const entries = Object.entries(SERIAL_MATERIAL_OPTIONS).sort((a,b)=>a[0].localeCompare(b[0]));
  select.innerHTML = '<option value="">Select a material...</option>' + entries.map(([code, meta]) => {
    const locationText = Array.isArray(meta.location) ? meta.location.join(', ') : '';
    return `<option value="${esc(code)}">${esc(code)} — Rack ${esc(meta.rack)} / Loc ${esc(locationText)}</option>`;
  }).join('');
}

function getMaterialLocationText(serialCode) {
  const code = String(serialCode || '').trim().toUpperCase();
  const meta = SERIAL_MATERIAL_OPTIONS[code];
  if (!meta) return '';
  const loc = Array.isArray(meta.location) ? meta.location.join(', ') : '';
  const rack = meta.rack ? `Rack ${meta.rack}` : '';
  const locText = loc ? `Loc ${loc}` : '';
  return [rack, locText].filter(Boolean).join(' / ');
}

function resolveSerialInputValue() {
  const selectVal = (document.getElementById('serial-select')?.value || '').trim();
  const customVal = (document.getElementById('serial-input')?.value || '').trim();
  return customVal || selectVal;
}

let _serialPending = null; // { issueId, status, sub, dateTime }

window.openSerialModal = (issueId, status, sub, dt) => {
  _serialPending = { issueId, status, sub, dateTime: dt || null };
  const issue = issues.find(i => i.id === issueId);
  document.getElementById('serial-modal-machine').textContent = issue ? issue.machine : '';
  const st = getStatusDef(status);
  document.getElementById('serial-modal-status').textContent = st.icon + ' ' + getStatusLabel(status) + (sub ? ' › ' + sub : '');
  populateSerialMaterialOptions();
  document.getElementById('serial-select').value = '';
  document.getElementById('serial-input').value = '';
  document.getElementById('serial-error').style.display = 'none';
  document.getElementById('serial-input').style.borderColor = '';
  document.getElementById('serial-select').style.borderColor = '';
  document.getElementById('serial-modal').classList.add('visible');
  setTimeout(() => document.getElementById('serial-input').focus(), 100);
};

window.closeSerialModal = () => {
  document.getElementById('serial-modal').classList.remove('visible');
  _serialPending = null;
};

window.confirmSerialModal = async () => {
  if (!_serialPending) return;
  const sn = resolveSerialInputValue();
  const serialError = document.getElementById('serial-error');
  const serialInput = document.getElementById('serial-input');
  const serialPattern = /^STK[0-9A-Z]+$/i;
  if (!sn) {
    serialError.textContent = 'Please enter a serial number';
    serialError.style.display = 'block';
    serialInput.style.borderColor = 'var(--color-danger, var(--red))';
    document.getElementById('serial-select').style.borderColor = 'var(--color-danger, var(--red))';
    serialInput.focus();
    return;
  }
  if (!serialPattern.test(sn)) {
    serialError.textContent = 'Serial should usually look like STK##### (example: STK12345)';
    serialError.style.display = 'block';
    serialInput.style.borderColor = 'var(--color-danger, var(--red))';
    document.getElementById('serial-select').style.borderColor = 'var(--color-danger, var(--red))';
    serialInput.focus();
    return;
  }
  const locationText = getMaterialLocationText(sn);
  const note = locationText ? `S/N: ${sn} (${locationText})` : ('S/N: ' + sn);
  await addStatusEntry(_serialPending.issueId, _serialPending.status, _serialPending.sub, note, _serialPending.dateTime);
  await awardGamification('serial_captured_when_required', { issueId: _serialPending.issueId, dedupeSuffix: sn, tags: ['serial:captured'] });
  closeSerialModal();
};

// Close serial modal on overlay click and escape
document.getElementById('serial-modal')?.addEventListener('click', e => { if(e.target===document.getElementById('serial-modal')) closeSerialModal(); });

// ── CONVERSATIONS (DM + GROUP + PRESS CHANNELS) ──
let _conversationListUnsubscribe = null;
let _conversationThreadUnsubscribe = null;
let _messagingInboxUnsubscribe = null;
let _conversationListPollTimer = null;
let _conversationThreadPollTimer = null;
let _messagingInboxPollTimer = null;

function _conversationType(inputType) {
  const normalized = String(inputType || 'group').trim().toLowerCase();
  return ['dm', 'group', 'press'].includes(normalized) ? normalized : 'group';
}

function _requireChatContext() {
  if (NO_AUTH_MODE) return false;
  if (!currentPlantId) throw new Error('No active plant selected.');
  if (!currentUser?.uid) throw new Error('You must be signed in.');
  return true;
}

window.createConversation = async ({ type = 'group', title = '', memberIds = [], pressId = null } = {}) => {
  if (!_requireChatContext()) return null;
  const actor = currentActor();
  const normalizedType = _conversationType(type);
  const uniqueMembers = Array.from(new Set([...(memberIds || []), actor.uid].map(v => String(v || '').trim()).filter(Boolean)));
  if (uniqueMembers.length < 2) throw new Error('At least two members are required.');
  if (normalizedType === 'dm' && uniqueMembers.length !== 2) throw new Error('DM conversations must have exactly two members.');
  if (normalizedType === 'group' && !String(title || '').trim()) throw new Error('Group conversations require a title.');
  if (shouldUseSqlStagingReads(currentPlantId)) {
    const payload = await dataApi.createConversation(currentPlantId, {
      type: normalizedType,
      title: normalizedType === 'dm' ? null : String(title || '').trim(),
      pressId: normalizedType === 'press' ? String(pressId || '').trim() || null : null,
      memberIds: uniqueMembers
    });
    return payload?.conversation?.id || payload?.conversation?.conversationId || null;
  }

  if (normalizedType === 'dm') {
    const dmQuery = query(
      conversationsCol(),
      where('type', '==', 'dm'),
      where('memberIds', 'array-contains', actor.uid),
      limit(20)
    );
    const dmSnap = await getDocs(dmQuery);
    const existing = dmSnap.docs.find(d => {
      const data = d.data() || {};
      const ids = Array.isArray(data.memberIds) ? data.memberIds : [];
      return data.memberCount === 2
        && !data.isArchived
        && ids.includes(uniqueMembers[0])
        && ids.includes(uniqueMembers[1]);
    });
    if (existing) return existing.id;
  }

  const payload = {
    type: normalizedType,
    title: normalizedType === 'dm' ? null : String(title || '').trim(),
    pressId: normalizedType === 'press' ? String(pressId || '').trim() || null : null,
    plantId: currentPlantId,
    createdAt: serverTimestamp(),
    createdBy: actor,
    memberIds: uniqueMembers,
    memberCount: uniqueMembers.length,
    lastMessage: null,
    lastMessageAt: serverTimestamp(),
    isArchived: false
  };

  const conversationRef = doc(conversationsCol());
  const batch = writeBatch(db);
  batch.set(conversationRef, payload);
  uniqueMembers.forEach(uid => {
    batch.set(conversationMemberDoc(conversationRef.id, uid), {
      userId: uid,
      role: uid === actor.uid ? 'owner' : 'member',
      joinedAt: serverTimestamp(),
      lastReadAt: serverTimestamp(),
      lastReadMessageId: null,
      unreadCount: 0,
      muted: false
    }, { merge: true });
  });
  await batch.commit();

  return conversationRef.id;
};

window.watchConversations = (onConversations, { type = null } = {}, onError = null) => {
  if (!_requireChatContext()) return () => {};
  if (_conversationListUnsubscribe) {
    _conversationListUnsubscribe();
    _conversationListUnsubscribe = null;
  }
  if (_conversationListPollTimer) {
    clearTimeout(_conversationListPollTimer);
    _conversationListPollTimer = null;
  }
  if (shouldUseSqlStagingReads(currentPlantId)) {
    let active = true;
    _conversationListUnsubscribe = () => {
      active = false;
      if (_conversationListPollTimer) {
        clearTimeout(_conversationListPollTimer);
        _conversationListPollTimer = null;
      }
      _conversationListUnsubscribe = null;
    };
    const poll = async () => {
      if (!active || !currentPlantId) return;
      try {
        const payload = await requireSqlRead(
          `conversations ${currentPlantId}`,
          () => dataApi.listConversations(currentPlantId, type ? { type } : {}),
          `Conversations are missing in D1 for plant ${currentPlantId}.`
        );
        if (typeof onConversations === 'function') onConversations(payload.conversations || []);
      } catch (err) {
        console.warn('conversations poll error', err);
        if (typeof onError === 'function') onError(err);
      }
      if (active) _conversationListPollTimer = setTimeout(poll, 5000);
    };
    void poll();
    return _conversationListUnsubscribe;
  }
  const constraints = [
    where('memberIds', 'array-contains', currentUser.uid),
    orderBy('lastMessageAt', 'desc')
  ];
  const normalizedType = type ? _conversationType(type) : null;
  if (normalizedType) constraints.unshift(where('type', '==', normalizedType));
  const q = query(conversationsCol(), ...constraints);
  _conversationListUnsubscribe = onSnapshot(q, snap => {
    const conversations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (typeof onConversations === 'function') onConversations(conversations);
  }, err => {
    console.warn('conversations listener error', err);
    if (typeof onError === 'function') onError(err);
  });
  return _conversationListUnsubscribe;
};

window.openConversation = (conversationId, onMessages) => {
  if (!_requireChatContext()) return () => {};
  if (!conversationId) throw new Error('conversationId is required.');
  if (_conversationThreadUnsubscribe) {
    _conversationThreadUnsubscribe();
    _conversationThreadUnsubscribe = null;
  }
  if (_conversationThreadPollTimer) {
    clearTimeout(_conversationThreadPollTimer);
    _conversationThreadPollTimer = null;
  }
  if (shouldUseSqlStagingReads(currentPlantId)) {
    let active = true;
    _conversationThreadUnsubscribe = () => {
      active = false;
      if (_conversationThreadPollTimer) {
        clearTimeout(_conversationThreadPollTimer);
        _conversationThreadPollTimer = null;
      }
      _conversationThreadUnsubscribe = null;
    };
    const poll = async () => {
      if (!active || !currentPlantId || !conversationId) return;
      try {
        const payload = await requireSqlRead(
          `conversation messages ${conversationId}`,
          () => dataApi.listConversationMessages(currentPlantId, conversationId),
          `Conversation messages are missing in D1 for conversation ${conversationId}.`
        );
        if (typeof onMessages === 'function') onMessages(payload.messages || []);
      } catch (err) {
        console.warn('conversation poll error', err);
      }
      if (active) _conversationThreadPollTimer = setTimeout(poll, 3000);
    };
    void poll();
    return _conversationThreadUnsubscribe;
  }
  const q = query(conversationMessagesCol(conversationId), orderBy('createdAt', 'asc'));
  _conversationThreadUnsubscribe = onSnapshot(q, snap => {
    const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (typeof onMessages === 'function') onMessages(messages);
  }, err => console.warn('conversation listener error', err));
  return _conversationThreadUnsubscribe;
};

window.sendConversationMessage = async (conversationId, text, { mentions = [], attachments = [] } = {}) => {
  if (!_requireChatContext()) return null;
  const trimmedText = String(text || '').trim();
  const normalizedAttachments = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  if (!conversationId || (!trimmedText && !normalizedAttachments.length)) return null;
  const actor = currentActor();
  if (shouldUseSqlStagingReads(currentPlantId)) {
    const payload = await dataApi.createConversationMessage(currentPlantId, conversationId, {
      text: trimmedText,
      mentions,
      attachments: normalizedAttachments,
      type: 'text'
    });
    const messageId = payload?.message?.id || payload?.message?.messageId || null;
    if (messageId) void sendConversationPush(conversationId, messageId);
    return messageId;
  }

  const messageRef = doc(conversationMessagesCol(conversationId));
  const batch = writeBatch(db);
  batch.set(messageRef, {
    conversationId,
    plantId: currentPlantId,
    sender: actor,
    type: 'text',
    text: trimmedText,
    mentions: Array.from(new Set((mentions || []).map(v => String(v || '').trim()).filter(Boolean))),
    attachments: normalizedAttachments,
    createdAt: serverTimestamp(),
    editedAt: null,
    deletedAt: null
  });
  batch.update(conversationDoc(conversationId), {
    lastMessage: {
      textPreview: trimmedText ? trimmedText.slice(0, 280) : (normalizedAttachments.length ? '📷 Photo' : ''),
      senderUid: actor.uid,
      senderName: actor.name,
      at: serverTimestamp()
    },
    lastMessageAt: serverTimestamp()
  });
  batch.set(conversationMemberDoc(conversationId, actor.uid), {
    userId: actor.uid,
    lastReadAt: serverTimestamp(),
    lastReadMessageId: messageRef.id
  }, { merge: true });
  await batch.commit();
  void sendConversationPush(conversationId, messageRef.id);

  return messageRef.id;
};

window.markConversationRead = async (conversationId, lastReadMessageId = null) => {
  if (!_requireChatContext()) return;
  if (!conversationId) return;
  if (shouldUseSqlStagingReads(currentPlantId)) {
    await dataApi.markConversationRead(currentPlantId, conversationId, {
      lastReadMessageId: lastReadMessageId || null
    });
    return;
  }
  await setDoc(conversationMemberDoc(conversationId, currentUser.uid), {
    userId: currentUser.uid,
    lastReadAt: serverTimestamp(),
    lastReadMessageId: lastReadMessageId || null,
    unreadCount: 0
  }, { merge: true });
};

window.closeConversation = () => {
  if (_conversationThreadUnsubscribe) { _conversationThreadUnsubscribe(); _conversationThreadUnsubscribe = null; }
};

window.closeConversationList = () => {
  if (_conversationListUnsubscribe) { _conversationListUnsubscribe(); _conversationListUnsubscribe = null; }
};

// ── MESSAGING MODAL (UI refresh) ──
const _messagingState = {
  conversations: [],
  activeConversationId: null,
  selectedPhoto: null,
  lastSeenByConversation: {},
  tab: 'all',
  search: '',
  selectableMembers: [],
  selectedDmUid: null,
  selectedGroupMembers: new Set()
};

function _updateMessagingEntryBadges(unreadCount = 0) {
  const safeCount = Math.max(0, Number(unreadCount) || 0);
  document.querySelectorAll('[data-messages-trigger]').forEach(el => {
    el.classList.toggle('messages-has-unread', safeCount > 0);
  });
  document.querySelectorAll('[data-messages-badge]').forEach(el => {
    if (!safeCount) {
      el.style.display = 'none';
      el.textContent = '0';
      return;
    }
    el.style.display = 'inline-flex';
    el.textContent = safeCount > 99 ? '99+' : String(safeCount);
  });
}

function _messagingUnreadTotal(conversations = []) {
  return (conversations || []).reduce((sum, conv) => sum + (_messagingUnreadCount(conv) ? 1 : 0), 0);
}

function _startMessagingInboxWatcher() {
  if (_messagingInboxUnsubscribe) {
    _messagingInboxUnsubscribe();
    _messagingInboxUnsubscribe = null;
  }
  if (_messagingInboxPollTimer) {
    clearTimeout(_messagingInboxPollTimer);
    _messagingInboxPollTimer = null;
  }
  if (!currentPlantId || !currentUser?.uid) {
    _updateMessagingEntryBadges(0);
    return;
  }
  if (shouldUseSqlStagingReads(currentPlantId)) {
    let active = true;
    _messagingInboxUnsubscribe = () => {
      active = false;
      if (_messagingInboxPollTimer) {
        clearTimeout(_messagingInboxPollTimer);
        _messagingInboxPollTimer = null;
      }
      _messagingInboxUnsubscribe = null;
    };
    const poll = async () => {
      if (!active || !currentPlantId || !currentUser?.uid) return;
      try {
        const payload = await requireSqlRead(
          `messaging inbox ${currentPlantId}`,
          () => dataApi.listConversations(currentPlantId),
          `Messaging inbox is missing in D1 for plant ${currentPlantId}.`
        );
        const conversations = payload?.conversations || [];
        const unreadCount = _messagingUnreadTotal(conversations);
        _updateMessagingEntryBadges(unreadCount);
        const tabBadge = document.getElementById('messaging-tab-all-badge');
        if (tabBadge) {
          tabBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
          tabBadge.style.display = unreadCount ? 'inline-flex' : 'none';
        }
      } catch (err) {
        console.warn('messaging inbox poll error', err);
        _updateMessagingEntryBadges(0);
      }
      if (active) _messagingInboxPollTimer = setTimeout(poll, 5000);
    };
    void poll();
    return;
  }
  const q = query(
    conversationsCol(),
    where('memberIds', 'array-contains', currentUser.uid),
    orderBy('lastMessageAt', 'desc')
  );
  _messagingInboxUnsubscribe = onSnapshot(q, snap => {
    const conversations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const unreadCount = _messagingUnreadTotal(conversations);
    _updateMessagingEntryBadges(unreadCount);
    const tabBadge = document.getElementById('messaging-tab-all-badge');
    if (tabBadge) {
      tabBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      tabBadge.style.display = unreadCount ? 'inline-flex' : 'none';
    }
  }, err => {
    console.warn('messaging inbox watcher error', err);
    _updateMessagingEntryBadges(0);
  });
}

function _bindMessagingKeyboardShortcut() {
  if (window.__messagingShortcutBound) return;
  window.__messagingShortcutBound = true;
  document.addEventListener('keydown', e => {
    const target = e.target;
    const typing = !!(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
    if (typing) return;
    const openShortcut = (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey));
    if (!openShortcut) return;
    e.preventDefault();
    window.openMessagingModal();
    setTimeout(() => document.getElementById('messaging-search')?.focus(), 30);
  });
}

function _messagingSetError(message = '') {
  const el = document.getElementById('messaging-error');
  if (el) el.textContent = message;
}

function _messagingUserLabel(member = {}) {
  return member.displayName || member.name || member.email || member.uid || 'User';
}

function _messagingUserPhoto(member = {}) {
  return member.photoURL || member.photoUrl || member.avatarUrl || member.avatarURL || member.picture || '';
}

function _messagingInitials(name = '') {
  return String(name || 'U').split(' ').filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase();
}

function _messagingColor(seed = '') {
  const palette = ['#007AFF','#34C759','#FF9500','#FF3B30','#AF52DE','#5AC8FA','#FF2D55','#00C7BE'];
  const idx = String(seed).split('').reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length;
  return palette[idx];
}

function _fmtMsgTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts?.seconds ? ts.seconds * 1000 : ts);
  if (Number.isNaN(+d)) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function _fmtMsgDateSep(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts?.seconds ? ts.seconds * 1000 : ts);
  const now = new Date();
  const diffDays = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function _messagingSetPhotoPreview(file = null) {
  _messagingState.selectedPhoto = file || null;
  const wrap = document.getElementById('messaging-photo-preview');
  if (!wrap) return;
  if (!file) {
    wrap.innerHTML = '';
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  wrap.innerHTML = `<div class="msg-reaction" style="display:inline-flex;margin:8px 0;">📷 ${esc(file.name || 'image')}</div><img src="${objectUrl}" alt="selected photo preview" style="max-width:180px;border-radius:10px;border:1px solid var(--color-border, var(--border));margin-top:6px;">`;
}

function _messagingNotifyIncoming(message, conversationName) {
  showGameToast(`💬 ${conversationName}: ${(message?.sender?.name || 'Someone')} sent a message`);
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(conversationName, {
      body: message.text || (message.attachments?.length ? 'Sent a photo' : 'New message')
    });
  } catch (e) {
    console.warn('Notification failed', e);
  }
}

function _messagingMemberByUid(uid) {
  if (!uid) return null;
  if (uid === currentUser?.uid) {
    return {
      uid,
      displayName: currentUser?.displayName || currentUser?.email || 'You',
      email: currentUser?.email || '',
      photoURL: currentUser?.photoURL || ''
    };
  }
  return _messagingState.selectableMembers.find(m => m.uid === uid) || null;
}

function _messagingPersonAvatar(member = {}, size = 40) {
  const label = _messagingUserLabel(member);
  const photo = _messagingUserPhoto(member);
  if (photo) {
    return `<div class="msg-avatar" style="position:relative;"><img class="msg-avatar-img" src="${esc(photo)}" alt="${esc(label)}" style="width:${size}px;height:${size}px;border-radius:50%;"></div>`;
  }
  return `<div class="msg-avatar" style="position:relative;"><div class="msg-avatar-initials" style="background:${_messagingColor(member.uid || label)};width:${size}px;height:${size}px;">${esc(_messagingInitials(label))}</div></div>`;
}

function _messagingConversationName(conv) {
  if (!conv) return 'Conversation';
  if (conv.type === 'dm') {
    const otherUid = (conv.memberIds || []).find(uid => uid !== currentUser?.uid);
    const other = _messagingMemberByUid(otherUid);
    return _messagingUserLabel(other || { uid: otherUid, name: conv.title || 'Direct Message' });
  }
  if (conv.type === 'press') return conv.title || `Press ${conv.pressId || ''}`.trim() || 'Press Chat';
  return conv.title || 'Group Chat';
}

function _messagingFilteredConversations() {
  const tab = _messagingState.tab;
  const q = String(_messagingState.search || '').trim().toLowerCase();
  const sorted = [..._messagingState.conversations].sort((a, b) => {
    const at = a.lastMessageAt?.toMillis?.() ?? a.lastMessageAt?.seconds * 1000 ?? (a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0);
    const bt = b.lastMessageAt?.toMillis?.() ?? b.lastMessageAt?.seconds * 1000 ?? (b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0);
    return bt - at;
  });
  return sorted.filter(conv => {
    if (tab === 'dms' && conv.type !== 'dm') return false;
    if (tab === 'groups' && conv.type === 'dm') return false;
    if (!q) return true;
    const name = _messagingConversationName(conv).toLowerCase();
    const preview = String(conv.lastMessage?.textPreview || '').toLowerCase();
    return name.includes(q) || preview.includes(q);
  });
}

function _messagingUnreadCount(conv) {
  const lastId = conv?.lastMessage?.id;
  const lastSenderUid = conv?.lastMessage?.sender?.uid || conv?.lastMessage?.senderUid;
  if (!lastId || !lastSenderUid || lastSenderUid === currentUser?.uid) return 0;
  const lastReadId = conv?.myMembership?.lastReadMessageId || _messagingState.lastSeenByConversation[conv.id] || null;
  return lastReadId === lastId ? 0 : 1;
}

function _messagingAvatarHtml(conv, size = 40) {
  if (!conv) return '';
  if (conv.type !== 'dm') {
    const others = (conv.memberIds || []).filter(uid => uid !== currentUser?.uid).slice(0, 4);
    const cells = others.map(uid => {
      const m = _messagingMemberByUid(uid);
      const label = _messagingUserLabel(m || { uid });
      const photo = _messagingUserPhoto(m || {});
      if (photo) {
        return `<div class="msg-group-avatar-cell" style="padding:0;overflow:hidden;background:var(--bg4);"><img src="${esc(photo)}" alt="${esc(label)}" style="width:100%;height:100%;object-fit:cover;"></div>`;
      }
      return `<div class="msg-group-avatar-cell" style="background:${_messagingColor(uid)}">${esc(_messagingInitials(label))}</div>`;
    }).join('');
    return `<div class="msg-group-avatar" style="width:${size}px;height:${size}px;">${cells || '<div class="msg-group-avatar-cell" style="grid-column:1/3;background:var(--bg4)">GR</div>'}</div>`;
  }
  const otherUid = (conv.memberIds || []).find(uid => uid !== currentUser?.uid);
  const other = _messagingMemberByUid(otherUid) || { uid: otherUid, name: 'User' };
  return _messagingPersonAvatar(other, size);
}

function _renderMessagingConversations() {
  const list = document.getElementById('messaging-conversations-list');
  if (!list) return;
  const conversations = _messagingFilteredConversations();
  if (!conversations.length) {
    list.innerHTML = '<div class="msg-empty"><div class="msg-empty-icon">💬</div><div class="msg-empty-text">No conversations yet.</div></div>';
    return;
  }
  list.innerHTML = conversations.map(conv => {
    const unread = _messagingUnreadCount(conv);
    const isActive = conv.id === _messagingState.activeConversationId;
    const name = _messagingConversationName(conv);
    const preview = conv.lastMessage?.textPreview || 'No messages yet';
    const time = conv.lastMessageAt ? _relativeTime(conv.lastMessageAt) : '';
    return `<div class="msg-convo-row ${isActive ? 'active' : ''}" data-convo-id="${esc(conv.id)}">
      ${_messagingAvatarHtml(conv)}
      <div class="msg-convo-info">
        <div class="msg-convo-name-row">
          <span class="msg-convo-name">${esc(name)}</span>
          <span class="msg-convo-time">${esc(time)}</span>
        </div>
        <div class="msg-convo-preview ${unread ? 'unread' : ''}">${esc(preview)}</div>
      </div>
      ${unread ? '<div class="msg-unread-dot"></div>' : ''}
    </div>`;
  }).join('');

  list.querySelectorAll('.msg-convo-row').forEach(row => {
    row.addEventListener('click', () => {
      const convoId = row.getAttribute('data-convo-id');
      if (convoId) _selectMessagingConversation(convoId);
      if (window.innerWidth <= 600) document.getElementById('msg-list-panel')?.classList.add('hidden');
    });
  });
}

function _renderMessagingThreadHeader(conv) {
  const title = document.getElementById('messaging-thread-title');
  const sub = document.getElementById('messaging-thread-sub');
  const avatar = document.getElementById('messaging-thread-avatar');
  const header = document.getElementById('messaging-thread-header');
  if (!title || !sub || !avatar || !header) return;
  if (!conv) {
    header.style.display = 'none';
    title.textContent = 'Select a conversation';
    sub.textContent = '';
    avatar.innerHTML = '';
    return;
  }
  header.style.display = 'flex';
  title.textContent = _messagingConversationName(conv);
  const memberCount = Array.isArray(conv.memberIds) ? conv.memberIds.length : 0;
  sub.textContent = conv.type === 'dm' ? 'Direct message' : `${memberCount} members`;
  avatar.innerHTML = _messagingAvatarHtml(conv, 36);
}

function _renderMessagingMessages(messages) {
  const panel = document.getElementById('messaging-thread-messages');
  if (!panel) return;
  if (!messages.length) {
    panel.innerHTML = '<div class="msg-empty"><div class="msg-empty-icon">💬</div><div class="msg-empty-text">No messages yet. Start the conversation.</div></div>';
    return;
  }
  const convo = _messagingState.conversations.find(c => c.id === _messagingState.activeConversationId);
  let prevDate = '';
  const html = [];
  messages.forEach(msg => {
    const dt = msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date(msg.createdAt?.seconds ? msg.createdAt.seconds * 1000 : msg.createdAt);
    const dateKey = dt.toDateString();
    if (dateKey !== prevDate) {
      html.push(`<div class="msg-date-sep">${esc(_fmtMsgDateSep(msg.createdAt))}</div>`);
      prevDate = dateKey;
    }
    const mine = msg.sender?.uid === currentUser?.uid;
    const senderName = mine ? 'You' : (msg.sender?.name || _messagingUserLabel(_messagingMemberByUid(msg.sender?.uid) || {}));
    const avatar = mine ? '' : `<div class="msg-row-avatar">${_messagingAvatarHtml({ type: 'dm', memberIds: [currentUser?.uid, msg.sender?.uid] }, 28)}</div>`;
    const attachments = (msg.attachments || []).filter(att => att.kind === 'image' && att.url)
      .map(att => `<img class="messaging-msg-image" src="${esc(att.url)}" alt="${esc(att.fileName || 'image')}" style="max-width:200px;border-radius:10px;border:1px solid var(--color-border, var(--border));margin-top:4px;">`).join('');
    html.push(`<div class="msg-row ${mine ? 'sent' : 'recv'}">
      ${avatar}
      <div class="msg-bubble-group">
        ${(!mine && convo?.type !== 'dm') ? `<div class="msg-sender-name">${esc(senderName)}</div>` : ''}
        <div class="msg-bubble-wrap">
          <div class="msg-bubble ${mine ? 'sent' : 'recv'}">${esc(msg.text || '')}</div>
          ${attachments}
        </div>
        <div class="msg-bubble-time">${esc(_fmtMsgTime(msg.createdAt))}</div>
      </div>
    </div>`);
  });
  panel.innerHTML = html.join('');
  panel.scrollTop = panel.scrollHeight;
}

function _selectMessagingConversation(conversationId) {
  _messagingState.activeConversationId = conversationId;
  const selected = _messagingState.conversations.find(c => c.id === conversationId);
  _renderMessagingConversations();
  _renderMessagingThreadHeader(selected);
  openConversation(conversationId, messages => {
    _renderMessagingMessages(messages);
    const lastMessage = messages[messages.length - 1] || null;
    const lastId = lastMessage?.id || null;
    const seenId = _messagingState.lastSeenByConversation[conversationId] || null;
    if (lastMessage && seenId && lastMessage.id !== seenId && lastMessage.sender?.uid !== currentUser?.uid) {
      _messagingNotifyIncoming(lastMessage, _messagingConversationName(selected));
    }
    if (lastMessage) _messagingState.lastSeenByConversation[conversationId] = lastMessage.id;
    if (lastId && lastId !== seenId) {
      markConversationRead(conversationId, lastId).catch(err => console.warn('markConversationRead failed', err));
    }
  });
}

function _renderMessagingMemberPicks() {
  const dmWrap = document.getElementById('messaging-dm-list');
  const groupWrap = document.getElementById('messaging-group-members');
  if (dmWrap) {
    dmWrap.innerHTML = _messagingState.selectableMembers.map(m => {
      const label = _messagingUserLabel(m);
      const checked = _messagingState.selectedDmUid === m.uid;
      return `<div class="msg-member-row ${checked ? 'selected' : ''}" data-dm-uid="${esc(m.uid)}">
        ${_messagingPersonAvatar(m, 36)}
        <div style="font-size:14px;font-weight:600;">${esc(label)}</div>
        <div class="msg-member-check">${checked ? '✓' : ''}</div>
      </div>`;
    }).join('');
    dmWrap.querySelectorAll('[data-dm-uid]').forEach(row => {
      row.addEventListener('click', () => {
        _messagingState.selectedDmUid = row.getAttribute('data-dm-uid');
        _renderMessagingMemberPicks();
      });
    });
  }

  if (groupWrap) {
    groupWrap.innerHTML = _messagingState.selectableMembers.map(m => {
      const label = _messagingUserLabel(m);
      const checked = _messagingState.selectedGroupMembers.has(m.uid);
      return `<div class="msg-member-row ${checked ? 'selected' : ''}" data-group-uid="${esc(m.uid)}">
        ${_messagingPersonAvatar(m, 36)}
        <div style="font-size:14px;font-weight:600;">${esc(label)}</div>
        <div class="msg-member-check">${checked ? '✓' : ''}</div>
      </div>`;
    }).join('');
    groupWrap.querySelectorAll('[data-group-uid]').forEach(row => {
      row.addEventListener('click', () => {
        const uid = row.getAttribute('data-group-uid');
        if (_messagingState.selectedGroupMembers.has(uid)) _messagingState.selectedGroupMembers.delete(uid);
        else _messagingState.selectedGroupMembers.add(uid);
        _renderMessagingMemberPicks();
      });
    });
  }

  document.getElementById('messaging-create-dm-btn').disabled = !_messagingState.selectedDmUid;
  const groupName = String(document.getElementById('messaging-group-name')?.value || '').trim();
  document.getElementById('messaging-create-group-btn').disabled = !groupName || _messagingState.selectedGroupMembers.size < 1;
}

async function _messagingSelectableMembers() {
  if (NO_AUTH_MODE || !currentPlantId || !currentUser?.uid) return [];
  if (shouldUseSqlStagingReads(currentPlantId)) {
    const payload = await requireSqlRead(
      `messaging members ${currentPlantId}`,
      () => dataApi.listPlantMembers(currentPlantId, { active: true }),
      `Messaging members are missing in D1 for plant ${currentPlantId}.`
    );
    return (payload?.members || [])
      .filter(m => m.uid !== currentUser.uid && m.isActive !== false)
      .sort((a, b) => String(_messagingUserLabel(a)).localeCompare(String(_messagingUserLabel(b))));
  }
  const membersSnap = await getDocs(collection(db, 'plants', currentPlantId, 'members'));
  return membersSnap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(m => m.uid !== currentUser.uid && m.isActive !== false)
    .sort((a, b) => String(_messagingUserLabel(a)).localeCompare(String(_messagingUserLabel(b))));
}

async function _messagingLoadMemberSelectors({ preserveSelection = false } = {}) {
  _messagingState.selectableMembers = await _messagingSelectableMembers();
  if (!preserveSelection) {
    _messagingState.selectedDmUid = null;
    _messagingState.selectedGroupMembers = new Set();
  }
  _renderMessagingMemberPicks();
}

window.openMessagingModal = (options = {}) => {
  const preserveState = !!options.preserveState;
  _bindToolModalShellNavigation();
  const modal = document.getElementById('messaging-modal');
  if (modal) modal.classList.add('visible');
  document.body.classList.add('messaging-open');
  completeDemoGuideStep('tools');
  _messagingSetError('');
  if (!preserveState) _messagingSetPhotoPreview(null);
  document.getElementById('msg-list-panel')?.classList.remove('hidden');
  if (NO_AUTH_MODE || !currentPlantId || !currentUser?.uid) {
    _messagingState.conversations = [];
    _messagingState.activeConversationId = null;
    _messagingState.selectableMembers = [];
    _renderMessagingConversations();
    _renderMessagingThreadHeader(null);
    const panel = document.getElementById('messaging-thread-messages');
    if (panel) panel.innerHTML = '<div class="msg-empty"><div class="msg-empty-icon">💬</div><div class="msg-empty-text">Messaging is disabled until a plant and signed-in user are available.</div></div>';
    _messagingSetError('Messaging is disabled in no-auth mode.');
    return;
  }
  _messagingLoadMemberSelectors({ preserveSelection: preserveState }).catch(err => {
    console.warn('messaging member load failed', err);
    _messagingSetError(`Could not load members: ${err?.message || 'permission denied'}`);
  });

  const panel = document.getElementById('messaging-thread-messages');
  if (panel) panel.innerHTML = '<div class="msg-empty"><div class="msg-empty-text">Loading…</div></div>';

  watchConversations(conversations => {
    _messagingState.conversations = conversations;
    conversations.forEach(conv => {
      const lastReadMessageId = conv?.myMembership?.lastReadMessageId || null;
      if (lastReadMessageId) _messagingState.lastSeenByConversation[conv.id] = lastReadMessageId;
    });
    const stillExists = conversations.some(c => c.id === _messagingState.activeConversationId);
    if (!stillExists) _messagingState.activeConversationId = conversations[0]?.id || null;
    _renderMessagingConversations();
    if (_messagingState.activeConversationId) {
      _selectMessagingConversation(_messagingState.activeConversationId);
    } else {
      _renderMessagingThreadHeader(null);
      if (panel) panel.innerHTML = '<div class="msg-empty"><div class="msg-empty-icon">💬</div><div class="msg-empty-text">Create a conversation to begin messaging.</div></div>';
    }
  }, {}, err => {
    _messagingSetError(`Could not load conversations: ${err?.message || 'permission denied'}`);
    _renderMessagingThreadHeader(null);
    if (panel) panel.innerHTML = '<div class="msg-empty"><div class="msg-empty-text">Conversation access is currently denied.</div></div>';
  });
};

window.closeMessagingModal = (options = {}) => {
  document.getElementById('messaging-modal')?.classList.remove('visible');
  document.body.classList.remove('messaging-open');
  hideMessagingSheets();
  if (!options.preserveState) {
    _messagingSetPhotoPreview(null);
  }
  closeConversation();
  closeConversationList();
};

window.sendMessagingModalMessage = async () => {
  const ta = document.getElementById('messaging-input');
  const text = String(ta?.value || '').trim();
  if (!text && !_messagingState.selectedPhoto) return;
  if (!_messagingState.activeConversationId) {
    _messagingSetError('Select or create a conversation first.');
    return;
  }
  try {
    _messagingSetError('');
    let attachments = [];
    if (_messagingState.selectedPhoto) {
      const photo = await _uploadMessagingPhoto(_messagingState.selectedPhoto, _messagingState.activeConversationId);
      attachments = [photo];
    }
    await sendConversationMessage(_messagingState.activeConversationId, text || '', { attachments });
    if (ta) {
      ta.value = '';
      ta.style.height = 'auto';
    }
    _messagingSetPhotoPreview(null);
  } catch (err) {
    console.warn('sendMessagingModalMessage failed', err);
    _messagingSetError(`Could not send message: ${err?.message || 'permission denied'}`);
  }
};

window.createMessagingDm = async () => {
  _messagingSetError('');
  if (!currentPlantId || !currentUser?.uid) {
    _messagingSetError('Sign in and select a plant before creating a DM.');
    return;
  }
  if (!_messagingState.selectedDmUid) {
    _messagingSetError('Select someone to message.');
    return;
  }
  try {
    const conversationId = await createConversation({ type: 'dm', memberIds: [_messagingState.selectedDmUid] });
    hideMessagingSheets();
    _messagingState.activeConversationId = conversationId;
    _selectMessagingConversation(conversationId);
  } catch (err) {
    console.warn('createMessagingDm failed', err);
    _messagingSetError(`Could not create DM: ${err?.message || 'permission denied'}`);
  }
};

window.createMessagingGroup = async () => {
  _messagingSetError('');
  if (!currentPlantId || !currentUser?.uid) {
    _messagingSetError('Sign in and select a plant before creating a group.');
    return;
  }
  const groupTitle = String(document.getElementById('messaging-group-name')?.value || '').trim();
  const memberIds = Array.from(_messagingState.selectedGroupMembers);
  if (!groupTitle) {
    _messagingSetError('Enter a group name.');
    return;
  }
  if (!memberIds.length) {
    _messagingSetError('Select at least one member for the group.');
    return;
  }
  try {
    const conversationId = await createConversation({ type: 'group', title: groupTitle, memberIds });
    document.getElementById('messaging-group-name').value = '';
    hideMessagingSheets();
    _messagingState.activeConversationId = conversationId;
    _selectMessagingConversation(conversationId);
  } catch (err) {
    console.warn('createMessagingGroup failed', err);
    _messagingSetError(`Could not create group: ${err?.message || 'permission denied'}`);
  }
};

window.showMessagingNewDm = () => {
  const sheet = document.getElementById('messaging-new-dm');
  if (sheet) sheet.classList.add('visible');
  document.getElementById('messaging-new-group')?.classList.remove('visible');
  _renderMessagingMemberPicks();
};

window.showMessagingNewGroup = () => {
  const sheet = document.getElementById('messaging-new-group');
  if (sheet) sheet.classList.add('visible');
  document.getElementById('messaging-new-dm')?.classList.remove('visible');
  _renderMessagingMemberPicks();
};

window.hideMessagingSheets = () => {
  const dm = document.getElementById('messaging-new-dm');
  const group = document.getElementById('messaging-new-group');
  if (dm) dm.classList.remove('visible');
  if (group) group.classList.remove('visible');
};

window.enableMessagingNotifications = async () => {
  try {
    await registerFcmToken({ requestPermission: true });
    _messagingSetError('');
    showGameToast('🔔 Push alerts enabled');
  } catch (err) {
    _messagingSetError(err?.message || 'Notification permission was not granted.');
  }
};

async function _uploadMessagingPhoto(file, conversationId) {
  const dataUrl = await readFileAsDataUrl(file);
  const uploaded = await uploadAttachmentToPreferredStorage(currentPlantId, {
    scope: 'conversation',
    conversationId,
    fileName: file.name || 'image.jpg',
    contentType: file.type || 'image/jpeg',
    dataUrl
  });
  if (uploaded?.storagePath) {
    return {
      kind: 'image',
      url: uploaded.downloadUrl || uploaded.url || '',
      storagePath: uploaded.storagePath,
      storageBucket: uploaded.storageBucket || 'r2',
      fileName: uploaded.fileName || file.name || 'image.jpg',
      contentType: uploaded.contentType || file.type || 'image/jpeg',
      sizeBytes: Number(uploaded.sizeBytes || file.size || 0)
    };
  }
  const path = `plants/${currentPlantId}/conversations/${conversationId}/photos/${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name || 'image.jpg'}`;
  const fileRef = storageRef(storage, path);
  await uploadString(fileRef, dataUrl, 'data_url');
  const url = await getDownloadURL(fileRef);
  return {
    kind: 'image',
    url,
    storagePath: path,
    fileName: file.name || 'image.jpg',
    contentType: file.type || 'image/jpeg',
    sizeBytes: file.size || 0
  };
}

document.getElementById('messaging-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('messaging-modal')) closeMessagingModal();
});

document.getElementById('messaging-new-dm')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) hideMessagingSheets();
});

document.getElementById('messaging-new-group')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) hideMessagingSheets();
});

document.getElementById('messaging-create-dm-btn')?.addEventListener('click', () => createMessagingDm());
document.getElementById('messaging-create-group-btn')?.addEventListener('click', () => createMessagingGroup());

document.getElementById('messaging-tabs')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  _messagingState.tab = btn.getAttribute('data-tab') || 'all';
  document.querySelectorAll('#messaging-tabs .msg-tab').forEach(tabBtn => tabBtn.classList.toggle('active', tabBtn === btn));
  _renderMessagingConversations();
});

document.getElementById('messaging-search')?.addEventListener('input', e => {
  _messagingState.search = e.target.value || '';
  _renderMessagingConversations();
});

document.getElementById('messaging-back-btn')?.addEventListener('click', () => {
  document.getElementById('msg-list-panel')?.classList.remove('hidden');
});

document.getElementById('messaging-group-name')?.addEventListener('input', () => _renderMessagingMemberPicks());

document.getElementById('messaging-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessagingModalMessage();
  }
});

document.getElementById('messaging-input')?.addEventListener('input', e => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
});

document.getElementById('messaging-photo-input')?.addEventListener('change', e => {
  const file = e.target?.files?.[0] || null;
  _messagingSetPhotoPreview(file);
});

// ── PRESS NOTES ──
// Toggle between 'a' (Logbook) and 'b' (Team Channel) to switch prototypes

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

function getCurrentOpenMachine() {
  const filterMachine = String(document.getElementById('machine-filter')?.value || '').trim();
  return filterMachine || activeMiniCard?.machine || currentMachine || '';
}

function getCurrentOpenIssue() {
  const openBody = document.querySelector('.issue-body.visible');
  const issueId = openBody?.id?.replace(/^body-/, '') || '';
  if (issueId) return issues.find(i => i.id === issueId) || null;

  const machine = getCurrentOpenMachine();
  if (!machine) return null;
  return issues.find(issue => issue.machine === machine && currentStatusKey(issue) !== 'resolved') || null;
}

// ── TODOS TOOL ──
const todosTool = initTodosTool({
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  plantTodosCol,
  plantTodoDoc,
  userTodosCol,
  userTodoDoc,
  getCurrentUser: () => currentUser,
  getCurrentPlantId: () => currentPlantId,
  currentActor,
  localDateStr,
  esc,
  toPressId,
  getOpenMachine: getCurrentOpenMachine,
  getOpenIssue: getCurrentOpenIssue,
  completeDemoGuideStep
});
window.openTodosModal = todosTool.open;
window.closeTodosModal = todosTool.close;

let _notesLoadToken = 0;
let _notesSaveTimer = null;
let _notesUnsubscribe = null;
let _notesPollTimer = null;
let _notesAttachmentsCache = [];
let _notesContext = { pressId: null, issueId: null, label: 'Plant-wide' };
const _notesState = {
  notes: [],
  activeNoteId: null,
  view: 'list',
  filter: 'all',
  search: '',
  saving: false,
  lastSavedAt: null,
  draftChecklistId: 1,
  dirty: false,
  creating: false,
  previewMode: false,
  lockContext: false,
  error: '',
  currentNote: null
};

function _notesIsMobileLayout() {
  return window.innerWidth <= 860;
}

function _notesSyncLayout() {
  const editorModal = document.getElementById('notes-editor-modal');
  if (!editorModal) return;
  const isEditor = _notesState.view === 'editor' && !!_notesState.currentNote?.id;
  editorModal.classList.toggle('visible', isEditor);
}

window.closeNotesEditorModal = function() {
  _notesSetView('list');
  _notesRenderEditor(null);
  _notesRenderList();
};

function _notesSetView(view) {
  _notesState.view = view === 'editor' ? 'editor' : 'list';
  _notesSyncLayout();
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
  return Object.values(PRESSES || {}).some(machines => (machines || []).some(machineCode => toPressId(machineCode) === target));
}

function _pressWikiPressInfo(pressId) {
  const target = String(pressId || '').trim();
  if (!target) return null;
  for (const [rowName, machines] of Object.entries(PRESSES || {})) {
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
  _pressWikiSetPressPickerOpen(false);
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

  const rowEntries = Object.entries(PRESSES || {})
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

function _notesEl(base) { return document.getElementById(base + '-' + NOTES_VARIANT); }

function _relativeTime(ts) {
  if (!ts) return '';
  const ms = ts.toMillis ? ts.toMillis() : (ts.seconds ? ts.seconds * 1000 : +ts);
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function openPressWikiModal(pressId, machineCode, options = {}) {
  if (!currentPlantId) return;
  _bindToolModalShellNavigation();
  const preserveState = !!options.preserveState && Boolean(_pressWikiModalPressId || _pressWikiSelectedPageId || _pressWikiScope);
  const initialScope = preserveState
    ? _pressWikiScope
    : (options.scope === WIKI_SCOPE_SHARED ? WIKI_SCOPE_SHARED : WIKI_SCOPE_PRESS);
  const initialTitle = String(options.title || '').trim() || _pressWikiBaseTitle(initialScope);
  const knownPressId = preserveState
    ? (_pressWikiScope === WIKI_SCOPE_PRESS ? (_pressWikiIsKnownPressId(_pressWikiModalPressId) ? String(_pressWikiModalPressId).trim() : null) : null)
    : (_pressWikiIsKnownPressId(pressId) ? String(pressId).trim() : null);
  const initialPageId = preserveState
    ? (_pressWikiSelectedPageId || (initialScope === WIKI_SCOPE_SHARED ? PRESS_WIKI_SHARED_INDEX_PAGE_ID : null))
    : (String(options.pageId || '').trim() || (initialScope === WIKI_SCOPE_SHARED ? PRESS_WIKI_SHARED_INDEX_PAGE_ID : null));
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
  _pressWikiCanEdit = (currentUserRole === 'admin' || currentUserRole === 'editor');
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
  _pressWikiSetPressPickerOpen(false);
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
  if (shouldUseSqlStagingReads(currentPlantId)) {
    const payload = await requireSqlRead(
      `wiki pages ${currentPlantId}:${_pressWikiScope}:${queryPressId || 'shared'}`,
      () => dataApi.listWikiPages(currentPlantId, {
        scope: _pressWikiScope,
        pressId: _pressWikiScope === WIKI_SCOPE_SHARED ? '' : queryPressId
      }),
      `Wiki pages are missing in D1 for plant ${currentPlantId}.`
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
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const payload = await requireSqlRead(
        `wiki page ${currentPlantId}:${pageId}`,
        () => dataApi.getWikiPage(currentPlantId, pageId, {
          scope: _pressWikiScope,
          pressId: _pressWikiScope === WIKI_SCOPE_SHARED ? '' : activePressId
        }),
        `Wiki page ${pageId} is missing in D1 for plant ${currentPlantId}.`
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

window.closePressWikiModal = (options = {}) => {
  _setPressWikiModalVisible(false);
  _pressWikiSetPickerOpen(false);
  _pressWikiSetPressPickerOpen(false);
  closePressWikiActionsMenu();
  if (options.preserveState) return;
  _pressWikiModalPressId = null;
  _pressWikiSelectedPressId = null;
};

async function savePressWikiRevision() {
  if (!_pressWikiCanEdit) return;
  const activePressId = _pressWikiActivePressId();
  if (!_pressWikiSelectedPageId || !currentUser || (_pressWikiScope === WIKI_SCOPE_PRESS && !activePressId)) return;
  const title = String(document.getElementById('press-wiki-edit-title')?.value || '').trim();
  const body = String(document.getElementById('press-wiki-edit-body')?.value || '').trim();
  const rawChangeNote = String(document.getElementById('press-wiki-edit-change-note')?.value || '').trim();
  if (!body) return _setPressWikiError('Body is required.');
  const fallbackActorName = String(currentActor()?.name || currentUser?.displayName || currentUser?.email || 'Unknown').trim() || 'Unknown';
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const changeNote = rawChangeNote || `${fallbackActorName} : ${dd}/${mm}/${yy}`;
  if (shouldUseSqlStagingReads(currentPlantId)) {
    await dataApi.saveWikiRevision(currentPlantId, _pressWikiSelectedPageId, {
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
  if (!_pressWikiSelectedPageId || !currentUser || (_pressWikiScope === WIKI_SCOPE_PRESS && !activePressId)) return;
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
    const attachments = shouldUseSqlStagingReads(currentPlantId)
      ? (_pressWikiAttachmentsCache || [])
      : (await getDocs(wikiAttachmentsColForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId))).docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    await Promise.allSettled(attachments.map(async a => {
      await deleteStoredAttachmentBlob(currentPlantId, a);
    }));
    if (shouldUseSqlStagingReads(currentPlantId)) {
      await dataApi.deleteWikiPage(currentPlantId, pageId, {
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
  if (!shouldUseSqlStagingReads(currentPlantId)) {
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
  const pressPickerWrap = document.querySelector('.press-wiki-press-picker-wrap');
  const pressPickerBtn = document.getElementById('press-wiki-scope-press');
  if (pressPickerWrap && !pressPickerWrap.contains(e.target) && !(pressPickerBtn && pressPickerBtn.contains(e.target))) {
    _pressWikiSetPressPickerOpen(false);
  }
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
      const attId = 'att_' + Date.now() + '_' + Math.floor(Math.random()*1000);
      const ext = file.name.split('.').pop() || 'png';
      const dataUrl = await readFileAsDataUrl(file);
      let uploadedBlob = await uploadAttachmentToPreferredStorage(currentPlantId, {
        scope: 'wiki',
        wikiScope: _pressWikiScope,
        pageId: _pressWikiSelectedPageId,
        pressId: _pressWikiScope === WIKI_SCOPE_SHARED ? '' : activePressId,
        fileName: file.name || `wiki_attachment_${attId}.${ext}`,
        contentType: file.type || 'image/png',
        dataUrl
      });
      if (!uploadedBlob?.storagePath) {
        const path = wikiStoragePrefixForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, _pressWikiSelectedPageId) + `/attachments/${attId}.${ext}`;
        const sRef = storageRef(storage, path);
        await uploadString(sRef, dataUrl, 'data_url');
        const url = await getDownloadURL(sRef);
        uploadedBlob = {
          storagePath: path,
          storageBucket: sRef.bucket,
          downloadUrl: url,
          url,
          contentType: file.type || 'image/png',
          fileName: file.name || `wiki_attachment_${attId}.${ext}`,
          uploadedAt: shouldUseSqlStagingReads(currentPlantId) ? new Date().toISOString() : serverTimestamp()
        };
      }
      
      const attDoc = {
        attachmentId: attId,
        storagePath: uploadedBlob.storagePath,
        storageBucket: uploadedBlob.storageBucket || '',
        url: uploadedBlob.downloadUrl || uploadedBlob.url || '',
        contentType: uploadedBlob.contentType || file.type,
        caption: uploadedBlob.fileName || file.name,
        uploadedBy: currentActor(),
        uploadedAt: uploadedBlob.uploadedAt || (shouldUseSqlStagingReads(currentPlantId) ? new Date().toISOString() : serverTimestamp())
      };
      if (shouldUseSqlStagingReads(currentPlantId)) {
        await dataApi.createWikiAttachment(currentPlantId, _pressWikiSelectedPageId, {
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
    
    if (uploadedCount > 0 && !shouldUseSqlStagingReads(currentPlantId)) {
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
  const url = `wiki-cms.html?plantId=${encodeURIComponent(currentPlantId)}&pressId=${encodeURIComponent(_pressWikiScope === WIKI_SCOPE_PRESS ? _pressWikiModalPressId : '')}&pageId=${encodeURIComponent(_pressWikiSelectedPageId || '')}&scope=${encodeURIComponent(_pressWikiScope)}`;
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

window.openSharedLibraryWiki = async function(options = {}) {
  if (!currentPlantId) return;
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

// ── NOTES MODAL ──
function _notesContextTitle(context = _notesContext) {
  if (!context) return 'Plant-wide';
  if (context.issueId) return context.label || 'Issue notes';
  if (context.pressId) return context.label || 'Press notes';
  return context.label || 'Plant-wide';
}

function _notesOpenPressContext() {
  if (_notesContext.pressId) {
    return {
      pressId: _notesContext.pressId,
      machineCode: _notesContext.machineCode || _notesContext.label?.replace(/^Press\s*[·-]?\s*/i, '') || ''
    };
  }
  const issue = getCurrentOpenIssue();
  const machineCode = issue?.machine || getCurrentOpenMachine();
  const pressId = issue?.pressId || (machineCode ? toPressId(machineCode) : '');
  return pressId ? { pressId, machineCode } : null;
}

function _notesOpenIssueContext() {
  if (_notesContext.issueId) {
    const issue = issues.find(i => i.id === _notesContext.issueId) || null;
    const machineCode = issue?.machine || _notesContext.machineCode || '';
    const pressId = issue?.pressId || _notesContext.pressId || (machineCode ? toPressId(machineCode) : '');
    return { issueId: _notesContext.issueId, pressId, machineCode };
  }
  const issue = getCurrentOpenIssue();
  if (!issue?.id) return null;
  const machineCode = issue.machine || '';
  return {
    issueId: issue.id,
    pressId: issue.pressId || (machineCode ? toPressId(machineCode) : ''),
    machineCode
  };
}

function _notesNormalizeDoc(note = {}) {
  const checklistItems = normalizeChecklistItems(note.checklistItems);
  const tags = Array.isArray(note.tags)
    ? note.tags.map(tag => String(tag || '').trim()).filter(Boolean)
    : String(note.tags || '').split(',').map(tag => tag.trim()).filter(Boolean);
  const bodyHtml = sanitizeNoteHtml(note.bodyHtml || note.body || '');
  const bodyText = String(note.bodyText || _noteTextFromHtml(bodyHtml) || '').trim();
  const machineCode = String(note.machineCode || '').trim();
  const pressId = String(note.pressId || '').trim();
  const issueId = String(note.issueId || '').trim();
  return {
    id: note.id,
    title: String(note.title || 'Untitled Note').trim() || 'Untitled Note',
    bodyHtml,
    bodyText,
    checklistItems,
    tags,
    pressId,
    machineCode,
    issueId,
    isPinned: Boolean(note.isPinned),
    isArchived: Boolean(note.isArchived),
    photoCount: Number(note.photoCount || 0),
    searchText: String(note.searchText || '').toLowerCase(),
    createdBy: note.createdBy || null,
    createdAt: note.createdAt || null,
    updatedBy: note.updatedBy || null,
    updatedAt: note.updatedAt || null,
    schemaVersion: Number(note.schemaVersion || 1)
  };
}

function _notesSortValue(note) {
  const updatedAt = note?.updatedAt?.toMillis?.()
    ?? note?.updatedAt?.seconds * 1000
    ?? (note?.updatedAt ? new Date(note.updatedAt).getTime() : 0);
  return {
    pinned: note?.isPinned ? 1 : 0,
    archived: note?.isArchived ? 1 : 0,
    updatedAt,
    title: String(note?.title || '').toLowerCase()
  };
}

function _notesCreateClientId(prefix = 'note') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function _notesCompare(a, b) {
  const pa = _notesSortValue(a);
  const pb = _notesSortValue(b);
  if (pa.pinned !== pb.pinned) return pb.pinned - pa.pinned;
  if (pa.archived !== pb.archived) return pa.archived - pb.archived;
  if (pa.updatedAt !== pb.updatedAt) return pb.updatedAt - pa.updatedAt;
  return pa.title.localeCompare(pb.title);
}

function _notesCurrentContextMatches(note) {
  if (!note) return false;
  if (_notesContext.issueId) {
    const issueMatch = note.issueId === _notesContext.issueId;
    const pressMatch = _notesContext.pressId ? note.pressId === _notesContext.pressId : false;
    return issueMatch || pressMatch;
  }
  if (_notesContext.pressId) return note.pressId === _notesContext.pressId;
  return true;
}

function _notesMatchesFilter(note) {
  if (!note) return false;
  const filter = _notesState.filter;
  if (filter === 'pinned' && !note.isPinned) return false;
  if (filter === 'archived' && !note.isArchived) return false;
  if (filter === 'linked') {
    if (_notesContext.pressId || _notesContext.issueId) return _notesCurrentContextMatches(note);
    if (!note.pressId && !note.issueId) return false;
  }
  const q = String(_notesState.search || '').trim().toLowerCase();
  if (!q) return true;
  const issue = note.issueId ? issues.find(i => i.id === note.issueId) : null;
  const haystack = [
    note.title,
    note.bodyText,
    note.tags.join(' '),
    note.checklistItems.map(item => item.text).join(' '),
    note.pressId,
    note.machineCode,
    note.issueId,
    issue?.machine || '',
    issue?.note || ''
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

function _notesVisibleNotes() {
  return (_notesState.notes || []).filter(_notesMatchesFilter).sort(_notesCompare);
}

function _notesDisplayTime(ts) {
  return _relativeTime(ts) || 'just now';
}

function _notesDisplayContextChip(note) {
  if (!note) return '';
  if (note.issueId) {
    const issue = issues.find(i => i.id === note.issueId);
    return issue
      ? `Issue · ${issue.machine || issue.pressId || issue.id}`
      : `Issue · ${note.issueId}`;
  }
  if (note.pressId) {
    return `Press · ${note.machineCode || note.pressId}`;
  }
  return '';
}

function _notesContextLabelForModal() {
  return _notesContextTitle(_notesContext);
}

function _notesSplitTags(value = '') {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map(tag => tag.trim().replace(/^#/, ''))
      .filter(Boolean)
  ));
}

function _notesKnownTags() {
  const tags = new Set();
  (_notesState.notes || []).forEach(note => {
    (note?.tags || []).forEach(tag => {
      const clean = String(tag || '').trim().replace(/^#/, '');
      if (clean) tags.add(clean);
    });
  });
  (_notesState.currentNote?.tags || []).forEach(tag => {
    const clean = String(tag || '').trim().replace(/^#/, '');
    if (clean) tags.add(clean);
  });
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

function _notesTagQuery() {
  const tagsEl = document.getElementById('notes-tags');
  if (!tagsEl) return '';
  const raw = String(tagsEl.value || '');
  const parts = raw.split(',');
  return String(parts[parts.length - 1] || '').trim().replace(/^#/, '');
}

function _notesRenderTagChips(note = _notesState.currentNote) {
  const wrap = document.getElementById('notes-tag-chips');
  if (!wrap) return;
  wrap.innerHTML = '';
  const tags = Array.isArray(note?.tags) ? note.tags : [];
  if (!tags.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-tag-empty';
    empty.textContent = 'No tags yet. Add one below or type # in the note body.';
    wrap.appendChild(empty);
    return;
  }
  tags.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'notes-tag-chip';
    const label = document.createElement('span');
    label.textContent = `#${tag}`;
    chip.appendChild(label);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = `Remove ${tag}`;
    remove.addEventListener('click', () => {
      if (!_notesState.currentNote) return;
      const tagsEl = document.getElementById('notes-tags');
      const current = _notesSplitTags(tagsEl?.value || '');
      const next = current.filter(item => item.toLowerCase() !== String(tag).toLowerCase());
      _notesState.currentNote.tags = next;
      if (tagsEl) tagsEl.value = next.map(t => `#${t}`).join(', ');
      _notesRenderTagChips(_notesState.currentNote);
      _notesRenderTagSuggestions(_notesState.currentNote);
      _notesState.dirty = true;
      _notesQueueAutosave();
      _notesRenderList();
    });
    chip.appendChild(remove);
    wrap.appendChild(chip);
  });
}

function _notesRenderTagSuggestions(note = _notesState.currentNote) {
  const wrap = document.getElementById('notes-tag-suggestions');
  if (!wrap) return;
  wrap.innerHTML = '';
  const currentTags = new Set((note?.tags || []).map(tag => String(tag || '').trim().replace(/^#/, '')).filter(Boolean).map(tag => tag.toLowerCase()));
  const query = _notesTagQuery().toLowerCase();
  const known = _notesKnownTags().filter(tag => !currentTags.has(tag.toLowerCase()));
  const filtered = query
    ? known.filter(tag => tag.toLowerCase().includes(query))
    : known.slice(0, 6);
  if (!filtered.length) {
    const hint = document.createElement('div');
    hint.className = 'notes-tag-empty';
    hint.textContent = query ? 'No matching tags.' : 'Suggested tags will appear here as you use them.';
    wrap.appendChild(hint);
    return;
  }
  filtered.slice(0, 8).forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notes-tag-suggestion';
    btn.textContent = `#${tag}`;
    btn.addEventListener('click', () => {
      if (!_notesState.currentNote) return;
      const tagsEl = document.getElementById('notes-tags');
      if (!tagsEl) return;
      const existing = _notesSplitTags(tagsEl.value);
      if (!existing.includes(tag)) existing.push(tag);
      tagsEl.value = existing.map(t => `#${t}`).join(', ');
      _notesState.currentNote.tags = existing;
      _notesRenderTagChips(_notesState.currentNote);
      _notesRenderTagSuggestions(_notesState.currentNote);
      _notesState.dirty = true;
      _notesQueueAutosave();
      _notesRenderList();
    });
    wrap.appendChild(btn);
  });
}

function _notesTemplateData(templateKey = 'blank') {
  switch (templateKey) {
    case 'follow_up':
      return {
        title: 'Follow-up',
        bodyHtml: '<p>Follow up on the open item after the next run.</p>',
        tags: ['follow-up'],
        checklistItems: [
          { id: `chk_${Date.now()}_a`, text: 'Confirm next check-in', done: false }
        ]
      };
    case 'parts_needed':
      return {
        title: 'Parts Needed',
        bodyHtml: '<p>List the parts, consumables, or approvals needed before this can move.</p>',
        tags: ['parts', 'materials'],
        checklistItems: [
          { id: `chk_${Date.now()}_b`, text: 'Confirm part number', done: false },
          { id: `chk_${Date.now()}_c`, text: 'Check availability', done: false }
        ]
      };
    case 'shift_handoff':
      return {
        title: 'Shift Handoff',
        bodyHtml: '<p>Summarize status, blockers, and the next shift action.</p>',
        tags: ['handoff', 'shift'],
        checklistItems: [
          { id: `chk_${Date.now()}_d`, text: 'Leave status for the next shift', done: false }
        ]
      };
    case 'issue_summary':
      return {
        title: 'Issue Summary',
        bodyHtml: '<p>Summarize the issue, impact, and next step.</p>',
        tags: ['summary', 'issue'],
        checklistItems: [
          { id: `chk_${Date.now()}_e`, text: 'Capture current impact', done: false },
          { id: `chk_${Date.now()}_f`, text: 'Capture next action', done: false }
        ]
      };
    default:
      return { title: '', bodyHtml: '', tags: [], checklistItems: [] };
  }
}

function _notesSetMenuOpen(menuId, open) {
  const menu = document.getElementById(menuId);
  const btn = document.getElementById('notes-actions-menu-btn');
  if (!menu || !btn) return;
  menu.classList.toggle('visible', !!open);
  btn.classList.toggle('open', !!open);
  btn.setAttribute('aria-expanded', String(!!open));
}

function _notesCloseMenus(exceptMenuId = null) {
  if (exceptMenuId !== 'notes-actions-menu') _notesSetMenuOpen('notes-actions-menu', false);
}

function _notesSetPreviewMode(on) {
  _notesState.previewMode = !!on;
  const card = document.querySelector('.notes-editor-card-main');
  const btn = document.getElementById('notes-preview-btn');
  const body = document.getElementById('notes-body');
  const preview = document.getElementById('notes-body-preview');
  if (card) card.classList.toggle('previewing', _notesState.previewMode);
  if (btn) {
    btn.classList.toggle('active', _notesState.previewMode);
    btn.setAttribute('aria-pressed', String(_notesState.previewMode));
  }
  if (body) body.hidden = _notesState.previewMode;
  if (preview) preview.hidden = !_notesState.previewMode;
}

function _notesRenderBodyPreview(note = _notesState.currentNote) {
  const wrap = document.getElementById('notes-body-preview');
  if (!wrap) return;
  const html = sanitizeNoteHtml(note?.bodyHtml || '');
  const text = _noteTextFromHtml(html);
  wrap.innerHTML = html || '<div class="notes-body-preview-empty">Preview appears here when enabled.</div>';
  wrap.classList.toggle('empty', !text);
}

function _notesSyncEditorHeaderTitle(noteTitle = '') {
  const headerTitleEl = document.getElementById('notes-editor-title');
  if (!headerTitleEl) return;
  const title = String(noteTitle || '').trim();
  headerTitleEl.textContent = title || 'New Note';
}

function _notesRenderContextSummary(note = _notesState.currentNote) {
  const summaryEl = document.getElementById('notes-context-summary');
  const helpEl = document.getElementById('notes-context-help');
  const pressBtn = document.getElementById('notes-link-press-btn');
  const issueBtn = document.getElementById('notes-link-issue-btn');
  if (!summaryEl) return;
  if (note?.issueId) {
    const issue = issues.find(i => i.id === note.issueId);
    summaryEl.textContent = `Linked to issue ${issue?.machine || note.issueId}`;
    if (helpEl) helpEl.textContent = 'This note is attached to the selected issue.';
    if (pressBtn) pressBtn.textContent = _notesContext.pressId ? 'Relink to Open Press' : 'Link Open Press';
    if (issueBtn) issueBtn.textContent = 'Linked to Issue';
    return;
  }
  if (note?.pressId) {
    const matchesCurrentPress = Boolean(_notesContext.pressId && note.pressId === _notesContext.pressId);
    summaryEl.textContent = matchesCurrentPress
      ? `Linked to the open press ${note.machineCode || note.pressId}`
      : `Linked to press ${note.machineCode || note.pressId}`;
    if (helpEl) helpEl.textContent = matchesCurrentPress
      ? 'The note will stay attached to the press you are viewing.'
      : 'This note is linked to a different press than the one currently open.';
    if (pressBtn) pressBtn.textContent = matchesCurrentPress ? 'Keep Open Press Link' : 'Relink to Open Press';
    if (issueBtn) issueBtn.textContent = _notesContext.issueId ? 'Link Open Issue' : 'Issue Not Open';
    return;
  }
  if (_notesContext.pressId || _notesContext.issueId) {
    summaryEl.textContent = `${_notesContextTitle(_notesContext)} note`;
    if (helpEl) helpEl.textContent = 'Attach this note to the current press or issue if it belongs with the floor work.';
    if (pressBtn) pressBtn.textContent = 'Link Open Press';
    if (issueBtn) issueBtn.textContent = 'Link Open Issue';
    return;
  }
  summaryEl.textContent = 'Plant-wide note';
  if (helpEl) helpEl.textContent = 'Use this note without attaching it to a press or issue.';
  if (pressBtn) pressBtn.textContent = 'Link Open Press';
  if (issueBtn) issueBtn.textContent = 'Link Open Issue';
}

function _notesApplyTemplate(templateKey = 'blank') {
  if (!_notesState.currentNote) return;
  const template = _notesTemplateData(templateKey);
  const titleEl = document.getElementById('notes-title');
  const tagsEl = document.getElementById('notes-tags');
  const bodyEl = document.getElementById('notes-body');
  const currentTitle = String(titleEl?.value || '').trim();
  const currentBody = String(bodyEl?.innerHTML || '').trim();
  if (titleEl && (!currentTitle || templateKey !== 'blank')) titleEl.value = template.title || currentTitle;
  if (tagsEl) {
    const tags = _notesSplitTags(tagsEl.value);
    template.tags.forEach(tag => { if (!tags.includes(tag)) tags.push(tag); });
    tagsEl.value = tags.map(tag => `#${tag}`).join(', ');
    _notesState.currentNote.tags = tags;
  }
  if (bodyEl && (!currentBody || templateKey !== 'blank')) bodyEl.innerHTML = template.bodyHtml || '';
  if (_notesState.currentNote) {
    const nextTitle = titleEl?.value || _notesState.currentNote.title;
    _notesState.currentNote.title = nextTitle;
    _notesState.currentNote.bodyHtml = sanitizeNoteHtml(bodyEl?.innerHTML || '');
    _notesState.currentNote.bodyText = _noteTextFromHtml(_notesState.currentNote.bodyHtml);
    _notesState.currentNote.checklistItems = template.checklistItems.length
      ? template.checklistItems.map(item => ({ ...item }))
      : normalizeChecklistItems(_notesState.currentNote.checklistItems);
    _notesSyncEditorHeaderTitle(nextTitle);
  }
  _notesRenderTagChips(_notesState.currentNote);
  _notesRenderTagSuggestions(_notesState.currentNote);
  _notesRenderChecklist(_notesState.currentNote);
  _notesRenderBodyPreview(_notesState.currentNote);
  _notesState.dirty = true;
  _notesQueueAutosave();
  _notesRenderList();
}

function _notesRenderList() {
  const listEl = document.getElementById('notes-list');
  if (!listEl) return;
  const visibleNotes = _notesVisibleNotes();
  if (!visibleNotes.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-list-empty';
    if (_notesState.error) {
      empty.textContent = 'Notes are unavailable for this plant right now.';
    } else {
      empty.textContent = _notesState.search || _notesState.filter !== 'all'
        ? 'No notes match this filter yet.'
        : 'No notes yet. Tap New Note to start your notebook.';
    }
    listEl.innerHTML = '';
    listEl.appendChild(empty);
    return;
  }
  listEl.innerHTML = '';
  visibleNotes.forEach(note => {
    const btn = document.createElement('div');
    btn.className = `note-card ${note.id === _notesState.activeNoteId ? 'active' : ''}`;
    btn.addEventListener('click', () => {
      void _notesSelectNote(note.id);
    });

    const top = document.createElement('div');
    top.className = 'note-title';
    
    const titleSpan = document.createElement('span');
    titleSpan.textContent = note.title || 'Untitled Note';
    top.appendChild(titleSpan);

    if (note.isPinned) {
      const pinIcon = document.createElement('span');
      pinIcon.className = 'pin-icon';
      pinIcon.textContent = '📌';
      top.appendChild(pinIcon);
    }

    const preview = document.createElement('div');
    preview.className = 'note-preview';
    const bodyPreview = note.bodyText || note.checklistItems.map(item => item.text).filter(Boolean).join(' • ');
    preview.textContent = bodyPreview || 'No content yet.';

    const meta = document.createElement('div');
    meta.className = 'note-meta';

    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'tags';
    
    // Add context/badge tags to the tags list as well
    if (note.pressId || note.issueId) {
      const linkedTag = document.createElement('span');
      linkedTag.className = 'tag';
      linkedTag.textContent = note.issueId ? '#issue' : '#press';
      tagsDiv.appendChild(linkedTag);
    }
    if (note.isArchived) {
      const archTag = document.createElement('span');
      archTag.className = 'tag';
      archTag.textContent = '#archived';
      tagsDiv.appendChild(archTag);
    }
    if (Array.isArray(note.tags)) {
      note.tags.forEach(t => {
        const tagSpan = document.createElement('span');
        tagSpan.className = 'tag';
        tagSpan.textContent = `#${t}`;
        tagsDiv.appendChild(tagSpan);
      });
    }

    const time = document.createElement('div');
    time.className = 'timestamp';
    time.textContent = _notesDisplayTime(note.updatedAt);

    meta.appendChild(tagsDiv);
    meta.appendChild(time);

    btn.appendChild(top);
    btn.appendChild(preview);
    btn.appendChild(meta);
    listEl.appendChild(btn);
  });
}

function _notesSetStatus(message, updatedMessage = '') {
  const statusEl = document.getElementById('notes-editor-save-state');
  const updatedEl = document.getElementById('notes-editor-updated');
  if (statusEl) statusEl.textContent = message || '';
  if (updatedEl) updatedEl.textContent = updatedMessage || '';
  if (statusEl) {
    const isSaving = /saving/i.test(message || '');
    const isError = /could not|failed|unavailable/i.test(message || '');
    const isOffline = !navigator.onLine && !isSaving && !isError;
    statusEl.classList.toggle('is-saving', isSaving);
    statusEl.classList.toggle('is-error', isError);
    statusEl.classList.toggle('is-offline', isOffline);
  }
}

function _notesRenderContextChips(note = _notesState.currentNote) {
  const wrap = document.getElementById('notes-context-chips');
  if (!wrap) return;
  wrap.innerHTML = '';
  const chips = [];
  if (_notesContext.pressId || _notesContext.issueId) {
    chips.push({
      label: _notesContextLabelForModal(),
      removable: false
    });
  }
  if (note?.pressId) {
    chips.push({
      label: `Press · ${note.machineCode || note.pressId}`,
      removable: true,
      onRemove: () => {
        note.pressId = '';
        note.machineCode = '';
        void _notesSaveActiveNote({ immediate: true });
      }
    });
  }
  if (note?.issueId) {
    const issue = issues.find(i => i.id === note.issueId);
    chips.push({
      label: `Issue · ${issue?.machine || note.issueId}`,
      removable: true,
      onRemove: () => {
        note.issueId = '';
        void _notesSaveActiveNote({ immediate: true });
      }
    });
  }
  if (!chips.length) {
    const chip = document.createElement('span');
    chip.className = 'notes-context-chip';
    chip.textContent = 'No linked context';
    wrap.appendChild(chip);
    return;
  }
  chips.forEach(item => {
    const chip = document.createElement('span');
    chip.className = 'notes-context-chip';
    const label = document.createElement('span');
    label.textContent = item.label;
    chip.appendChild(label);
    if (item.removable) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '✕';
      remove.addEventListener('click', () => item.onRemove?.());
      chip.appendChild(remove);
    }
    wrap.appendChild(chip);
  });
}

function _notesRenderChecklist(note = _notesState.currentNote) {
  const wrap = document.getElementById('notes-checklist');
  if (!wrap) return;
  wrap.innerHTML = '';
  const items = normalizeChecklistItems(note?.checklistItems || []);
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-checklist-empty';
    empty.textContent = 'Add quick checkboxes for follow-ups, parts, or reminders.';
    wrap.appendChild(empty);
    return;
  }
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'notes-check-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = Boolean(item.done);
    cb.addEventListener('change', () => {
      const current = _notesState.currentNote?.checklistItems || [];
      const next = current.map(chk => chk.id === item.id ? { ...chk, done: cb.checked } : chk);
      if (_notesState.currentNote) _notesState.currentNote.checklistItems = next;
      void _notesSaveActiveNote({ immediate: false });
    });
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'notes-check-text';
    input.value = item.text || '';
    input.placeholder = 'Checklist item';
    input.addEventListener('input', () => {
      const current = _notesState.currentNote?.checklistItems || [];
      const next = current.map(chk => chk.id === item.id ? { ...chk, text: input.value } : chk);
      if (_notesState.currentNote) _notesState.currentNote.checklistItems = next;
      _notesState.dirty = true;
      _notesQueueAutosave();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'notes-check-remove';
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
      const current = _notesState.currentNote?.checklistItems || [];
      const next = current.filter(chk => chk.id !== item.id);
      if (_notesState.currentNote) _notesState.currentNote.checklistItems = next;
      _notesRenderChecklist(_notesState.currentNote);
      _notesState.dirty = true;
      _notesQueueAutosave();
    });
    row.appendChild(cb);
    row.appendChild(input);
    row.appendChild(remove);
    wrap.appendChild(row);
  });
}

function _notesRenderAttachments() {
  const wrap = document.getElementById('notes-attachments');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!_notesAttachmentsCache.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-checklist-empty';
    empty.textContent = 'Attachments will appear here after upload.';
    wrap.appendChild(empty);
    return;
  }
  _notesAttachmentsCache.forEach((att, idx) => {
    const tile = document.createElement('div');
    tile.className = 'notes-attachment';
    const img = document.createElement('img');
    img.className = 'notes-attachment-thumb';
    img.src = att.url || att.downloadURL || '';
    img.alt = att.fileName || `Attachment ${idx + 1}`;
    img.addEventListener('click', () => {
      const photos = _notesAttachmentsCache.map(a => ({
        url: a.url || a.downloadURL || '',
        uploadedAt: a.uploadedAt || a.createdAt || ''
      })).filter(a => a.url);
      openLightbox(idx, photos);
    });
    const label = document.createElement('div');
    label.className = 'notes-attachment-label';
    label.textContent = att.fileName || att.caption || `Attachment ${idx + 1}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'notes-attachment-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => void _notesDeleteAttachment(att.id));
    tile.appendChild(img);
    tile.appendChild(label);
    tile.appendChild(remove);
    wrap.appendChild(tile);
  });
}

function _notesRenderEditor(note = null) {
  const titleEl = document.getElementById('notes-title');
  const tagsEl = document.getElementById('notes-tags');
  const bodyEl = document.getElementById('notes-body');
  const previewEl = document.getElementById('notes-body-preview');
  const pinBtn = document.getElementById('notes-pin-btn');
  const archiveBtn = document.getElementById('notes-archive-btn');
  const deleteBtn = document.getElementById('notes-delete-btn');
  const backBtn = document.getElementById('notes-back-btn');
  if (!titleEl || !tagsEl || !bodyEl || !pinBtn || !archiveBtn || !deleteBtn) return;

  const prevNoteId = _notesState.currentNote?.id || null;
  const activeEl = document.activeElement;
  const titleFocused = activeEl === titleEl;
  const tagsFocused = activeEl === tagsEl;
  const bodyFocused = activeEl === bodyEl;
  const sameActiveNote = Boolean(note?.id) && note.id === prevNoteId;

  _notesState.currentNote = note ? { ...note, checklistItems: normalizeChecklistItems(note.checklistItems) } : null;
  if (!note) _notesAttachmentsCache = [];
  if (!sameActiveNote) _notesState.previewMode = false;
  _notesState.dirty = false;
  _notesSetStatus(note ? 'Saved' : 'Select a note to begin.', note ? `Updated ${_notesDisplayTime(note.updatedAt)}` : '');
  _notesSyncEditorHeaderTitle(note?.title || '');

  const nextTitle = note?.title || '';
  const nextTags = Array.isArray(note?.tags) ? note.tags.join(', ') : '';
  const nextBodyHtml = note?.bodyHtml || '';

  if (!sameActiveNote || !titleFocused) titleEl.value = nextTitle;
  if (!sameActiveNote || !tagsFocused) tagsEl.value = nextTags;
  if (!sameActiveNote || !bodyFocused) bodyEl.innerHTML = nextBodyHtml;
  bodyEl.classList.toggle('empty', !note?.bodyHtml);
  if (previewEl) previewEl.hidden = !_notesState.previewMode;
  _notesSyncEditorHeaderTitle(titleEl.value || nextTitle);
  pinBtn.textContent = note?.isPinned ? 'Unpin' : 'Pin';
  archiveBtn.textContent = note?.isArchived ? 'Unarchive' : 'Archive';
  deleteBtn.disabled = !note?.id;
  titleEl.disabled = !note?.id;
  tagsEl.disabled = !note?.id;
  bodyEl.contentEditable = note?.id ? 'true' : 'false';
  bodyEl.dataset.placeholder = note?.id ? 'Write something useful...' : 'Select a note to begin.';
  if (backBtn) backBtn.disabled = !note?.id;
  document.getElementById('notes-checklist-btn')?.toggleAttribute('disabled', !note?.id);
  document.getElementById('notes-add-checklist-btn')?.toggleAttribute('disabled', !note?.id);
  document.getElementById('notes-add-checklist-inline-btn')?.toggleAttribute('disabled', !note?.id);
  document.getElementById('notes-checklist-input')?.toggleAttribute('disabled', !note?.id);
  document.getElementById('notes-photo-btn')?.toggleAttribute('disabled', !note?.id);
  document.getElementById('notes-link-press-btn')?.toggleAttribute('disabled', !note?.id || !_notesOpenPressContext());
  document.getElementById('notes-link-issue-btn')?.toggleAttribute('disabled', !note?.id || !_notesOpenIssueContext());
  _notesRenderTagChips(note);
  _notesRenderTagSuggestions(note);
  _notesRenderContextChips(note);
  _notesRenderContextSummary(note);
  _notesRenderChecklist(note);
  _notesRenderAttachments();
  _notesRenderBodyPreview(note);
  _notesSetPreviewMode(_notesState.previewMode && !!note?.id);
  _notesSyncLayout();
}

function _notesFocusBody() {
  const bodyEl = document.getElementById('notes-body');
  if (!bodyEl) return;
  const sel = window.getSelection();
  const hasBodySelection = Boolean(sel && sel.rangeCount > 0 && bodyEl.contains(sel.anchorNode));
  bodyEl.focus();
  if (hasBodySelection) return;
  const range = document.createRange();
  range.selectNodeContents(bodyEl);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function _notesFocusTitle() {
  const titleEl = document.getElementById('notes-title');
  if (!titleEl) return;
  titleEl.focus();
  titleEl.select?.();
}

function _notesDetectFormats() {
  const sel = window.getSelection();
  const fmts = { bold: false, italic: false, underline: false, bullet: false };
  if (!sel || !sel.rangeCount) return fmts;
  function walk(node) {
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      const t = node.tagName;
      if (t === 'B' || t === 'STRONG') fmts.bold = true;
      if (t === 'I' || t === 'EM') fmts.italic = true;
      if (t === 'U') fmts.underline = true;
      if (t === 'UL' || t === 'OL') fmts.bullet = true;
      if (t === 'BODY') break;
      node = node.parentElement;
    }
  }
  for (let i = 0; i < sel.rangeCount; i++) {
    const r = sel.getRangeAt(i);
    if (r.collapsed) { walk(r.startContainer); }
    else { walk(r.startContainer); walk(r.endContainer); }
  }
  return fmts;
}

function _notesIsInTag(tagName) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const tag = tagName.toUpperCase();
  for (let i = 0; i < sel.rangeCount; i++) {
    const r = sel.getRangeAt(i);
    const check = node => {
      while (node && node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === tag) return true;
        if (node.tagName === 'BODY') break;
        node = node.parentElement;
      }
      return false;
    };
    if (r.collapsed) { if (check(r.startContainer)) return true; }
    else { if (check(r.startContainer) || check(r.endContainer)) return true; }
  }
  return false;
}

function _notesWrapFormat(tagName) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const frag = range.extractContents();
  const wrapper = document.createElement(tagName);
  wrapper.appendChild(frag);
  range.insertNode(wrapper);
  sel.removeAllRanges();
  const nr = document.createRange();
  nr.selectNodeContents(wrapper);
  sel.addRange(nr);
}

function _notesUnwrapFormat(tagName) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const bodyEl = document.getElementById('notes-body');
  if (!bodyEl) return;
  const frag = range.extractContents();
  function stripTag(node, tag) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return node;
    if (node.tagName === tag) {
      const df = document.createDocumentFragment();
      Array.from(node.childNodes).forEach(c => df.appendChild(stripTag(c, tag)));
      return df;
    }
    const clone = node.cloneNode(false);
    Array.from(node.childNodes).forEach(c => clone.appendChild(stripTag(c, tag)));
    return clone;
  }
  const cleaned = stripTag(frag, tagName.toUpperCase());
  range.insertNode(cleaned);
  _notesCleanupEmptyTags(bodyEl);
  sel.removeAllRanges();
  bodyEl.focus();
}

function _notesCleanupEmptyTags(root) {
  if (!root) return;
  root.querySelectorAll('b, i, u, strong, em').forEach(el => {
    if (!el.textContent.trim() && !el.children.length) {
      el.parentNode?.removeChild(el);
    }
  });
}

function _notesApplyInlineFormat(tagName) {
  const bodyEl = document.getElementById('notes-body');
  const sel = window.getSelection();
  if (!bodyEl || !sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!bodyEl.contains(range.commonAncestorContainer)) return;
  if (range.collapsed) {
    const cmdMap = { B: 'bold', I: 'italic', U: 'underline' };
    try { document.execCommand('styleWithCSS', false, false); } catch (_) {}
    document.execCommand(cmdMap[tagName] || 'bold', false, null);
    return;
  }
  if (_notesIsInTag(tagName)) {
    _notesUnwrapFormat(tagName);
  } else {
    _notesWrapFormat(tagName);
  }
}

function _notesToolbarCommand(command) {
  const bodyEl = document.getElementById('notes-body');
  if (!bodyEl) return;
  bodyEl.focus();
  const inlineTags = { bold: 'B', italic: 'I', underline: 'U' };
  const tag = inlineTags[command];
  if (tag) {
    _notesApplyInlineFormat(tag);
  } else {
    try { document.execCommand('styleWithCSS', false, false); } catch (_) {}
    document.execCommand(command, false, null);
  }
  _notesSyncFormatButtons();
  _notesState.dirty = true;
  _notesQueueAutosave();
}

function _notesSyncFormatButtons() {
  const boldBtn = document.getElementById('notes-bold-btn');
  const italicBtn = document.getElementById('notes-italic-btn');
  const underlineBtn = document.getElementById('notes-underline-btn');
  const bulletBtn = document.getElementById('notes-bullet-btn');
  if (!boldBtn || !italicBtn) return;
  const bodyEl = document.getElementById('notes-body');
  const sel = window.getSelection();
  const inBody = Boolean(sel && sel.rangeCount > 0 && bodyEl && bodyEl.contains(sel.anchorNode));
  if (!inBody) {
    [boldBtn, italicBtn, underlineBtn, bulletBtn].forEach(b => {
      if (!b) return;
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    return;
  }
  const fmts = _notesDetectFormats();
  const sync = (btn, val) => {
    if (!btn) return;
    btn.classList.toggle('active', val);
    btn.setAttribute('aria-pressed', String(val));
  };
  sync(boldBtn, fmts.bold);
  sync(italicBtn, fmts.italic);
  sync(underlineBtn, fmts.underline);
  sync(bulletBtn, fmts.bullet);
}

async function _notesLoadAttachments(noteId) {
  _notesAttachmentsCache = [];
  const noteAttachmentsEl = document.getElementById('notes-attachments');
  if (!noteId || !noteAttachmentsEl) {
    _notesRenderAttachments();
    return [];
  }
  if (shouldUseSqlStagingReads(currentPlantId)) {
    const payload = await requireSqlRead(
      `note attachments ${noteId}`,
      () => dataApi.listNoteAttachments(currentPlantId, noteId),
      `Note attachments are missing in D1 for note ${noteId}.`
    );
    _notesAttachmentsCache = Array.isArray(payload?.attachments) ? payload.attachments.map(att => ({
      ...att,
      id: att.id || att.attachmentId || ''
    })) : [];
    _notesRenderAttachments();
    return _notesAttachmentsCache;
  }
  const snap = await getDocs(query(noteAttachmentsCol(noteId), orderBy('uploadedAt', 'desc')));
  _notesAttachmentsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  _notesRenderAttachments();
  return _notesAttachmentsCache;
}

async function _notesDeleteAttachment(attachmentId) {
  if (!_notesState.currentNote?.id || !attachmentId) return;
  const noteId = _notesState.currentNote.id;
  const att = _notesAttachmentsCache.find(item => item.id === attachmentId);
  if (!att) return;
  if (!confirm('Remove this attachment?')) return;
  try {
    await deleteStoredAttachmentBlob(currentPlantId, att);
    if (shouldUseSqlStagingReads(currentPlantId)) {
      await dataApi.deleteNoteAttachment(currentPlantId, noteId, attachmentId);
    } else {
      await deleteDoc(doc(noteAttachmentsCol(noteId), attachmentId));
    }
    _notesAttachmentsCache = _notesAttachmentsCache.filter(item => item.id !== attachmentId);
    if (_notesState.currentNote) _notesState.currentNote.photoCount = _notesAttachmentsCache.length;
    _notesRenderAttachments();
    await _notesSaveActiveNote({ immediate: true });
  } catch (e) {
    console.warn('delete note attachment failed', e);
    showGameToast(`Could not remove attachment: ${e?.message || 'error'}`);
  }
}

function _notesQueueAutosave() {
  if (!_notesState.currentNote?.id) return;
  _notesState.dirty = true;
  _notesState.saving = true;
  _notesSetStatus('Saving…', '');
  if (_notesSaveTimer) clearTimeout(_notesSaveTimer);
  _notesSaveTimer = setTimeout(() => {
    void _notesSaveActiveNote({ immediate: false });
  }, 650);
}

function _notesBuildPayload(note, { persistCreatedAt = false } = {}) {
  const titleEl = document.getElementById('notes-title');
  const tagsEl = document.getElementById('notes-tags');
  const bodyEl = document.getElementById('notes-body');
  const title = String(titleEl?.value || note?.title || '').trim() || 'Untitled Note';
  const bodyHtml = sanitizeNoteHtml(String(bodyEl?.innerHTML || note?.bodyHtml || ''));
  const bodyText = _noteTextFromHtml(bodyHtml);
  const tags = _notesSplitTags(tagsEl?.value || '');
  const checklistItems = normalizeChecklistItems(note?.checklistItems || []);
  const actor = currentActor();
  const searchText = [
    title,
    bodyText,
    tags.join(' '),
    checklistItems.map(item => item.text).join(' '),
    note?.pressId || '',
    note?.machineCode || '',
    note?.issueId || ''
  ].join(' ').toLowerCase();
  const useSql = shouldUseSqlStagingReads(currentPlantId);
  return {
    id: note?.id || '',
    noteId: note?.id || '',
    title,
    bodyHtml,
    bodyText,
    tags,
    checklistItems,
    pressId: note?.pressId || '',
    machineCode: note?.machineCode || '',
    issueId: note?.issueId || '',
    isPinned: Boolean(note?.isPinned),
    isArchived: Boolean(note?.isArchived),
    photoCount: Number(note?.photoCount || 0),
    searchText,
    updatedAt: useSql ? new Date().toISOString() : serverTimestamp(),
    updatedBy: actor,
    schemaVersion: 1,
    ...(persistCreatedAt ? {
      createdAt: note?.createdAt || (useSql ? new Date().toISOString() : serverTimestamp()),
      createdBy: note?.createdBy || actor
    } : {})
  };
}

async function _notesSaveActiveNote({ immediate = false } = {}) {
  if (!_notesState.currentNote?.id || !currentPlantId) return;
  const note = _notesState.currentNote;
  const payload = _notesBuildPayload(note, { persistCreatedAt: !note.createdAt });
  try {
    if (_notesSaveTimer) {
      clearTimeout(_notesSaveTimer);
      _notesSaveTimer = null;
    }
    if (immediate) _notesSetStatus('Saving…', '');
    if (shouldUseSqlStagingReads(currentPlantId)) {
      const response = await dataApi.updateNote(currentPlantId, note.id, payload);
      if (response?.note) {
        _notesState.currentNote = _notesNormalizeDoc(response.note);
        _notesState.notes = (_notesState.notes || [])
          .filter(item => item.id !== note.id)
          .concat(_notesState.currentNote)
          .sort(_notesCompare);
      }
    } else {
      await setDoc(noteDoc(note.id), payload, { merge: true });
    }
    _notesState.dirty = false;
    _notesState.saving = false;
    _notesState.lastSavedAt = new Date();
    _notesSetStatus('Saved', `Updated ${_notesDisplayTime(_notesState.lastSavedAt)}`);
    _notesRenderList();
  } catch (e) {
    _notesState.saving = false;
    _notesSetStatus('Could not save note', e?.message || '');
    console.warn('note save failed', e);
  }
}

async function _notesSetContextLink(kind) {
  if (!_notesState.currentNote?.id) return;
  if (kind === 'press') {
    const context = _notesOpenPressContext();
    if (!context) return;
    _notesState.currentNote.pressId = context.pressId || '';
    _notesState.currentNote.machineCode = context.machineCode || '';
  } else if (kind === 'issue') {
    const context = _notesOpenIssueContext();
    if (!context) return;
    _notesState.currentNote.issueId = context.issueId || '';
    _notesState.currentNote.pressId = context.pressId || _notesState.currentNote.pressId || '';
    _notesState.currentNote.machineCode = context.machineCode || _notesState.currentNote.machineCode || '';
  }
  _notesState.dirty = true;
  await _notesSaveActiveNote({ immediate: true });
  _notesRenderEditor(_notesState.currentNote);
}

async function _notesTogglePin() {
  if (!_notesState.currentNote?.id) return;
  _notesState.currentNote.isPinned = !_notesState.currentNote.isPinned;
  await _notesSaveActiveNote({ immediate: true });
  _notesRenderEditor(_notesState.currentNote);
}

async function _notesToggleArchive() {
  if (!_notesState.currentNote?.id) return;
  _notesState.currentNote.isArchived = !_notesState.currentNote.isArchived;
  await _notesSaveActiveNote({ immediate: true });
  _notesRenderEditor(_notesState.currentNote);
}

async function _notesCreateNewNote(templateKey = 'blank') {
  if (!currentPlantId || !_notesState.notes) return;
  const noteId = shouldUseSqlStagingReads(currentPlantId) ? _notesCreateClientId('note') : doc(notesCol()).id;
  const pressId = _notesContext.pressId || '';
  const issueId = _notesContext.issueId || '';
  const issue = issueId ? issues.find(i => i.id === issueId) : null;
  const machineCode = issue?.machine || _notesContext.label?.replace(/^Press\s+/i, '') || '';
  const template = _notesTemplateData(templateKey);
  const contextLabel = _notesContext.issueId
    ? `Issue ${machineCode || issueId}`
    : (_notesContext.pressId ? `Press ${machineCode || pressId}` : '');
  const title = contextLabel
    ? (template.title ? `${template.title} · ${contextLabel}` : contextLabel)
    : (template.title || 'New Note');
  const tags = Array.from(new Set([
    ...(template.tags || []),
    ...(pressId ? ['press'] : []),
    ...(issueId ? ['issue'] : [])
  ]));
  const draft = {
    id: noteId,
    title,
    bodyHtml: template.bodyHtml || '',
    bodyText: _noteTextFromHtml(template.bodyHtml || ''),
    checklistItems: normalizeChecklistItems(template.checklistItems || []),
    tags,
    pressId,
    machineCode,
    issueId,
    isPinned: false,
    isArchived: false,
    photoCount: 0,
    searchText: title.toLowerCase(),
    createdAt: shouldUseSqlStagingReads(currentPlantId) ? new Date().toISOString() : serverTimestamp(),
    createdBy: currentActor(),
    updatedAt: shouldUseSqlStagingReads(currentPlantId) ? new Date().toISOString() : serverTimestamp(),
    updatedBy: currentActor(),
    schemaVersion: 1
  };
  _notesState.creating = true;
  _notesState.activeNoteId = noteId;
  _notesSetView('editor');
  _notesRenderEditor(_notesNormalizeDoc(draft));
  queueMicrotask(_notesFocusTitle);
  if (shouldUseSqlStagingReads(currentPlantId)) {
    const response = await dataApi.createNote(currentPlantId, draft);
    const saved = _notesNormalizeDoc(response?.note || draft);
    _notesState.notes = (_notesState.notes || []).filter(note => note.id !== saved.id).concat(saved).sort(_notesCompare);
    _notesState.currentNote = saved;
  } else {
    await setDoc(noteDoc(noteId), draft);
  }
  await _notesLoadAttachments(noteId);
  _notesState.creating = false;
  _notesRenderList();
  _notesSetStatus('Saved', 'New note created');
}

async function _notesDeleteActiveNote() {
  if (!_notesState.currentNote?.id) return;
  const note = _notesState.currentNote;
  const ok = confirm(`Delete "${note.title || 'Untitled Note'}"? This will remove the note and its attachments.`);
  if (!ok) return;
  try {
    const attachments = shouldUseSqlStagingReads(currentPlantId)
      ? (_notesAttachmentsCache || [])
      : (await getDocs(noteAttachmentsCol(note.id))).docs.map(d => d.data() || {});
    await Promise.allSettled(attachments.map(async att => {
      await deleteStoredAttachmentBlob(currentPlantId, att);
    }));
    if (shouldUseSqlStagingReads(currentPlantId)) {
      await dataApi.deleteNote(currentPlantId, note.id);
      _notesState.notes = (_notesState.notes || []).filter(item => item.id !== note.id);
    } else {
      await _deleteWikiDocsInBatches(noteAttachmentsCol(note.id));
      await deleteDoc(noteDoc(note.id));
    }
    _notesState.activeNoteId = null;
    _notesRenderEditor(null);
    _notesRenderList();
  } catch (e) {
    console.warn('delete note failed', e);
    showGameToast(`Could not delete note: ${e?.message || 'error'}`);
  }
}

async function _notesUploadAttachments(files) {
  const noteId = _notesState.currentNote?.id;
  if (!noteId || !files || !files.length) return;
  const uploaded = [];
  try {
    for (const file of files) {
      if (!file?.type?.startsWith('image/')) continue;
      const attId = `att_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const ext = String(file.name || '').split('.').pop() || 'jpg';
      const dataUrl = await readFileAsDataUrl(file);
      let uploadedBlob = await uploadAttachmentToPreferredStorage(currentPlantId, {
        scope: 'note',
        noteId,
        fileName: file.name || `attachment_${uploaded.length + 1}.${ext}`,
        contentType: file.type || 'image/jpeg',
        dataUrl
      });
      if (!uploadedBlob?.storagePath) {
        const path = `${noteStoragePrefix(noteId)}/attachments/${attId}.${ext}`;
        let sRef = storageRef(storage, path);
        try {
          await uploadString(sRef, dataUrl, 'data_url');
        } catch (err) {
          const msg = String(err?.message || '');
          const shouldTryFallback = storageFallback && (msg.includes('Permission denied') || msg.includes('storage/unauthorized') || msg.includes('storage/bucket-not-found'));
          if (!shouldTryFallback) throw err;
          sRef = storageRef(storageFallback, path);
          await uploadString(sRef, dataUrl, 'data_url');
        }
        const url = await getDownloadURL(sRef);
        uploadedBlob = {
          storagePath: path,
          storageBucket: sRef.bucket,
          downloadUrl: url,
          url,
          contentType: file.type || 'image/jpeg',
          sizeBytes: file.size || 0,
          fileName: file.name || `attachment_${uploaded.length + 1}.${ext}`,
          uploadedAt: shouldUseSqlStagingReads(currentPlantId) ? new Date().toISOString() : serverTimestamp()
        };
      }
      const attDoc = {
        id: attId,
        attachmentId: attId,
        storagePath: uploadedBlob.storagePath,
        storageBucket: uploadedBlob.storageBucket || '',
        url: uploadedBlob.downloadUrl || uploadedBlob.url || '',
        fileName: uploadedBlob.fileName || file.name || `attachment_${uploaded.length + 1}.${ext}`,
        contentType: uploadedBlob.contentType || file.type || 'image/jpeg',
        sizeBytes: Number(uploadedBlob.sizeBytes || file.size || 0),
        uploadedBy: currentActor(),
        uploadedAt: uploadedBlob.uploadedAt || (shouldUseSqlStagingReads(currentPlantId) ? new Date().toISOString() : serverTimestamp()),
        schemaVersion: 1
      };
      if (shouldUseSqlStagingReads(currentPlantId)) {
        const response = await dataApi.createNoteAttachment(currentPlantId, noteId, attDoc);
        uploaded.push(response?.attachment ? {
          ...response.attachment,
          id: response.attachment.id || response.attachment.attachmentId || attId
        } : attDoc);
      } else {
        await setDoc(doc(noteAttachmentsCol(noteId), attId), attDoc);
        uploaded.push(attDoc);
      }
    }
    _notesAttachmentsCache = [..._notesAttachmentsCache, ...uploaded];
    if (_notesState.currentNote) _notesState.currentNote.photoCount = _notesAttachmentsCache.length;
    _notesRenderAttachments();
    const current = _notesState.currentNote;
    if (current) current.photoCount = _notesAttachmentsCache.length;
    await _notesSaveActiveNote({ immediate: true });
  } catch (e) {
    console.warn('note attachment upload failed', e);
    showGameToast(`Could not attach photo: ${e?.message || 'error'}`);
  }
}

function _notesSyncFilterButtons() {
  document.querySelectorAll('[data-notes-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-notes-filter') === _notesState.filter);
  });
}

async function _notesSelectNote(noteId) {
  if (!noteId) {
    _notesState.activeNoteId = null;
    _notesRenderEditor(null);
    _notesRenderList();
    return;
  }
  if (_notesState.currentNote?.id && _notesState.dirty) {
    await _notesSaveActiveNote({ immediate: true });
  }
  const note = _notesState.notes.find(n => n.id === noteId) || null;
  if (!note) return;
  _notesState.activeNoteId = noteId;
  _notesSetView('editor');
  _notesState.currentNote = { ...note, checklistItems: normalizeChecklistItems(note.checklistItems) };
  _notesAttachmentsCache = [];
  _notesRenderEditor(_notesState.currentNote);
  await _notesLoadAttachments(noteId);
  _notesRenderList();
  const editorPanel = document.querySelector('.notes-editor-panel');
  if (editorPanel && window.innerWidth <= 860) {
    editorPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function _notesEnsureActiveSelection() {
  const visible = _notesVisibleNotes();
  if (_notesState.activeNoteId && visible.some(note => note.id === _notesState.activeNoteId)) return;
  if (_notesIsMobileLayout()) {
    _notesState.activeNoteId = null;
    _notesRenderEditor(null);
    _notesSyncLayout();
    return;
  }
  const firstVisible = visible[0] || null;
  if (firstVisible) {
    void _notesSelectNote(firstVisible.id);
    return;
  }
  _notesState.activeNoteId = null;
  _notesRenderEditor(null);
}

function _notesSetVisible(isVisible) {
  const modal = document.getElementById('notes-modal');
  const editorModal = document.getElementById('notes-editor-modal');
  if (!modal) return;
  modal.classList.toggle('visible', !!isVisible);
  document.body.classList.toggle('notes-open', !!isVisible);
  if (!isVisible) {
    editorModal?.classList.remove('visible');
    _notesCloseMenus();
    _notesSetDropActive(false);
    _notesDragDepth = 0;
  }
  if (isVisible) _notesSyncLayout();
}

function _notesResetState() {
  if (_notesSaveTimer) clearTimeout(_notesSaveTimer);
  _notesSaveTimer = null;
  _notesAttachmentsCache = [];
  _notesState.notes = [];
  _notesState.activeNoteId = null;
  _notesState.view = 'list';
  _notesState.search = '';
  _notesState.filter = 'all';
  _notesState.saving = false;
  _notesState.dirty = false;
  _notesState.currentNote = null;
  _notesState.creating = false;
  _notesState.previewMode = false;
  _notesState.error = '';
  _notesCloseMenus();
  _notesSetDropActive(false);
  _notesDragDepth = 0;
  _notesSyncLayout();
}

async function _notesStartListener() {
  if (_notesUnsubscribe) {
    _notesUnsubscribe();
    _notesUnsubscribe = null;
  }
  if (_notesPollTimer) {
    clearTimeout(_notesPollTimer);
    _notesPollTimer = null;
  }
  if (!currentPlantId || !currentUser?.uid) {
    _notesRenderList();
    _notesRenderEditor(null);
    return;
  }
  if (shouldUseSqlStagingReads(currentPlantId)) {
    const token = ++_notesLoadToken;
    let active = true;
    _notesUnsubscribe = () => {
      active = false;
      if (_notesPollTimer) {
        clearTimeout(_notesPollTimer);
        _notesPollTimer = null;
      }
      _notesUnsubscribe = null;
    };
    const poll = async () => {
      if (!active || token !== _notesLoadToken || !currentPlantId) return;
      try {
        const payload = await requireSqlRead(
          `notes ${currentPlantId}`,
          () => dataApi.listNotes(currentPlantId, { includeArchived: true }),
          `Notes are missing in D1 for plant ${currentPlantId}.`
        );
        _notesState.error = '';
        _notesState.notes = (payload.notes || []).map(note => _notesNormalizeDoc(note)).sort(_notesCompare);
        _notesRenderList();
        _notesSyncFilterButtons();
        if (_notesState.activeNoteId) {
          const activeNote = _notesState.notes.find(note => note.id === _notesState.activeNoteId) || null;
          if (activeNote && !_notesState.dirty) {
            _notesRenderEditor(activeNote);
          } else if (!activeNote) {
            _notesState.activeNoteId = null;
            _notesRenderEditor(null);
          }
        }
        _notesEnsureActiveSelection();
      } catch (err) {
        console.warn('notes SQL poll error', err);
        _notesState.error = String(err?.message || '');
        _notesRenderList();
        _notesSetStatus('Could not load notes', err?.message || '');
      }
      if (active) _notesPollTimer = setTimeout(poll, 5000);
    };
    await poll();
    return;
  }
  const token = ++_notesLoadToken;
  const q = query(notesCol());
  _notesUnsubscribe = onSnapshot(q, snap => {
    if (token !== _notesLoadToken) return;
    _notesState.error = '';
    _notesState.notes = snap.docs.map(d => _notesNormalizeDoc({ id: d.id, ...d.data() }));
    _notesState.notes.sort(_notesCompare);
    _notesRenderList();
    _notesSyncFilterButtons();
    if (_notesState.activeNoteId) {
      const active = _notesState.notes.find(note => note.id === _notesState.activeNoteId) || null;
      if (active && !_notesState.dirty) {
        _notesRenderEditor(active);
      } else if (!active) {
        _notesState.activeNoteId = null;
        _notesRenderEditor(null);
      }
    }
    _notesEnsureActiveSelection();
  }, err => {
    console.warn('notes listener error', err);
    _notesState.error = String(err?.message || '');
    _notesRenderList();
    _notesSetStatus('Could not load notes', err?.message || '');
  });
}

window.closeNotesModal = async (options = {}) => {
  if (_notesUnsubscribe) {
    _notesUnsubscribe();
    _notesUnsubscribe = null;
  }
  if (options.preserveState) {
    if (_notesState.currentNote?.id && _notesState.dirty) {
      await _notesSaveActiveNote({ immediate: true });
    }
    _notesSetVisible(false);
    return;
  }
  _notesResetState();
  _notesSetVisible(false);
};

window.openNotesModal = async function(context = {}, options = {}) {
  if (!currentPlantId) return;
  _bindToolModalShellNavigation();
  const preserveState = !!options.preserveState;
  closeUserMenus();
  closeSortDropdown();
  window.closeExportDropdown?.();
  window.closeMessagingModal?.();
  window.closePressWikiModal?.();
  if (_notesUnsubscribe) {
    _notesUnsubscribe();
    _notesUnsubscribe = null;
  }
  if (!preserveState) {
    const pressId = String(context.pressId || '').trim();
    const issueId = String(context.issueId || '').trim();
    const issue = issueId ? issues.find(i => i.id === issueId) : null;
    const machineCode = String(context.machineCode || issue?.machine || '').trim();
    const linkedPressId = pressId || (issue?.pressId ? String(issue.pressId).trim() : '') || (machineCode ? toPressId(machineCode) : '');
    const label = String(context.label || '').trim() || (issueId
      ? `Issue · ${machineCode || issueId}`
      : (linkedPressId ? `Press · ${machineCode || linkedPressId}` : 'Plant-wide'));
    _notesContext = { pressId: linkedPressId, issueId, machineCode, label };
    _notesState.filter = context.filter || (linkedPressId || issueId ? 'linked' : 'all');
    _notesState.search = '';
    _notesState.activeNoteId = null;
    _notesState.view = 'list';
    _notesState.currentNote = null;
    _notesState.error = '';
    _notesState.previewMode = false;
    _notesAttachmentsCache = [];
  }
  _notesCloseMenus();
  _notesSetDropActive(false);
  _notesDragDepth = 0;
  _notesSetVisible(true);
  completeDemoGuideStep('tools');
  _notesSyncLayout();
  if (!preserveState) {
    _notesSetStatus('Loading notes…', _notesContextTitle(_notesContext));
    const contextEl = document.getElementById('notes-modal-context');
    if (contextEl) contextEl.textContent = _notesContextTitle(_notesContext);
    const subtitleEl = document.getElementById('notes-modal-subtitle');
    if (subtitleEl) subtitleEl.textContent = _notesContext.pressId || _notesContext.issueId
      ? 'Linked notes stay separate from the wiki, but open straight from the floor.'
      : 'Quick capture, mobile first, Apple Notes inspired.';
  }
  _notesSyncFilterButtons();
  await _notesStartListener();
  _notesRenderList();
  if (_notesState.currentNote?.id) {
    _notesRenderEditor(_notesState.currentNote);
  } else {
    _notesRenderEditor(null);
  }
  if (!_notesState.notes.length) {
    _notesSetStatus('No notes yet', 'Tap New Note to create one.');
  }
};

window.openNotesModalFromPress = function(pressOrMachineCode) {
  const machineCode = typeof pressOrMachineCode === 'string'
    ? pressOrMachineCode
    : String(pressOrMachineCode?.machine || pressOrMachineCode?.machineCode || pressOrMachineCode?.pressId || '').trim();
  const pressId = toPressId(machineCode || '');
  return window.openNotesModal?.({
    pressId,
    machineCode,
    label: machineCode ? `Press · ${machineCode}` : 'Press notes'
  });
};

window.openNotesModalFromIssue = function(issueOrId) {
  const issueId = typeof issueOrId === 'string' ? issueOrId : String(issueOrId?.id || '').trim();
  const issue = issues.find(i => i.id === issueId) || (typeof issueOrId === 'object' ? issueOrId : null);
  const pressId = issue?.pressId || toPressId(issue?.machine || '');
  return window.openNotesModal?.({
    issueId,
    pressId,
    machineCode: String(issue?.machine || '').trim(),
    label: issue ? `Issue · ${issue.machine || issue.id}` : 'Issue notes'
  });
};

document.getElementById('notes-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('notes-modal')) closeNotesModal();
});
document.getElementById('notes-search')?.addEventListener('input', e => {
  _notesState.search = String(e.target.value || '');
  _notesRenderList();
});
document.getElementById('notes-title')?.addEventListener('input', () => {
  if (_notesState.currentNote) {
    const title = document.getElementById('notes-title')?.value || '';
    _notesState.currentNote.title = title;
    _notesSyncEditorHeaderTitle(title);
    _notesQueueAutosave();
    _notesRenderList();
  }
});
document.getElementById('notes-title')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    _notesFocusBody();
  }
});
document.getElementById('notes-tags')?.addEventListener('input', () => {
  if (_notesState.currentNote) {
    _notesState.currentNote.tags = _notesSplitTags(document.getElementById('notes-tags')?.value || '');
    _notesRenderTagChips(_notesState.currentNote);
    _notesRenderTagSuggestions(_notesState.currentNote);
    _notesQueueAutosave();
    _notesRenderList();
  }
});
document.getElementById('notes-body')?.addEventListener('input', () => {
  if (_notesState.currentNote) {
    _notesState.currentNote.bodyHtml = sanitizeNoteHtml(document.getElementById('notes-body')?.innerHTML || '');
    _notesState.currentNote.bodyText = _noteTextFromHtml(_notesState.currentNote.bodyHtml);
    const tagMatches = Array.from(new Set(
      (String(_notesState.currentNote.bodyText || '').match(/#[a-z0-9][a-z0-9_-]*/gi) || [])
        .map(tag => tag.slice(1))
    ));
    if (tagMatches.length) {
      const tagsEl = document.getElementById('notes-tags');
      const merged = Array.from(new Set([...( _notesState.currentNote.tags || [] ), ...tagMatches]));
      _notesState.currentNote.tags = merged;
      if (tagsEl) tagsEl.value = merged.map(tag => `#${tag}`).join(', ');
      _notesRenderTagChips(_notesState.currentNote);
      _notesRenderTagSuggestions(_notesState.currentNote);
    }
    _notesSyncFormatButtons();
    _notesRenderBodyPreview(_notesState.currentNote);
    _notesQueueAutosave();
    _notesRenderList();
  }
});
document.getElementById('notes-body')?.addEventListener('blur', () => {
  if (_notesState.currentNote) {
    _notesState.currentNote.bodyHtml = sanitizeNoteHtml(document.getElementById('notes-body')?.innerHTML || '');
    _notesState.currentNote.bodyText = _noteTextFromHtml(_notesState.currentNote.bodyHtml);
    _notesQueueAutosave();
  }
});
document.getElementById('notes-body')?.addEventListener('keydown', e => {
  const cmd = e.metaKey || e.ctrlKey;
  if (!cmd) return;
  const key = String(e.key || '').toLowerCase();
  if (key === 'b') {
    e.preventDefault();
    _notesToolbarCommand('bold');
  } else if (key === 'i') {
    e.preventDefault();
    _notesToolbarCommand('italic');
  } else if (key === 'u') {
    e.preventDefault();
    _notesToolbarCommand('underline');
  } else if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('notes-checklist-input')?.focus();
  }
});
document.getElementById('notes-create-btn')?.addEventListener('click', () => {
  void _notesCreateNewNote();
});
document.getElementById('notes-new-btn')?.addEventListener('click', e => {
  e.preventDefault();
  void _notesCreateNewNote();
});
document.getElementById('notes-actions-menu-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  const menu = document.getElementById('notes-actions-menu');
  const isOpen = menu?.classList.contains('visible');
  _notesCloseMenus(isOpen ? null : 'notes-actions-menu');
  _notesSetMenuOpen('notes-actions-menu', !isOpen);
});
document.getElementById('notes-actions-menu')?.querySelectorAll('[data-note-template]')?.forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    _notesCloseMenus();
    const templateKey = btn.getAttribute('data-note-template') || 'blank';
    if (templateKey === 'blank' && _notesState.currentNote?.id) return;
    if (_notesState.currentNote?.id) {
      _notesApplyTemplate(templateKey);
    } else {
      void _notesCreateNewNote(templateKey);
    }
  });
});
document.getElementById('notes-actions-menu')?.querySelectorAll('button[role="menuitem"]')?.forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    _notesCloseMenus();
    if (btn.id === 'notes-actions-pin-btn') void _notesTogglePin();
    if (btn.id === 'notes-actions-archive-btn') void _notesToggleArchive();
    if (btn.id === 'notes-actions-delete-btn') void _notesDeleteActiveNote();
  });
});
document.getElementById('notes-back-btn')?.addEventListener('click', () => {
  _notesSetView('list');
  _notesRenderEditor(null);
  _notesRenderList();
});
document.getElementById('notes-pin-btn')?.addEventListener('click', () => {
  void _notesTogglePin();
});
document.getElementById('notes-archive-btn')?.addEventListener('click', () => {
  void _notesToggleArchive();
});
document.getElementById('notes-delete-btn')?.addEventListener('click', () => {
  void _notesDeleteActiveNote();
});
document.getElementById('notes-photo-btn')?.addEventListener('click', () => {
  document.getElementById('notes-photo-input')?.click();
});
document.getElementById('notes-photo-input')?.addEventListener('change', async e => {
  await _notesUploadAttachments(e.target.files);
  e.target.value = '';
});
document.getElementById('notes-bold-btn')?.addEventListener('click', () => _notesToolbarCommand('bold'));
document.getElementById('notes-italic-btn')?.addEventListener('click', () => _notesToolbarCommand('italic'));
document.getElementById('notes-underline-btn')?.addEventListener('click', () => _notesToolbarCommand('underline'));
document.getElementById('notes-bullet-btn')?.addEventListener('click', () => _notesToolbarCommand('insertUnorderedList'));
document.getElementById('notes-checklist-btn')?.addEventListener('click', () => {
  if (!_notesState.currentNote) return;
  const note = _notesState.currentNote;
  note.checklistItems = normalizeChecklistItems(note.checklistItems);
  note.checklistItems.push({ id: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text: '', done: false });
  _notesRenderChecklist(note);
  _notesQueueAutosave();
});
document.getElementById('notes-add-checklist-btn')?.addEventListener('click', () => {
  document.getElementById('notes-checklist-input')?.focus();
});
document.getElementById('notes-add-checklist-inline-btn')?.addEventListener('click', () => {
  const inp = document.getElementById('notes-checklist-input');
  const text = String(inp?.value || '').trim();
  if (!_notesState.currentNote || !text) return;
  const note = _notesState.currentNote;
  note.checklistItems = normalizeChecklistItems(note.checklistItems);
  note.checklistItems.push({ id: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text, done: false });
  if (inp) inp.value = '';
  _notesRenderChecklist(note);
  _notesQueueAutosave();
});
document.getElementById('notes-checklist-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('notes-add-checklist-inline-btn')?.click();
  }
});
document.getElementById('notes-link-press-btn')?.addEventListener('click', () => {
  void _notesSetContextLink('press');
});
document.getElementById('notes-link-issue-btn')?.addEventListener('click', () => {
  void _notesSetContextLink('issue');
});
document.getElementById('notes-preview-btn')?.addEventListener('click', () => {
  if (!_notesState.currentNote?.id) return;
  _notesSetPreviewMode(!_notesState.previewMode);
  _notesRenderBodyPreview(_notesState.currentNote);
});
document.getElementById('notes-filter-all')?.addEventListener('click', () => {
  _notesState.filter = 'all';
  _notesSyncFilterButtons();
  _notesRenderList();
});
document.getElementById('notes-filter-pinned')?.addEventListener('click', () => {
  _notesState.filter = 'pinned';
  _notesSyncFilterButtons();
  _notesRenderList();
});
document.getElementById('notes-filter-linked')?.addEventListener('click', () => {
  _notesState.filter = 'linked';
  _notesSyncFilterButtons();
  _notesRenderList();
});
document.getElementById('notes-filter-archived')?.addEventListener('click', () => {
  _notesState.filter = 'archived';
  _notesSyncFilterButtons();
  _notesRenderList();
});
document.querySelectorAll('.notes-toolbar-btn').forEach(btn => {
  btn.addEventListener('mousedown', e => {
    e.preventDefault();
  });
});
document.addEventListener('click', e => {
  if (!document.getElementById('notes-modal')?.classList.contains('visible')) return;
  const actionsWrap = document.getElementById('notes-actions-menu-btn')?.parentElement;
  if (actionsWrap && !actionsWrap.contains(e.target)) _notesSetMenuOpen('notes-actions-menu', false);
});
document.addEventListener('keydown', e => {
  if (!document.getElementById('notes-modal')?.classList.contains('visible')) return;
  const cmd = e.metaKey || e.ctrlKey;
  const key = String(e.key || '').toLowerCase();
  if (e.key === 'Escape') {
    if (document.getElementById('notes-actions-menu')?.classList.contains('visible')) {
      _notesCloseMenus();
      return;
    }
    closeNotesModal();
    return;
  }
  if (cmd && key === 's') {
    e.preventDefault();
    void _notesSaveActiveNote({ immediate: true });
    return;
  }
  if (cmd && key === 'enter') {
    e.preventDefault();
    void _notesSaveActiveNote({ immediate: true });
  }
});
document.getElementById('notes-body')?.addEventListener('mouseup', _notesSyncFormatButtons);
document.getElementById('notes-body')?.addEventListener('keyup', _notesSyncFormatButtons);
let _notesSelChangeRaf = null;
document.addEventListener('selectionchange', () => {
  if (!document.getElementById('notes-editor-modal')?.classList.contains('visible')) return;
  if (_notesSelChangeRaf) cancelAnimationFrame(_notesSelChangeRaf);
  _notesSelChangeRaf = requestAnimationFrame(_notesSyncFormatButtons);
});
let _notesBodyObserver = null;
function _notesInitBodyObserver() {
  const bodyEl = document.getElementById('notes-body');
  if (!bodyEl || _notesBodyObserver) return;
  _notesBodyObserver = new MutationObserver(() => {
    if (!document.getElementById('notes-editor-modal')?.classList.contains('visible')) return;
    _notesSyncFormatButtons();
  });
  _notesBodyObserver.observe(bodyEl, { childList: true, subtree: true, characterData: true });
}
_notesInitBodyObserver();
let _notesDragDepth = 0;
function _notesSetDropActive(active) {
  const shell = document.querySelector('#notes-editor-frame');
  const hint = document.getElementById('notes-drop-hint');
  shell?.classList.toggle('drop-active', !!active);
  if (hint) hint.textContent = active ? 'Drop images to attach them here.' : 'Drag images here, or paste screenshots directly into the note.';
}
document.addEventListener('dragenter', e => {
  if (!document.getElementById('notes-modal')?.classList.contains('visible')) return;
  const hasFiles = Array.from(e.dataTransfer?.items || []).some(item => item.kind === 'file' && item.type.startsWith('image/'));
  if (!hasFiles) return;
  e.preventDefault();
  _notesDragDepth += 1;
  _notesSetDropActive(true);
});
document.addEventListener('dragover', e => {
  if (!document.getElementById('notes-modal')?.classList.contains('visible')) return;
  const hasFiles = Array.from(e.dataTransfer?.items || []).some(item => item.kind === 'file');
  if (!hasFiles) return;
  e.preventDefault();
  _notesSetDropActive(true);
});
document.addEventListener('dragleave', e => {
  if (!document.getElementById('notes-modal')?.classList.contains('visible')) return;
  const hasFiles = Array.from(e.dataTransfer?.items || []).some(item => item.kind === 'file');
  if (!hasFiles) return;
  _notesDragDepth = Math.max(0, _notesDragDepth - 1);
  if (_notesDragDepth === 0) _notesSetDropActive(false);
});
document.addEventListener('drop', async e => {
  if (!document.getElementById('notes-modal')?.classList.contains('visible')) return;
  const files = Array.from(e.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  _notesDragDepth = 0;
  _notesSetDropActive(false);
  await _notesUploadAttachments(files);
});
document.addEventListener('paste', e => {
  if (!document.getElementById('notes-modal')?.classList.contains('visible')) return;
  const files = Array.from(e.clipboardData?.items || [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter(Boolean);
  if (!files.length) return;
  e.preventDefault();
  void _notesUploadAttachments(files);
});
window.addEventListener('resize', () => {
  if (document.getElementById('notes-modal')?.classList.contains('visible')) {
    _notesSyncLayout();
    _notesEnsureActiveSelection();
  }
});

// ── EXPORT TOOL ──
const exportTool = initExportTool({
  getIssues: () => issues,
  getCurrentSort: () => currentSort,
  getIssueRowScope: () => issueRowScope,
  getActiveRows: () => activeRows,
  getPresses: () => PRESSES,
  getIssueScope: () => issueScope,
  getCurrentUser: () => currentUser,
  getCurrentPlantId: () => currentPlantId,
  periodFilter,
  issueHasActiveStatus,
  applySortOrder,
  getStatuses: () => STATUSES,
  currentStatusKey,
  alphaColor,
  esc,
  localDateStr,
  completeDemoGuideStep,
  fetchIssueEventHistory,
  fetchAttachmentPhotos,
  toRowId,
  getStatusDef,
  getHtml2Pdf: () => window.html2pdf,
  getXlsx: () => window.XLSX
});

function openExportModal() {
  return exportTool.openModal();
}

function closeExportModal() {
  return exportTool.closeModal();
}

function downloadPDF() {
  return exportTool.downloadPDF();
}

function downloadExcel() {
  return exportTool.downloadExcel();
}

window.openExportModal = openExportModal;
window.closeExportModal = closeExportModal;
window.downloadPDF = downloadPDF;
window.downloadExcel = downloadExcel;

// ── ADMIN PANEL ──
const ADMIN_ICONS = ['🔧','🔩','⚙️','🎛️','🚀','🔍','⚠️','🛠️','🔬','📋','🏭','💡','🔄','📦','🧪','🔑','⛽','🖨️','🤖','🧲','🔒','🔓','📡','🧯','🔌','💧','🌡️','🔋','🪛','🪚','📏','🧰','🔦','🚨','🛞','⚡','🧹','🪝','🗜️','📐'];
const ADMIN_COLORS = [
  {name:'Red',hex:'#ef4444'},{name:'Rose',hex:'#fb7185'},{name:'Orange',hex:'#f97316'},
  {name:'Amber',hex:'#f59e0b'},{name:'Yellow',hex:'#eab308'},{name:'Lime',hex:'#84cc16'},
  {name:'Green',hex:'#22c55e'},{name:'Emerald',hex:'#10b981'},{name:'Teal',hex:'#14b8a6'},
  {name:'Cyan',hex:'#06b6d4'},{name:'Sky',hex:'#38bdf8'},{name:'Blue',hex:'#3b82f6'},
  {name:'Indigo',hex:'#6366f1'},{name:'Violet',hex:'#8b5cf6'},{name:'Purple',hex:'#a855f7'},
  {name:'Fuchsia',hex:'#d946ef'},{name:'Pink',hex:'#ec4899'},{name:'Slate',hex:'#64748b'},
  {name:'Zinc',hex:'#71717a'},{name:'Stone',hex:'#78716c'},
];
let adminDraft = {};
let newCatIcon = ADMIN_ICONS[0];
let newCatColor = ADMIN_COLORS[0];

function normalizeLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeForCompare(value) {
  return normalizeLabel(value).toLocaleLowerCase();
}

function slugifyStatusLabel(value) {
  const slug = normalizeLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'custom-status';
}

function makeStatusKey() {
  return `status_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function buildAdminIconPicker(container, getCurrent, onSelect) {
  container.innerHTML = '';
  ADMIN_ICONS.forEach(ic => {
    const opt = document.createElement('div'); opt.className = 'icon-opt' + (ic === getCurrent() ? ' selected' : '');
    opt.textContent = ic;
    const sel = () => { onSelect(ic); container.querySelectorAll('.icon-opt').forEach(o => o.classList.remove('selected')); opt.classList.add('selected'); };
    addTapListener(opt, sel);
    container.appendChild(opt);
  });
}
function buildAdminColorPicker(container, getCurrent, onSelect) {
  container.innerHTML = '';
  ADMIN_COLORS.forEach(c => {
    const opt = document.createElement('div'); opt.className = 'color-opt' + (c.hex === getCurrent() ? ' selected' : '');
    opt.style.background = c.hex; opt.title = c.name;
    opt.innerHTML = '<span class="check">✓</span>';
    const sel = () => { onSelect(c); container.querySelectorAll('.color-opt').forEach(o => o.classList.remove('selected')); opt.classList.add('selected'); };
    addTapListener(opt, sel);
    container.appendChild(opt);
  });
}

function openAdminPanel() {
  document.getElementById('user-dropdown').classList.remove('visible');
  document.getElementById('user-pill').classList.remove('open');
  adminDraft = JSON.parse(JSON.stringify(STATUSES));
  newCatIcon = ADMIN_ICONS[0]; newCatColor = ADMIN_COLORS[0];
  renderAdminList();
  document.getElementById('admin-overlay').classList.add('visible');
}

function renderAdminList() {
  const list = document.getElementById('admin-status-list'); list.innerHTML = '';

  Object.entries(adminDraft)
    .filter(([k]) => k !== 'open' && k !== 'resolved')
    .sort((a, b) => getStatusLabel(a[0], 'short').localeCompare(getStatusLabel(b[0], 'short'), undefined, { sensitivity: 'base' }))
    .forEach(([key, st]) => {
      const row = document.createElement('div'); row.className = 'admin-status-row';

      // Declare editPreviewPill and updateEditPreview early so they can be referenced by name input
      const editPreviewPill = document.createElement('span'); editPreviewPill.className = 'admin-edit-preview-pill';
      const updateEditPreview = () => {
        const col = st.color || st.swipeColor || st.cssColor;
        editPreviewPill.textContent = (adminDraft[key].icon||st.icon)+' '+(adminDraft[key].label||st.label);
        editPreviewPill.style.color=col; editPreviewPill.style.borderColor=alphaColor(col,0.53); editPreviewPill.style.background=alphaColor(col,0.09);
        iconEl.textContent = adminDraft[key].icon || st.icon;
      };

      // Name row
      const top = document.createElement('div'); top.className = 'admin-status-top';
      const iconEl = document.createElement('span'); iconEl.className = 'admin-status-icon'; iconEl.textContent = st.icon;
      const nameInput = document.createElement('input'); nameInput.className = 'admin-label-input';
      nameInput.value = st.label; nameInput.placeholder = 'Status name';
      nameInput.addEventListener('input', () => { adminDraft[key].label = nameInput.value; adminDraft[key].shortLabel = nameInput.value; updateEditPreview(); });
      top.appendChild(iconEl); top.appendChild(nameInput); row.appendChild(top);

      // Sub-statuses
      const subsLabel = document.createElement('div'); subsLabel.className = 'admin-subs-label'; subsLabel.textContent = 'Sub-statuses';
      row.appendChild(subsLabel);
      const subsList = document.createElement('div'); subsList.className = 'admin-subs-list'; row.appendChild(subsList);
      const renderSubs = () => {
        subsList.innerHTML = '';
        const sortedSubs = (adminDraft[key].subs || [])
          .map((sub, idx) => ({ sub, idx }))
          .sort((a, b) => a.sub.localeCompare(b.sub, undefined, { sensitivity: 'base' }));
        sortedSubs.forEach(({ sub, idx }) => {
          const chip = document.createElement('div'); chip.className = 'admin-sub-chip';
          const span = document.createElement('span'); span.textContent = sub;
          const rm = document.createElement('button'); rm.className = 'admin-sub-remove'; rm.textContent = '✕';
          addTapListener(rm, () => { adminDraft[key].subs.splice(idx,1); renderSubs(); });
          chip.appendChild(span); chip.appendChild(rm); subsList.appendChild(chip);
        });
      };
      renderSubs();
      const addRowEl = document.createElement('div'); addRowEl.className = 'admin-add-sub';
      const addInput = document.createElement('input'); addInput.className = 'admin-add-input'; addInput.placeholder = 'Add sub-status…';
      const addBtn = document.createElement('button'); addBtn.className = 'admin-add-btn'; addBtn.textContent = '+ Add';
      const doAdd = () => {
        const val = addInput.value.trim();
        if (!val) return;
        if (!adminDraft[key].subs) adminDraft[key].subs = [];
        adminDraft[key].subs.push(val);
        adminDraft[key].subs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        addInput.value = '';
        renderSubs();
      };
      addTapListener(addBtn, doAdd);
      addInput.addEventListener('keydown', e => { if(e.key==='Enter') doAdd(); });
      addRowEl.appendChild(addInput); addRowEl.appendChild(addBtn); row.appendChild(addRowEl);

      const bulkBtn = document.createElement('button');
      bulkBtn.className = 'admin-edit-btn';
      bulkBtn.style.marginTop = '6px';
      bulkBtn.textContent = '📝 Bulk Edit Sub-statuses';
      const bulkPanel = document.createElement('div');
      bulkPanel.className = 'admin-edit-panel';
      const bulkLabel = document.createElement('div');
      bulkLabel.className = 'admin-edit-section-label';
      bulkLabel.textContent = 'One sub-status per line';
      const bulkInput = document.createElement('textarea');
      bulkInput.style.width = '100%';
      bulkInput.style.minHeight = '120px';
      bulkInput.style.background = 'var(--color-surface, var(--bg2))';
      bulkInput.style.border = '1px solid var(--color-border, var(--border))';
      bulkInput.style.borderRadius = '8px';
      bulkInput.style.padding = '10px';
      bulkInput.style.color = 'var(--color-text, var(--text))';
      bulkInput.style.fontFamily = "'Nunito', sans-serif";
      bulkInput.style.fontSize = '13px';
      const bulkActions = document.createElement('div');
      bulkActions.style.display = 'flex';
      bulkActions.style.gap = '8px';
      bulkActions.style.marginTop = '8px';
      const bulkCancel = document.createElement('button');
      bulkCancel.className = 'admin-confirm-delete-no';
      bulkCancel.textContent = 'Cancel';
      const bulkApply = document.createElement('button');
      bulkApply.className = 'admin-confirm-delete-yes';
      bulkApply.textContent = 'Apply';
      const openBulkEditor = () => {
        bulkInput.value = (adminDraft[key].subs || []).join('\n');
        bulkPanel.classList.add('visible');
      };
      const applyBulkEditor = () => {
        const seen = new Set();
        const parsed = bulkInput.value
          .split('\n')
          .map(v => normalizeLabel(v))
          .filter(Boolean)
          .filter(v => {
            const cmp = normalizeForCompare(v);
            if (seen.has(cmp)) return false;
            seen.add(cmp);
            return true;
          });
        adminDraft[key].subs = parsed;
        renderSubs();
        bulkPanel.classList.remove('visible');
      };
      addTapListener(bulkBtn, openBulkEditor);
      addTapListener(bulkCancel, () => bulkPanel.classList.remove('visible'));
      addTapListener(bulkApply, applyBulkEditor);
      bulkActions.appendChild(bulkCancel);
      bulkActions.appendChild(bulkApply);
      bulkPanel.appendChild(bulkLabel);
      bulkPanel.appendChild(bulkInput);
      bulkPanel.appendChild(bulkActions);
      row.appendChild(bulkBtn);
      row.appendChild(bulkPanel);

      // Edit icon/color panel
      const editPanel = document.createElement('div'); editPanel.className = 'admin-edit-panel';
      const iconSecLabel = document.createElement('div'); iconSecLabel.className = 'admin-edit-section-label'; iconSecLabel.textContent = 'Icon';
      editPanel.appendChild(iconSecLabel);
      const editIconPicker = document.createElement('div'); editIconPicker.className = 'icon-picker';
      editPanel.appendChild(editIconPicker);
      const colorSecLabel = document.createElement('div'); colorSecLabel.className = 'admin-edit-section-label'; colorSecLabel.style.marginTop='10px'; colorSecLabel.textContent = 'Color';
      editPanel.appendChild(colorSecLabel);
      const editColorPicker = document.createElement('div'); editColorPicker.className = 'color-picker';
      editPanel.appendChild(editColorPicker);
      const editPreviewLabel = document.createElement('div'); editPreviewLabel.className = 'admin-edit-section-label'; editPreviewLabel.style.marginTop='10px'; editPreviewLabel.textContent = 'Preview';
      editPanel.appendChild(editPreviewLabel);
      editPanel.appendChild(editPreviewPill);
      buildAdminIconPicker(editIconPicker, ()=>adminDraft[key].icon||st.icon, ic => { adminDraft[key].icon=ic; updateEditPreview(); });
      buildAdminColorPicker(editColorPicker, ()=>adminDraft[key].color||st.swipeColor||st.cssColor, c => { adminDraft[key].color=c.hex; adminDraft[key].swipeColor=c.hex; adminDraft[key].cssColor=c.hex; updateEditPreview(); });
      updateEditPreview();
      const doneBtn = document.createElement('button'); doneBtn.className = 'admin-edit-done'; doneBtn.textContent = '✓ Done';
      addTapListener(doneBtn, () => { editPanel.classList.remove('visible'); editBtnEl.textContent='✏️ Edit Icon & Color'; });
      editPanel.appendChild(doneBtn);
      row.appendChild(editPanel);

      // Confirm delete panel
      const confirmDel = document.createElement('div'); confirmDel.className = 'admin-confirm-delete';
      const confirmText = document.createElement('div'); confirmText.className = 'admin-confirm-delete-text'; confirmText.textContent = `Delete "${st.label}"? This cannot be undone.`;
      const confirmActions = document.createElement('div'); confirmActions.className = 'admin-confirm-delete-actions';
      const yesBtn = document.createElement('button'); yesBtn.className = 'admin-confirm-delete-yes'; yesBtn.textContent = 'Delete';
      const noBtn = document.createElement('button'); noBtn.className = 'admin-confirm-delete-no'; noBtn.textContent = 'Cancel';
      const doDelete = () => { delete adminDraft[key]; renderAdminList(); };
      addTapListener(yesBtn, doDelete);
      addTapListener(noBtn, () => confirmDel.classList.remove('visible'));
      confirmActions.appendChild(noBtn); confirmActions.appendChild(yesBtn);
      confirmDel.appendChild(confirmText); confirmDel.appendChild(confirmActions);
      row.appendChild(confirmDel);

      // Action buttons
      const actionsRow = document.createElement('div'); actionsRow.className = 'admin-row-actions';

      const editBtnEl = document.createElement('button'); editBtnEl.className = 'admin-edit-btn'; editBtnEl.textContent = '✏️ Edit Icon & Color';
      addTapListener(editBtnEl, () => { const open=editPanel.classList.toggle('visible'); editBtnEl.textContent=open?'▲ Close':'✏️ Edit Icon & Color'; if(open)confirmDel.classList.remove('visible'); });
      const deleteBtnEl = document.createElement('button'); deleteBtnEl.className = 'admin-delete-btn'; deleteBtnEl.textContent = '🗑 Delete';
      addTapListener(deleteBtnEl, () => { confirmDel.classList.toggle('visible'); if(confirmDel.classList.contains('visible'))editPanel.classList.remove('visible'); });
      actionsRow.appendChild(editBtnEl); actionsRow.appendChild(deleteBtnEl);
      row.appendChild(actionsRow);
      list.appendChild(row);
    });

  // Add category trigger + form
  const trigger = document.createElement('button'); trigger.className = 'add-cat-trigger'; trigger.textContent = '＋ Add Category';
  const form = document.createElement('div'); form.className = 'add-cat-form';
  const addError = document.createElement('div');
  addError.style.color = 'var(--color-danger, var(--red))';
  addError.style.fontSize = '12px';
  addError.style.marginBottom = '8px';
  addError.style.display = 'none';
  const setAddError = (msg = '') => {
    addError.textContent = msg;
    addError.style.display = msg ? 'block' : 'none';
  };

  // Name
  const nameFieldLabel = document.createElement('div'); nameFieldLabel.className = 'add-cat-field-label'; nameFieldLabel.textContent = 'Category Name';
  const nameInput2 = document.createElement('input'); nameInput2.className = 'add-cat-name-input'; nameInput2.placeholder = 'e.g. Quality'; nameInput2.maxLength = 30;
  const nameWrap = document.createElement('div'); nameWrap.appendChild(nameFieldLabel); nameWrap.appendChild(nameInput2);
  form.appendChild(nameWrap);

  // Icon picker
  const iconFieldLabel = document.createElement('div'); iconFieldLabel.className = 'add-cat-field-label'; iconFieldLabel.textContent = 'Icon';
  const newIconPicker = document.createElement('div'); newIconPicker.className = 'icon-picker';
  const iconWrap = document.createElement('div'); iconWrap.appendChild(iconFieldLabel); iconWrap.appendChild(newIconPicker);
  form.appendChild(iconWrap);

  // Color picker
  const colorFieldLabel = document.createElement('div'); colorFieldLabel.className = 'add-cat-field-label'; colorFieldLabel.textContent = 'Color';
  const newColorPicker = document.createElement('div'); newColorPicker.className = 'color-picker';
  const colorWrap = document.createElement('div'); colorWrap.appendChild(colorFieldLabel); colorWrap.appendChild(newColorPicker);
  form.appendChild(colorWrap);

  // Preview
  const previewWrap = document.createElement('div'); previewWrap.className = 'add-cat-preview';
  const previewLbl = document.createElement('span'); previewLbl.className = 'preview-label'; previewLbl.textContent = 'Pill →';
  const previewPill = document.createElement('span'); previewPill.className = 'preview-pill';
  previewWrap.appendChild(previewLbl); previewWrap.appendChild(previewPill);
  form.appendChild(previewWrap);

  // Declare updateNewPreview BEFORE any listeners that reference it
  const updateNewPreview = () => {
    const name = nameInput2.value.trim() || 'New Category';
    previewPill.textContent = newCatIcon + ' ' + name;
    previewPill.style.color = newCatColor.hex; previewPill.style.borderColor = alphaColor(newCatColor.hex,0.53); previewPill.style.background = alphaColor(newCatColor.hex,0.09);
  };

  nameInput2.addEventListener('input', updateNewPreview);
  addTapListener(trigger, () => { setAddError(''); form.classList.add('visible'); trigger.style.display='none'; updateNewPreview(); });

  buildAdminIconPicker(newIconPicker, () => newCatIcon, ic => { newCatIcon = ic; updateNewPreview(); });
  buildAdminColorPicker(newColorPicker, () => newCatColor.hex, c => { newCatColor = c; updateNewPreview(); });
  updateNewPreview();

  // Actions
  const formActions = document.createElement('div'); formActions.className = 'add-cat-actions';
  const cancelBtn2 = document.createElement('button'); cancelBtn2.className = 'add-cat-cancel'; cancelBtn2.textContent = 'Cancel';
  const confirmBtn = document.createElement('button'); confirmBtn.className = 'add-cat-confirm'; confirmBtn.textContent = 'Add Category';
  const hideForm = () => { setAddError(''); form.classList.remove('visible'); trigger.style.display=''; nameInput2.value=''; newCatIcon=ADMIN_ICONS[0]; newCatColor=ADMIN_COLORS[0]; buildAdminIconPicker(newIconPicker,()=>newCatIcon,ic=>{newCatIcon=ic;updateNewPreview();}); buildAdminColorPicker(newColorPicker,()=>newCatColor.hex,c=>{newCatColor=c;updateNewPreview();}); updateNewPreview(); };
  const doAdd2 = () => {
    const name = normalizeLabel(nameInput2.value); if (!name) { nameInput2.focus(); return; }
    const duplicateLabel = Object.values(adminDraft).some(v => normalizeForCompare(v.label) === normalizeForCompare(name));
    if (duplicateLabel) {
      setAddError('A category with that name already exists.');
      return;
    }
    let key = makeStatusKey();
    while (adminDraft[key]) key = makeStatusKey();
    const slug = slugifyStatusLabel(name);
    const maxOrder = Math.max(...Object.values(adminDraft).map(v=>v.order||0));
    adminDraft[key] = { label:name, shortLabel:name, icon:newCatIcon, color:newCatColor.hex, swipeColor:newCatColor.hex, cssColor:newCatColor.hex, floorCls:'has-'+slug, cls:'status-'+slug, subs:[], order:maxOrder+1 };
    hideForm(); renderAdminList();
  };
  addTapListener(cancelBtn2, hideForm);
  addTapListener(confirmBtn, doAdd2);
  formActions.appendChild(cancelBtn2); formActions.appendChild(confirmBtn);
  form.appendChild(addError);
  form.appendChild(formActions);
  list.appendChild(trigger); list.appendChild(form);
}

function closeAdminPanel() {
  document.getElementById('admin-overlay').classList.remove('visible');
}

window.resetToDefaults = async () => {
  if (!confirm('Reset to comprehensive manufacturing categories? This will replace your current configuration.')) return;
  
  // Reset STATUSES to the comprehensive defaults from the code
  STATUSES = {
    open:            { label:'Open',             shortLabel:'Open',         icon:'●',  cssColor:'var(--color-danger, var(--red))',      swipeColor:'#ef4444', floorCls:'has-open',            cls:'status-open',            subs:['New Fault / Issue','Pending Triage','Scheduled Mold Change','Re-opened'],                                               statLabel:'Open',          order:0 },
    alert:           { label:'Alert',            shortLabel:'Alert',        icon:'🚨', cssColor:'#dc2626',         swipeColor:'#dc2626', floorCls:'has-alert',           cls:'status-alert',           subs:['Mold Protection Fault','E-Stop / Safety Hazard','Press Down - Critical','Major Oil / Fluid Leak'],                   statLabel:'Alert',         order:1 },
    attention:       { label:'Attention',        shortLabel:'Attention',    icon:'◇',  cssColor:'#0ea5e9',         swipeColor:'#0ea5e9', floorCls:'has-attention',       cls:'status-attention',       subs:['Watch Item','Needs Follow-up','Housekeeping','PM Opportunity','Operator Note','Check Next Run'],                  statLabel:'Attention',     order:1.5 },
    controlman:      { label:'Controlman',       shortLabel:'Controlman',   icon:'🎛️', cssColor:'var(--color-babyblue, var(--babyblue))', swipeColor:'#38bdf8', floorCls:'has-controlman',      cls:'status-controlman',      subs:['Color Change','Mold Change','Robot / EOAT (End of Arm Tooling) Fault','Vision System / Camera Error','Conveyor / Auxiliary Comm Loss','PLC / HMI Error'], statLabel:'Controlman',    order:2 },
    maintenance:     { label:'Maintenance',      shortLabel:'Maintenance',  icon:'🔧', cssColor:'var(--color-warning, var(--yellow))',   swipeColor:'#eab308', floorCls:'has-maintenance',     cls:'status-maintenance',     subs:['Hydraulic Leak / Pressure Drop','Heater Band / Thermocouple Failure','Barrel / Screw / Check Ring Issue','Chiller / Thermolator Failure'], statLabel:'Maintenance',   order:3 },
    materials:       { label:'Materials',        shortLabel:'Materials',    icon:'📦', cssColor:'#8b5cf6',         swipeColor:'#8b5cf6', floorCls:'has-materials',       cls:'status-materials',       subs:['Resin Moisture / Drying Issue','Colorant / Masterbatch Ratio Error','Vacuum / Material Loader Blockage','Wrong Resin / Regrind Issue'], statLabel:'Materials',     order:4 },
    processengineer: { label:'Process Engineer', shortLabel:'Process Eng.', icon:'⚙️', cssColor:'var(--color-purple, var(--purple))',   swipeColor:'#a855f7', floorCls:'has-processengineer', cls:'status-processengineer', subs:['Fill / Pack Pressure Adjustment','Temperature Profile Tuning','Cycle Time Optimization','Process Drift / Instability'], statLabel:'Process Eng.',  order:5 },
    quality:         { label:'Quality',          shortLabel:'Quality',      icon:'✨', cssColor:'#06b6d4',         swipeColor:'#06b6d4', floorCls:'has-quality',         cls:'status-quality',         subs:['Short Shot / Non-fill','Flash / Burrs','Sink Marks / Voids','Splay / Silver Streaks','Burn Marks / Degradation','Warp / Dimensional Out-of-Spec'], statLabel:'Quality',       order:6 },
    startup:         { label:'Startup',          shortLabel:'Startup',      icon:'🚀', cssColor:'var(--color-teal, var(--teal))',     swipeColor:'#14b8a6', floorCls:'has-startup',         cls:'status-startup',         subs:['Purging / Color Change','Mold Heat-Up / Stabilization','First Article Inspection (FAI)','Robot Homing / Path Setup'], statLabel:'Startup',       order:7 },
    tooldie:         { label:'Tool & Die',       shortLabel:'Tool & Die',   icon:'🔩', cssColor:'var(--color-orange, var(--orange))',   swipeColor:'#f97316', floorCls:'has-tooldie',         cls:'status-tooldie',         subs:['Broken / Bent Ejector Pin','Hot Runner / Gate Issue','Water Leak in Mold','Stuck Part / Sprue','Mold Greasing / PM'], statLabel:'Tool & Die',    order:8 },
    resolved:        { label:'Resolved',         shortLabel:'Resolved',     icon:'✓',  cssColor:'var(--color-success, var(--green))',    swipeColor:'#22c55e', floorCls:'all-resolved',        cls:'status-resolved',        subs:['Process Parameter Adjusted','Mold Cleaned / Repaired','Hardware Replaced','Temporary Workaround'],                      statLabel:'Resolved',      order:9 },
  };
  SUBCATEGORY_ROUTES = {};
  
  // Save to Firestore
  await saveConfig();
  
  // Rebuild UI
  rebuildDerivedStatus();
  refreshStatusDependentUI();
  
  // Refresh admin panel if open
  if (document.getElementById('admin-overlay').classList.contains('visible')) {
    renderAdminPanel();
  }
  
  alert('✅ Reset complete! Comprehensive manufacturing categories have been restored.');
};

async function saveAdminConfig() {
  const btn = document.getElementById('admin-save-btn');
  btn.classList.add('admin-saving'); btn.textContent = 'Saving…';
  try {
    const deletedStatusKeys = Object.keys(STATUSES).filter(k => k !== 'open' && k !== 'resolved' && !adminDraft[k]);
    const deletedSubByStatus = {};
    Object.entries(STATUSES)
      .filter(([k]) => k !== 'open' && k !== 'resolved' && adminDraft[k])
      .forEach(([k, v]) => {
        const before = Array.isArray(v.subs) ? v.subs.map(normalizeForCompare) : [];
        const after = new Set((adminDraft[k].subs || []).map(normalizeForCompare));
        const removed = before.filter(sub => sub && !after.has(sub));
        if (removed.length) deletedSubByStatus[k] = removed;
      });
    if (deletedStatusKeys.length || Object.keys(deletedSubByStatus).length) {
      const impactedStatusCount = issues.filter(i => deletedStatusKeys.includes(i.status)).length;
      let impactedSubsCount = 0;
      Object.entries(deletedSubByStatus).forEach(([statusKey, removedSubs]) => {
        const removedSet = new Set(removedSubs);
        impactedSubsCount += issues.filter(i => i.status === statusKey && removedSet.has(normalizeForCompare(i.subStatus))).length;
      });
      const ok = confirm(
        `Potential impact detected:\n` +
        `• ${deletedStatusKeys.length} deleted categories affecting ${impactedStatusCount} issue(s)\n` +
        `• ${Object.keys(deletedSubByStatus).length} categories with removed sub-statuses affecting ${impactedSubsCount} issue(s)\n\n` +
        `Continue saving anyway?`
      );
      if (!ok) {
        btn.textContent = 'Save cancelled';
        return;
      }
    }
    // Apply draft to live STATUSES — preserve open/resolved
    const preserved = { open: STATUSES.open, resolved: STATUSES.resolved };
    STATUSES = { ...preserved };
    Object.entries(adminDraft)
      .filter(([k]) => k !== 'open' && k !== 'resolved')
      .forEach(([k,v]) => { STATUSES[k] = v; });
    await saveConfig();
    rebuildDerivedStatus();
    closeAdminPanel();
    refreshStatusDependentUI();
    btn.textContent = '✓ Saved!';
  } catch(e) {
    btn.textContent = '✕ Error — try again'; console.error(e);
  } finally {
    btn.classList.remove('admin-saving');
    setTimeout(() => { btn.textContent = '💾 Save & Apply'; }, 2000);
  }
}

document.getElementById('admin-panel-btn')?.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); openAdminPanel(); }, { passive: false });
document.getElementById('admin-panel-btn')?.addEventListener('click', e => { e.stopPropagation(); openAdminPanel(); });
document.getElementById('admin-overlay')?.addEventListener('click', () => { closeAdminPanel(); });
document.getElementById('admin-panel-inner')?.addEventListener('click', e => { e.stopPropagation(); });
document.getElementById('admin-close-btn')?.addEventListener('touchend', e => { e.preventDefault(); closeAdminPanel(); }, { passive: false });
document.getElementById('admin-close-btn')?.addEventListener('click', closeAdminPanel);
document.getElementById('admin-save-btn')?.addEventListener('touchend', e => { e.preventDefault(); saveAdminConfig(); }, { passive: false });
document.getElementById('admin-save-btn')?.addEventListener('click', saveAdminConfig);

// Members panel
document.getElementById('members-btn')?.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); openMembersPanel(); }, { passive: false });
document.getElementById('members-btn')?.addEventListener('click', e => { e.stopPropagation(); openMembersPanel(); });
document.getElementById('admin-page-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('user-dropdown')?.classList.remove('visible');
  document.getElementById('user-pill')?.classList.remove('open');
  openEmbeddedAdminPortal();
});

function openEmbeddedAdminPortal() {
  // iOS Safari has inconsistent tap/focus behavior inside iframe overlays.
  // Route those sessions to the standalone admin page instead of embedded mode.
  const ua = navigator.userAgent || '';
  const isiOS = /iP(ad|hone|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  const shouldUseStandaloneAdmin = isiOS && isSafari;
  if (shouldUseStandaloneAdmin) {
    window.location.href = 'admin.html';
    return;
  }

  const overlay = document.getElementById('embedded-admin-overlay');
  const frame = document.getElementById('embedded-admin-iframe');
  if (!overlay || !frame) {
    window.location.href = 'admin.html';
    return;
  }
  if (!frame.getAttribute('src')) frame.setAttribute('src', 'admin.html');
  overlay.classList.add('visible');
  document.body.classList.add('admin-portal-open');
}

function closeEmbeddedAdminPortal() {
  const overlay = document.getElementById('embedded-admin-overlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  document.body.classList.remove('admin-portal-open');
}

window.closeEmbeddedAdminPortal = closeEmbeddedAdminPortal;
document.getElementById('embedded-admin-overlay')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeEmbeddedAdminPortal();
});
document.getElementById('issue-reminder-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeIssueReminderModal();
});

setInterval(() => {
  if (document.hidden) return;
  maybeNotifyIssueReminders(issues);
}, 1000);

setInterval(() => {
  if (document.hidden) return;
  if (issues.length > 0) renderIssues();
}, 60000);

setInterval(() => {
  if (document.hidden) return;
  refreshReminderClocksInDom();
}, 1000);
