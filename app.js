import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, collection, updateDoc as rawUpdateDoc, deleteDoc as rawDeleteDoc, doc, getDoc as rawGetDoc, getDocs as rawGetDocs, setDoc as rawSetDoc, addDoc as rawAddDoc, onSnapshot as rawOnSnapshot, serverTimestamp, query, orderBy, where, writeBatch as rawWriteBatch, arrayUnion, arrayRemove, increment, limit, runTransaction as rawRunTransaction, startAfter } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, setPersistence, browserLocalPersistence, GoogleAuthProvider, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut as fbSignOut, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage, ref as storageRef, uploadString, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyABjasNBbJnsqq4M_UxKruKrN6-O2FXCwc",
  authDomain: window.location.hostname || "press-tracker-9d9c9.firebaseapp.com",
  projectId: "press-tracker-9d9c9",
  storageBucket: "press-tracker-9d9c9.firebasestorage.app",
  messagingSenderId: "943200266003",
  appId: "1:943200266003:web:4d24eab551a3fb145c1ce6"
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() })
});
const storage = getStorage(app);
const storageFallback = firebaseConfig.storageBucket && firebaseConfig.storageBucket.includes('.appspot.com')
  ? null
  : getStorage(app, `gs://${firebaseConfig.projectId}.appspot.com`);
const auth = getAuth(app);
void setPersistence(auth, browserLocalPersistence).catch(() => {});
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
const NO_AUTH_MODE = location.pathname.endsWith('/noauth.html');
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

const firestoreIoStats = { reads: 0, writes: 0 };
const APP_VERSION = window.__APP_VERSION__ || 'dev';
function refreshAppVersionIndicator() {
  const el = document.getElementById('app-version-indicator');
  if (!el) return;
  el.textContent = `rev: ${APP_VERSION}`;
  el.title = `Current commit version: ${APP_VERSION}`;
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
const setDoc = async (...args) => { const out = await rawSetDoc(...args); trackFirestoreWrite(1); return out; };
const addDoc = async (...args) => { const out = await rawAddDoc(...args); trackFirestoreWrite(1); return out; };
const updateDoc = async (...args) => { const out = await rawUpdateDoc(...args); trackFirestoreWrite(1); return out; };
const deleteDoc = async (...args) => { const out = await rawDeleteDoc(...args); trackFirestoreWrite(1); return out; };
const writeBatch = (...args) => {
  const batch = rawWriteBatch(...args);
  const originalCommit = batch.commit.bind(batch);
  batch.commit = async (...commitArgs) => {
    const out = await originalCommit(...commitArgs);
    trackFirestoreWrite(1);
    return out;
  };
  return batch;
};
const runTransaction = async (...args) => {
  const out = await rawRunTransaction(...args);
  trackFirestoreWrite(1);
  return out;
};
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
const scheduleLookupCache = new Map();
const USER_LOOKUP_HEARTBEAT_MS = 12 * 60 * 60 * 1000;
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
let _rolePrefsDraft = [];
let _roleFeedAlertsUnsubscribe = null;
const _seenRoleFeedAlerts = new Set();
let _unreadRoleAlertCount = 0;
let _activeRoleAlertCount = 0;
let _roleAlertsShowAccepted = false;
let _roleAlertsCache = [];
let _roleAlertBadgeRefreshTimer = null;
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

async function getRoleAlertRoutingRules() {
  if (!currentPlantId) return ROLE_ALERT_ROUTING_RULES_DEFAULT;
  const now = Date.now();
  if (_roleAlertRulesCache.plantId === currentPlantId
    && _roleAlertRulesCache.rules
    && (now - _roleAlertRulesCache.fetchedAt) < ROLE_ALERT_RULES_CACHE_MS) {
    return _roleAlertRulesCache.rules;
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

async function queueRoleFeedAlert(issue, { statusKey, subStatus, note = '' } = {}) {
  if (DEMO_MODE) return;
  if (!currentPlantId || !issue?.id || !statusKey) return;
  const normalizedStatus = String(statusKey || '').trim().toLowerCase();
  if (!normalizedStatus || normalizedStatus === 'open' || normalizedStatus === 'resolved') return;
  const route = await resolveRoleAlertRoute(statusKey, subStatus);
  const statusDef = getStatusDef(statusKey);
  const effectiveRoute = route || {
    feedKey: `${String(statusKey || '').trim().toLowerCase()}_alerts`,
    feedLabel: `${String(statusDef?.label || statusKey || 'General').trim()} Alerts`,
    jobRoleKeys: []
  };
  try {
    const membersSnap = await getDocs(collection(db, 'plants', currentPlantId, 'members'));
    const roleKeys = _expandRoleAliases(Array.isArray(effectiveRoute.jobRoleKeys) ? effectiveRoute.jobRoleKeys : []);
    const categoryKey = String(statusKey || '').trim().toLowerCase();
    const recipientUserIds = membersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(m => m?.isActive !== false)
      .filter(m => {
        const hasExplicitSubscriptions = Object.prototype.hasOwnProperty.call(m || {}, 'alertCategorySubscriptions');
        const categorySubs = Array.isArray(m.alertCategorySubscriptions)
          ? m.alertCategorySubscriptions.map(v => String(v || '').trim().toLowerCase()).filter(Boolean)
          : [];
        if (hasExplicitSubscriptions) {
          return categorySubs.includes(categoryKey);
        }
        const normalizedRoleKeys = [
          ...(Array.isArray(m.jobRoleKeys) ? m.jobRoleKeys : []),
          ...(Array.isArray(m.jobFeeds) ? m.jobFeeds : [])
        ].map(key => String(key || '').trim().toLowerCase()).filter(Boolean);
        const memberKeys = _expandRoleAliases(normalizedRoleKeys);
        return memberKeys.some(key => roleKeys.includes(key));
      })
      .map(m => m.id);
    await addDoc(collection(db, 'plants', currentPlantId, 'roleFeedAlerts'), {
      issueId: issue.id,
      machine: issue.machine || issue.machineCode || '',
      statusKey,
      subStatus: subStatus || '',
      note: note || '',
      feedKey: effectiveRoute.feedKey,
      feedLabel: effectiveRoute.feedLabel,
      categoryKey,
      requiredJobRoleKeys: roleKeys,
      recipientUserIds,
      createdAt: serverTimestamp(),
      createdBy: currentActor()
    });
    if (currentUser?.uid && recipientUserIds.includes(currentUser.uid)) {
      showGameToast(`🔔 ${effectiveRoute.feedLabel}: Press ${issue.machine || 'Unknown'}`);
    }
  } catch (e) {
    console.warn('Role feed alert enqueue failed', e);
  }
}

function stopRoleFeedAlertsWatcher() {
  if (_roleFeedAlertsUnsubscribe) {
    _roleFeedAlertsUnsubscribe();
    _roleFeedAlertsUnsubscribe = null;
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

function _getRoleAlertWorkflowState(issue, statusKey) {
  if (!issue) return null;
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
        <button class="role-alert-action-btn role-alert-action-accept" type="button" data-role-alert-action="accept" data-role-alert-issue-id="${esc(alert.issueId)}" data-role-alert-status-key="${esc(alert.statusKey)}" ${isResolved ? 'disabled' : ''}>${isResolved ? 'Resolved' : (isAccepted ? 'Accepted' : 'Accept')}</button>
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
    const workflowState = isResolved
      ? 'resolved'
      : (_getRoleAlertWorkflowState(issue || null, alertStatusKey) || data.workflowState || null);
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
    const aMs = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const bMs = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
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

function _handleRoleAlertModalAction(action, issueId, statusKey, alertId, categoryKey) {
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
    void acceptRoleAlert(issueId, statusKey);
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
      target.dataset.roleAlertCategoryKey || ''
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

window.acceptRoleAlert = async function(issueId, statusKey) {
  if (!issueId || !statusKey) return;
  try {
    await setWorkflowStateForStatus(issueId, statusKey, 'accepted');
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

window.unacceptRoleAlert = async function(issueId, statusKey) {
  if (!issueId || !statusKey) return;
  try {
    await setWorkflowStateForStatus(issueId, statusKey, 'called');
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
    const [categoryOptions, memberSnap] = await Promise.all([
      Promise.resolve(getAvailableCategoryOptionsForPreferences()),
      getDoc(plantMemberDocRef(currentPlantId, currentUser.uid))
    ]);
    const member = memberSnap.exists() ? (memberSnap.data() || {}) : {};
    _rolePrefsDraft = Array.isArray(member.alertCategorySubscriptions)
      ? member.alertCategorySubscriptions.map(v => String(v || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const finalOptions = categoryOptions.length ? categoryOptions : [{ key:'maintenance', label:'Maintenance' }];
    list.innerHTML = finalOptions.map(opt => `
      <label style="display:flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:8px 10px;">
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
    await updateDoc(plantMemberDocRef(currentPlantId, currentUser.uid), {
      alertCategorySubscriptions: selected,
      updatedAt: serverTimestamp(),
      updatedBy: currentActor()
    });
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
function plantCol(colName) { return collection(db, 'plants', currentPlantId, colName); }
function plantDoc(colName, docId) { return doc(db, 'plants', currentPlantId, colName, docId); }
function issueEventsCol(issueId) { return collection(db, 'plants', currentPlantId, 'issues', issueId, 'events'); }
function issueAttachmentsCol(issueId) { return collection(db, 'plants', currentPlantId, 'issues', issueId, 'attachments'); }
function pressWikiPagesCol(pressId) { return collection(db, 'plants', currentPlantId, 'presses', String(pressId), 'wikiPages'); }
function pressWikiPageDoc(pressId, pageId) { return doc(db, 'plants', currentPlantId, 'presses', String(pressId), 'wikiPages', pageId); }
function pressWikiRevisionsCol(pressId, pageId) { return collection(db, 'plants', currentPlantId, 'presses', String(pressId), 'wikiPages', pageId, 'revisions'); }
function pressWikiAttachmentsCol(pressId, pageId) { return collection(db, 'plants', currentPlantId, 'presses', String(pressId), 'wikiPages', pageId, 'attachments'); }
function wikiCollectionPath(scope, pressId) {
  return scope === WIKI_SCOPE_SHARED
    ? ['plants', currentPlantId, 'wikiPages']
    : ['plants', currentPlantId, 'presses', String(pressId), 'wikiPages'];
}
function wikiPagesColForScope(scope, pressId) { return collection(db, ...wikiCollectionPath(scope, pressId)); }
function wikiPageDocForScope(scope, pressId, pageId) { return doc(db, ...wikiCollectionPath(scope, pressId), pageId); }
function wikiRevisionsColForScope(scope, pressId, pageId) { return collection(db, ...wikiCollectionPath(scope, pressId), pageId, 'revisions'); }
function wikiAttachmentsColForScope(scope, pressId, pageId) { return collection(db, ...wikiCollectionPath(scope, pressId), pageId, 'attachments'); }
function wikiStoragePrefixForScope(scope, pressId, pageId) {
  return scope === WIKI_SCOPE_SHARED
    ? `plants/${currentPlantId}/wikiPages/${pageId}`
    : `plants/${currentPlantId}/presses/${String(pressId)}/wikiPages/${pageId}`;
}
function notesCol() { return collection(db, 'plants', currentPlantId, 'notes'); }
function noteDoc(noteId) { return doc(db, 'plants', currentPlantId, 'notes', noteId); }
function noteAttachmentsCol(noteId) { return collection(db, 'plants', currentPlantId, 'notes', noteId, 'attachments'); }
function noteStoragePrefix(noteId) { return `plants/${currentPlantId}/notes/${noteId}`; }
function plantMemberDocRef(plantId, userId) { return doc(db, 'plants', plantId, 'members', userId); }
function gameConfigDoc() { return doc(db, 'plants', currentPlantId, 'gamificationConfig', 'main'); }
function gameUserStatsDoc(userId) { return doc(db, 'plants', currentPlantId, 'userGameStats', userId); }
function gameMissionsCol() { return collection(db, 'plants', currentPlantId, 'missions'); }
function gameLeaderboardDoc(boardId) { return doc(db, 'plants', currentPlantId, 'leaderboards', boardId || gameConfig?.leaderboardPeriod || 'weekly'); }
function userBadgesDoc(userId) { return doc(db, 'plants', currentPlantId, 'userBadges', userId); }
function gameEventsCol() { return collection(db, 'plants', currentPlantId, 'gameEvents'); }
function missionProgressDoc(missionId, subjectId) { return doc(db, 'plants', currentPlantId, 'missions', missionId, 'progress', subjectId); }
function globalStoreConfigDoc() { return doc(db, 'globalConfig', 'store'); }
function legacyPlantStoreConfigDoc() { return doc(db, 'plants', currentPlantId, 'config', 'store'); }
function conversationsCol() { return collection(db, 'plants', currentPlantId, 'conversations'); }
function conversationDoc(conversationId) { return doc(db, 'plants', currentPlantId, 'conversations', conversationId); }
function conversationMessagesCol(conversationId) { return collection(db, 'plants', currentPlantId, 'conversations', conversationId, 'messages'); }
function conversationMemberDoc(conversationId, userId) { return doc(db, 'plants', currentPlantId, 'conversations', conversationId, 'members', userId); }

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

function buildScheduleIndexFromSnaps(snapsBySection) {
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

  Object.entries(snapsBySection).forEach(([section, snap]) => {
    snap.docs.forEach(d => {
      const data = d.data() || {};
      const machine = normalizeSchedulePress(data.press);
      pushRow(machine, { id: d.id, ...data, section });
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
  const snapsBySection = Object.fromEntries(sections.map((s, idx) => [s, sectionSnaps[idx]]));
  const { scheduled, lookupByPress } = buildScheduleIndexFromSnaps(snapsBySection);
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
    changes.style.color = 'var(--accent)';
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

function extFromContentType(contentType) {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'bin';
}

function parseDataUrlMeta(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const contentType = m[1] || 'application/octet-stream';
  const base64Body = m[2] || '';
  const sizeBytes = Math.max(0, Math.floor((base64Body.length * 3) / 4));
  return { contentType, sizeBytes };
}

const NOTE_ALLOWED_TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'A', 'DIV', 'SPAN', 'CODE', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3']);

function _noteTextFromHtml(html = '') {
  const wrap = document.createElement('div');
  wrap.innerHTML = sanitizeNoteHtml(html);
  return String(wrap.textContent || '').replace(/\s+\n/g, '\n').trim();
}

function sanitizeNoteHtml(html = '') {
  const source = String(html || '');
  if (!source) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${source}</div>`, 'text/html');
  const root = doc.body.firstElementChild || doc.body;
  const out = document.createElement('div');

  const appendSanitized = (parentOut, node) => {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      parentOut.appendChild(document.createTextNode(node.textContent || ''));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = String(node.tagName || '').toUpperCase();
    if (!NOTE_ALLOWED_TAGS.has(tag)) {
      node.childNodes.forEach(child => appendSanitized(parentOut, child));
      return;
    }
    const el = document.createElement(tag.toLowerCase());
    if (tag === 'A') {
      const href = String(node.getAttribute('href') || '').trim();
      if (href && !/^javascript:/i.test(href)) {
        el.setAttribute('href', href);
        el.setAttribute('rel', 'noopener noreferrer');
        el.setAttribute('target', '_blank');
      }
    }
    node.childNodes.forEach(child => appendSanitized(el, child));
    parentOut.appendChild(el);
  };

  root.childNodes.forEach(child => appendSanitized(out, child));
  return out.innerHTML;
}

function normalizeChecklistItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map(item => ({
      id: String(item?.id || `chk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      text: String(item?.text || ''),
      done: Boolean(item?.done)
    }))
    .filter(item => item.id || item.text);
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadIssuePhotosToStorage(issueId, photos) {
  const out = [];
  for (let idx = 0; idx < (photos || []).length; idx++) {
    const p = photos[idx] || {};
    const src = String(p.dataUrl || '');
    if (!src.startsWith('data:')) { out.push(p); continue; }
    const meta = parseDataUrlMeta(src);
    if (!meta) { out.push(p); continue; }
    const ext = extFromContentType(meta.contentType);
    const fileName = `${Date.now()}_${idx}.${ext}`;
    const path = `plants/${currentPlantId}/issues/${issueId}/photos/${fileName}`;
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
      const attStorage = a.storageBucket ? getStorage(app, `gs://${a.storageBucket}`) : storage;
      const url = a.downloadURL || await getDownloadURL(storageRef(attStorage, a.storagePath));
      photos.push({
        name: a.fileName || d.id,
        dataUrl: url,
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
    if (ev.type !== 'status_changed') return;
    const toStatus = ev.payload?.toStatusKey || 'open';
    const toSub = ev.payload?.toSubStatusKey || '';
    const note = ev.payload?.note || '';
    let dateTime = '';
    try {
      if (ev.eventAt?.toDate) dateTime = fmtDate(ev.eventAt.toDate());
    } catch (_) {}
    out.push({
      status: toStatus,
      subStatus: toSub,
      note,
      dateTime: dateTime || issue.dateTime || '',
      by: ev.actor?.name || issue.userName || ''
    });
  });
  return out;
}

async function fetchIssueEventHistory(issue) {
  if (issueEventHistoryCache.has(issue.id)) return issueEventHistoryCache.get(issue.id);
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
    const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
    const userData = userSnap.exists() ? userSnap.data() : {};
    _applyFirestoreThemePrefs(userData.themePrefs);
    userLifetimeXp = Number(userData.globalLifetimeXp || 0);
    userXpSpent = Number(userData.globalXpSpent || 0);
    const rawInv = userData.inventory || {};
    userInventory = {
      unlockedItems: Array.isArray(rawInv.unlockedItems) ? rawInv.unlockedItems : [],
      activeMascot: rawInv.activeMascot || null,
    };

    if (Array.isArray(userData.plantIds) && userData.plantIds.length > 0) {
      // ── New structure: fetch each plant doc for name/location ──
      const plantDocs = await Promise.all(
        userData.plantIds.map(id => getDoc(doc(db, 'plants', id)))
      );
      userPlants = plantDocs
        .filter(s => s.exists())
        .map(s => ({ id: s.id, name: s.data().name || s.id, location: s.data().location || '' }));
      const lastPlantValid = userData.lastPlant && userPlants.some(p => p.id === userData.lastPlant);
      currentPlantId = lastPlantValid ? userData.lastPlant : (userPlants[0]?.id || null);

    } else if (Array.isArray(userData.plants) && userData.plants.length > 0) {
      // ── Old structure: migrate plant metadata into plant docs + member docs ──
      userPlants = userData.plants;
      const lastPlantValid = userData.lastPlant && userPlants.some(p => p.id === userData.lastPlant);
      currentPlantId = lastPlantValid ? userData.lastPlant : userPlants[0].id;
      await _migratePlantsToNewStructure(userPlants);

    } else {
      // ── No plants yet: create default ──
      currentPlantId = 'default';
      userPlants = [{ id: 'default', name: 'Main Plant', location: '' }];
      await _initNewPlant('default', 'Main Plant', '');
      await setDoc(doc(db, 'users', currentUser.uid), { plantIds: ['default'], lastPlant: 'default' }, { merge: true });
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

async function _syncCurrentUserMembershipProfile(plantIds = []) {
  if (!currentUser?.uid || !Array.isArray(plantIds) || !plantIds.length) return;
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
  const isAdmin = currentUserRole === 'admin';

  const adminPageBtn = document.getElementById('admin-page-btn');
  if (adminPageBtn) adminPageBtn.style.display = isAdmin ? '' : 'none';

  const exportBtn = document.getElementById('export-pdf-btn');
  if (exportBtn) exportBtn.style.display = currentUserPermissions.canExport ? '' : 'none';
  const excelBtn = document.getElementById('export-excel-btn');
  if (excelBtn) excelBtn.style.display = currentUserPermissions.canExport ? '' : 'none';
}

// Load press layout for current plant
async function loadPlantPresses() {
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
  try { await setDoc(doc(db, 'users', currentUser.uid), { lastPlant: currentPlantId }, { merge: true }); } catch(e) {}
  try { localStorage.setItem('apTrackerLastPlant', currentPlantId); } catch(e) {}
  buildPlantDropdown();
  closePlantDropdown();
  issues = [];
  attachmentPhotoCache.clear();
  issueEventHistoryCache.clear();
  attachmentsHydrationToken++;
  eventsHydrationToken++;
  scheduledPressesState = null; // clear so new plant reloads schedule
  issueShiftFilter = 'all';
  ['all','first','second','third'].forEach(x => document.getElementById('shift-pill-'+x)?.classList.toggle('active', x==='all'));
  setSyncStatus('', 'Switching plant…');
  await hydrateCurrentPlantView();
  gameConfig = null;
  await ensureGamificationConfig();
  await backfillGlobalXpIfNeeded();
  startGamificationListeners();
  startListener();
  _startMessagingInboxWatcher();
  startRoleFeedAlertsWatcher();
  refreshVisibleData();
}

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

window.togglePlantDropdown = () => {
  const dd = document.getElementById('plant-dropdown');
  const btn = document.getElementById('plant-switcher-btn');
  const isOpen = dd.classList.contains('visible');
  dd.classList.toggle('visible', !isOpen);
  btn.classList.toggle('open', !isOpen);
};

function closePlantDropdown() {
  document.getElementById('plant-dropdown')?.classList.remove('visible');
  document.getElementById('plant-switcher-btn')?.classList.remove('open');
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('plant-switcher-wrap');
  if (wrap && !wrap.contains(e.target)) closePlantDropdown();
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
  open:            { label:'Open',             shortLabel:'Open',         icon:'●',  cssColor:'var(--red)',      swipeColor:'#ef4444', floorCls:'has-open',            cls:'status-open',            subs:['New Fault / Issue','Pending Triage','Scheduled Mold Change','Re-opened'],                                               statLabel:'Open',          order:0 },
  alert:           { label:'Alert',            shortLabel:'Alert',        icon:'🚨', cssColor:'#dc2626',         swipeColor:'#dc2626', floorCls:'has-alert',           cls:'status-alert',           subs:['Mold Protection Fault','E-Stop / Safety Hazard','Press Down - Critical','Major Oil / Fluid Leak'],                   statLabel:'Alert',         order:1 },
  controlman:      { label:'Controlman',       shortLabel:'Controlman',   icon:'🎛️', cssColor:'var(--babyblue)', swipeColor:'#38bdf8', floorCls:'has-controlman',      cls:'status-controlman',      subs:['Robot / EOAT (End of Arm Tooling) Fault','Vision System / Camera Error','Conveyor / Auxiliary Comm Loss','PLC / HMI Error'], statLabel:'Controlman',    order:2 },
  maintenance:     { label:'Maintenance',      shortLabel:'Maintenance',  icon:'🔧', cssColor:'var(--yellow)',   swipeColor:'#eab308', floorCls:'has-maintenance',     cls:'status-maintenance',     subs:['Hydraulic Leak / Pressure Drop','Heater Band / Thermocouple Failure','Barrel / Screw / Check Ring Issue','Chiller / Thermolator Failure'], statLabel:'Maintenance',   order:3 },
  materials:       { label:'Materials',        shortLabel:'Materials',    icon:'📦', cssColor:'#8b5cf6',         swipeColor:'#8b5cf6', floorCls:'has-materials',       cls:'status-materials',       subs:['Resin Moisture / Drying Issue','Colorant / Masterbatch Ratio Error','Vacuum / Material Loader Blockage','Wrong Resin / Regrind Issue'], statLabel:'Materials',     order:4 },
  processengineer: { label:'Process Engineer', shortLabel:'Process Eng.', icon:'⚙️', cssColor:'var(--purple)',   swipeColor:'#a855f7', floorCls:'has-processengineer', cls:'status-processengineer', subs:['Fill / Pack Pressure Adjustment','Temperature Profile Tuning','Cycle Time Optimization','Process Drift / Instability'], statLabel:'Process Eng.',  order:5 },
  quality:         { label:'Quality',          shortLabel:'Quality',      icon:'✨', cssColor:'#06b6d4',         swipeColor:'#06b6d4', floorCls:'has-quality',         cls:'status-quality',         subs:['Short Shot / Non-fill','Flash / Burrs','Sink Marks / Voids','Splay / Silver Streaks','Burn Marks / Degradation','Warp / Dimensional Out-of-Spec'], statLabel:'Quality',       order:6 },
  startup:         { label:'Startup',          shortLabel:'Startup',      icon:'🚀', cssColor:'var(--teal)',     swipeColor:'#14b8a6', floorCls:'has-startup',         cls:'status-startup',         subs:['Purging / Color Change','Mold Heat-Up / Stabilization','First Article Inspection (FAI)','Robot Homing / Path Setup'], statLabel:'Startup',       order:7 },
  tooldie:         { label:'Tool & Die',       shortLabel:'Tool & Die',   icon:'🔩', cssColor:'var(--orange)',   swipeColor:'#f97316', floorCls:'has-tooldie',         cls:'status-tooldie',         subs:['Broken / Bent Ejector Pin','Hot Runner / Gate Issue','Water Leak in Mold','Stuck Part / Sprue','Mold Greasing / PM'], statLabel:'Tool & Die',    order:8 },
  resolved:        { label:'Resolved',         shortLabel:'Resolved',     icon:'✓',  cssColor:'var(--green)',    swipeColor:'#22c55e', floorCls:'all-resolved',        cls:'status-resolved',        subs:['Process Parameter Adjusted','Mold Cleaned / Repaired','Hardware Replaced','Temporary Workaround'],                      statLabel:'Resolved',      order:9 },
};
const DEFAULT_STATUSES = JSON.parse(JSON.stringify(STATUSES));

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

const __alphaCanvasCtx = document.createElement('canvas').getContext('2d');

function alphaColor(color, alpha = 0.12) {
  const a = Math.max(0, Math.min(1, Number(alpha)));
  if (!__alphaCanvasCtx || !color) return `rgba(0,0,0,${a})`;

  __alphaCanvasCtx.fillStyle = '#000000';
  __alphaCanvasCtx.fillStyle = String(color);
  const normalized = __alphaCanvasCtx.fillStyle;
  const m = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!m) return `rgba(0,0,0,${a})`;

  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
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

      STATUSES = migratedStatuses;
      
      // Since we just changed the available statuses,
      // we must rebuild the logic that buttons depend on
      rebuildDerivedStatus();
      buildStatusFilterPills();
      renderIssues();

      if (addedDefaults) {
        console.log('🔄 Backfilled missing built-in statuses without overwriting custom categories...');
        await saveConfig();
        console.log('✅ Status config merged and saved!');
      }
    } else {
      // No config exists - save the default comprehensive categories
      console.log('💾 Saving initial comprehensive ticket categories...');
      await saveConfig();
      console.log('✅ Initial configuration saved!');
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
      STATUSES = normalizeLoadedStatuses(data2.statuses);
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
  await setDoc(plantDoc('config', 'statuses'), { statuses: STATUSES });
}

function rebuildDerivedStatus() {
  // Rebuild ALL_STATUSES and STATUS_ORDER after STATUSES changes
  window._ALL_STATUSES = getAlphabetizedStatusKeys({ includeOpen: false, includeResolved: false });
  window._STATUS_ORDER = Object.entries(STATUSES).sort((a,b)=>a[1].order-b[1].order).map(([k])=>k);
  buildStatusFilterPills();

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
            ? 'linear-gradient(90deg,var(--yellow),var(--green))'
            : 'linear-gradient(90deg,var(--purple),var(--blue))';
        const glowColor = completed ? '0 0 8px rgba(34,197,94,0.5)' : 'none';
        return `<div class="game-mission-item${completed ? ' game-mission-complete' : ''}">
          <div class="game-mission-head">
            <span>${completed ? '✓ ' : near ? '🔔 ' : ''}${esc(m.name || 'Mission')}</span>
            <strong style="color:${completed ? 'var(--green)' : near ? 'var(--yellow)' : 'var(--text)'}">${pct}%</strong>
          </div>
          <div class="game-progress"><span style="width:${pct}%;background:${progressColor};box-shadow:${glowColor}"></span></div>
          <div class="game-mission-meta">${current} / ${target} &nbsp;·&nbsp; <span style="color:var(--yellow)">${Number(m.rewards?.xp || 0)} XP</span> reward</div>
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
          ${earned ? '<span style="font-size:9px;color:var(--green);">✓</span>' : ''}
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
          <strong style="color:var(--yellow);flex-shrink:0">${Number(entry.xp || 0)} XP</strong>
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
  const color = isNegative ? 'var(--red)' : 'var(--yellow)';
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
      <div style="font-size:12px;color:var(--text2);margin-top:4px;">${esc(badge.description || '')}</div>
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
  gameMissionProgressCache.clear();
}

function startGamificationListeners() {
  stopGamificationListeners();
  if (!currentPlantId || !currentUser?.uid) return;

  // Reset so the first Firestore snapshot doesn't false-trigger a level-up celebration
  gamePrevLevel = 0;

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
  updateActiveThemeChoice(localStorage.getItem('pressTrackerTheme') || 'midnight');
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
    updateActiveThemeChoice(localStorage.getItem('pressTrackerTheme') || 'midnight');
  }, err => {
    console.warn('Global store listener failed:', err);
  });
}

function restoreSavedThemeSelection() {
  const savedTheme = localStorage.getItem('pressTrackerTheme') || '';
  if (!savedTheme || !savedTheme.startsWith('storetheme_')) return;
  if (!getThemeCatalogEntry(savedTheme)) return;
  applyTheme(savedTheme);
}

function normalizeStoreItems(rawItems) {
  const incoming = Array.isArray(rawItems) ? rawItems : [];
  const byId = new Map();
  const themeVarKeys = ['--bg','--bg2','--bg3','--border','--text','--text2','--text3','--accent','--accent2','--green','--red','--blue','--yellow','--orange'];
  const themeVarDefaults = {
    '--bg':'#0d1117','--bg2':'#161b22','--bg3':'#1c2333','--border':'#30363d',
    '--text':'#e6edf3','--text2':'#8b949e','--text3':'#484f58',
    '--accent':'#f97316','--accent2':'#fb923c',
    '--green':'#22c55e','--red':'#ef4444','--blue':'#3b82f6','--yellow':'#eab308','--orange':'#f97316'
  };
  const hexRe = /^#[0-9a-fA-F]{6}$/;
  const normalizeThemeVars = (vars = {}) => {
    const out = { ...themeVarDefaults };
    themeVarKeys.forEach(key => {
      const value = String(vars?.[key] || '').trim();
      if (hexRe.test(value)) out[key] = value;
    });
    return out;
  };
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
  const savedTheme = localStorage.getItem('pressTrackerTheme') || 'midnight';
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
    updateActiveThemeChoice(localStorage.getItem('pressTrackerTheme') || 'midnight');
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
    list.innerHTML = `<div class="game-mission-meta" style="padding:8px 0;text-align:center;color:var(--text3);">No items in the store yet.</div>`;
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

function inferThemeModeFromVars(vars = {}) {
  const bg = String(vars['--bg'] || '').trim();
  const hex = bg.startsWith('#') ? bg.slice(1) : '';
  if (![3, 6].includes(hex.length)) return 'dark';
  const normalized = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return 'dark';
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? 'light' : 'dark';
}

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
    const storeRef = globalStoreConfigDoc();
    const snap = await getDoc(storeRef);
    const incomingItems = Array.isArray(snap.data()?.items) ? snap.data().items : [];
    const builtInIds = new Set(BUILT_IN_THEME_STORE_ITEMS.map(item => item.id));
    const nonBuiltIns = incomingItems.filter(item => !builtInIds.has(String(item?.id || '').trim()));
    const mergedItems = [...nonBuiltIns, ...BUILT_IN_THEME_STORE_ITEMS];
    mergedItems.sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
    await setDoc(storeRef, {
      items: mergedItems,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.uid || null
    }, { merge: true });
    showGameToast('✅ Built-in themes synced to Firestore');
  } catch (e) {
    console.error('Theme sync failed:', e);
    showGameToast('Could not sync themes');
  } finally {
    if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = 'Sync Built-ins'; }
  }
}

function renderStoreModal() {
  updateStoreXpDisplay();
  const activeSelection = localStorage.getItem('pressTrackerTheme') || 'midnight';
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
        <div class="stc-ui-bar" style="background:${accent}22"></div>
        <div class="stc-ui-row">
          <div class="stc-ui-dot" style="background:${accent}"></div>
          <div class="stc-ui-line" style="background:${textColor}22"></div>
        </div>
        <div class="stc-ui-row">
          <div class="stc-ui-dot stc-ui-dot-sm" style="background:${textColor}44"></div>
          <div class="stc-ui-line stc-ui-line-sm" style="background:${textColor}18"></div>
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
    document.body.classList.remove(...THEME_KEYS.map(key => `theme-${key}`));
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
  clearCustomThemeVars();
  document.body.classList.remove(...THEME_KEYS.map(key => `theme-${key}`));
  if (themeKey !== 'midnight') document.body.classList.add(`theme-${themeKey}`);
  document.body.dataset.themeMode = builtIn.mode || 'dark';
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
  document.body.classList.remove(...THEME_KEYS.map(key => `theme-${key}`));
  applyCustomThemeVars(item.customVars || {});
  document.body.dataset.themeMode = inferThemeModeFromVars(item.customVars || {});
  try { localStorage.setItem('pressTrackerTheme', `${STORE_THEME_ITEM_PREFIX}${item.id}`); } catch(e) {}
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

const BUILT_IN_THEME_DEFS = [
  { key:'midnight',   name:'Midnight',   label:'🌙 Midnight',   mode:'dark',  colors:['#0d1117','#f97316','#e6edf3'], vars:{ '--bg':'#0d1117','--bg2':'#161b22','--bg3':'#1c2333','--border':'#30363d','--text':'#e6edf3','--text2':'#8b949e','--text3':'#484f58','--accent':'#f97316','--accent2':'#fb923c','--green':'#22c55e','--red':'#ef4444','--blue':'#3b82f6','--yellow':'#eab308','--orange':'#f97316' }, price:0, order:0 },
  { key:'arctic',     name:'Arctic',     label:'❄️ Arctic',     mode:'light', colors:['#f8fafc','#0ea5e9','#0f172a'], vars:{ '--bg':'#f8fafc','--bg2':'#ffffff','--bg3':'#f1f5f9','--border':'#cbd5e1','--text':'#0f172a','--text2':'#475569','--text3':'#94a3b8','--accent':'#0ea5e9','--accent2':'#38bdf8','--green':'#16a34a','--red':'#dc2626','--blue':'#0284c7','--yellow':'#ca8a04','--orange':'#f97316' }, price:0, order:1 },
  { key:'forest',     name:'Forest',     label:'🌲 Forest',     mode:'dark',  colors:['#0a120e','#10b981','#d1fae5'], vars:{ '--bg':'#0a120e','--bg2':'#0f1a14','--bg3':'#14241a','--border':'#1e3a28','--text':'#d1fae5','--text2':'#6ee7b7','--text3':'#34d399','--accent':'#10b981','--accent2':'#34d399','--green':'#34d399','--red':'#f87171','--blue':'#22d3ee','--yellow':'#facc15','--orange':'#fb923c' }, price:0, order:2 },
  { key:'sunset',     name:'Sunset',     label:'🌅 Sunset',     mode:'dark',  colors:['#1a0f0a','#fb923c','#fef3c7'], vars:{ '--bg':'#1a0f0a','--bg2':'#2d1810','--bg3':'#3d2218','--border':'#54321f','--text':'#fef3c7','--text2':'#fcd34d','--text3':'#f59e0b','--accent':'#fb923c','--accent2':'#fdba74','--green':'#34d399','--red':'#f87171','--blue':'#60a5fa','--yellow':'#facc15','--orange':'#fb923c' }, price:75, order:3 },
  { key:'ocean',      name:'Ocean',      label:'🌊 Ocean',      mode:'dark',  colors:['#0a1628','#38bdf8','#e0f2fe'], vars:{ '--bg':'#0a1628','--bg2':'#0f1e36','--bg3':'#152945','--border':'#1e3a5f','--text':'#e0f2fe','--text2':'#7dd3fc','--text3':'#0ea5e9','--accent':'#38bdf8','--accent2':'#7dd3fc','--green':'#22c55e','--red':'#f87171','--blue':'#38bdf8','--yellow':'#facc15','--orange':'#fb923c' }, price:75, order:4 },
  { key:'royal',      name:'Royal',      label:'👑 Royal',      mode:'dark',  colors:['#18102a','#c084fc','#f3e8ff'], vars:{ '--bg':'#18102a','--bg2':'#251638','--bg3':'#331f4d','--border':'#4a2d6b','--text':'#f3e8ff','--text2':'#d8b4fe','--text3':'#a78bfa','--accent':'#c084fc','--accent2':'#d8b4fe','--green':'#34d399','--red':'#f87171','--blue':'#60a5fa','--yellow':'#facc15','--orange':'#fb923c' }, price:120, order:5 },
  { key:'slate',      name:'Slate',      label:'⚡ Slate',      mode:'dark',  colors:['#0f1419','#64748b','#e2e8f0'], vars:{ '--bg':'#0f1419','--bg2':'#1a1f25','--bg3':'#242a31','--border':'#30363d','--text':'#e2e8f0','--text2':'#94a3b8','--text3':'#64748b','--accent':'#64748b','--accent2':'#94a3b8','--green':'#22c55e','--red':'#ef4444','--blue':'#60a5fa','--yellow':'#eab308','--orange':'#f97316' }, price:0, order:6 },
  { key:'mint',       name:'Mint',       label:'🍃 Mint',       mode:'light', colors:['#f0fdf9','#14b8a6','#064e3b'], vars:{ '--bg':'#f0fdf9','--bg2':'#ffffff','--bg3':'#e6fff8','--border':'#a7f3d0','--text':'#064e3b','--text2':'#065f46','--text3':'#10b981','--accent':'#14b8a6','--accent2':'#10b981','--green':'#059669','--red':'#dc2626','--blue':'#0284c7','--yellow':'#ca8a04','--orange':'#ea580c' }, price:0, order:7 },
  { key:'cyberpunk',  name:'Cyberpunk',  label:'🎮 Cyberpunk',  mode:'dark',  colors:['#0a0014','#ff00ff','#00ffff'], vars:{ '--bg':'#0a0014','--bg2':'#150028','--bg3':'#1f003d','--border':'#3d0066','--text':'#00ffff','--text2':'#ff00ff','--text3':'#9d00ff','--accent':'#ff00ff','--accent2':'#00ffff','--green':'#00ff88','--red':'#ff4d6d','--blue':'#00ffff','--yellow':'#ffee00','--orange':'#ff7a00' }, price:220, order:8 },
  { key:'industrial', name:'Industrial', label:'🏭 Industrial', mode:'dark',  colors:['#1a1a1a','#ff6b00','#e5e5e5'], vars:{ '--bg':'#1a1a1a','--bg2':'#252525','--bg3':'#2f2f2f','--border':'#404040','--text':'#e5e5e5','--text2':'#a0a0a0','--text3':'#707070','--accent':'#ff6b00','--accent2':'#ff8a33','--green':'#4ade80','--red':'#f87171','--blue':'#60a5fa','--yellow':'#facc15','--orange':'#ff6b00' }, price:220, order:9 },
  { key:'starship',   name:'Starship',   label:'🛸 Starship',   mode:'dark',  colors:['#030914','#26d9ff','#ddf6ff'], vars:{ '--bg':'#030914','--bg2':'#071327','--bg3':'#0d1d36','--border':'#16466b','--text':'#ddf6ff','--text2':'#8fc4dd','--text3':'#4a7fa6','--accent':'#26d9ff','--accent2':'#8bf5ff','--green':'#2cff9c','--red':'#ff5a87','--blue':'#26d9ff','--yellow':'#ffd447','--orange':'#ff9f43' }, price:180, order:10 },
  { key:'starforge',  name:'Starforge',  label:'🧱 Starforge',  mode:'dark',  colors:['#100d0a','#ff9f1c','#f2e6d9'], vars:{ '--bg':'#100d0a','--bg2':'#1a1714','--bg3':'#27211b','--border':'#5f4a35','--text':'#f2e6d9','--text2':'#c8b8a5','--text3':'#8c7762','--accent':'#ff9f1c','--accent2':'#ffd166','--green':'#49d987','--red':'#ff6b5e','--blue':'#9aa6b2','--yellow':'#ffd166','--orange':'#ff9f1c' }, price:200, order:11 },
  { key:'starmono',   name:'Star Mono',  label:'📟 Star Mono',  mode:'dark',  colors:['#0f1012','#c6ccd3','#eceff3'], vars:{ '--bg':'#0f1012','--bg2':'#17191c','--bg3':'#24282d','--border':'#424951','--text':'#eceff3','--text2':'#b5bcc5','--text3':'#747e89','--accent':'#c6ccd3','--accent2':'#e2e6ea','--green':'#a3a3a3','--red':'#9a9a9a','--blue':'#b8b8b8','--yellow':'#b0b0b0','--orange':'#c0c0c0' }, price:170, order:12 },
  { key:'engel',      name:'Engel',      label:'🟢 Engel',      mode:'dark',  colors:['#0c1209','#78be20','#e8f5d8'], vars:{ '--bg':'#0c1209','--bg2':'#141e0f','--bg3':'#1b2a14','--border':'#2d4820','--text':'#e8f5d8','--text2':'#8ab870','--text3':'#4d6e38','--accent':'#78be20','--accent2':'#96d63a','--green':'#78be20','--red':'#f87171','--blue':'#00a3b5','--yellow':'#ffc72c','--orange':'#fb923c' }, price:0, order:13 },
  { key:'cardinals',  name:'Cardinals',  label:'🔴 Cardinals',  mode:'dark',  colors:['#0e0303','#c8102e','#f5e8e8'], vars:{ '--bg':'#0e0303','--bg2':'#1c0808','--bg3':'#260c0c','--border':'#3d1515','--text':'#f5e8e8','--text2':'#c48a8a','--text3':'#7a4444','--accent':'#c8102e','--accent2':'#e81f42','--green':'#22c55e','--red':'#ff4444','--blue':'#60a5fa','--yellow':'#eab308','--orange':'#f97316' }, price:25, order:14 },
  { key:'wildcats',   name:'Wildcats',   label:'🔵 Wildcats',   mode:'dark',  colors:['#020814','#0033a0','#e8f0ff'], vars:{ '--bg':'#020814','--bg2':'#051228','--bg3':'#071a38','--border':'#0d2d5e','--text':'#e8f0ff','--text2':'#7da8e8','--text3':'#3d6ab0','--accent':'#0033a0','--accent2':'#1a52cc','--green':'#22c55e','--red':'#ef4444','--blue':'#3b82f6','--yellow':'#eab308','--orange':'#f97316' }, price:25, order:15 }
];
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

const MAX_DIM = 1200;
const JPEG_QUALITY = 0.82;
let redirectResultPromise = null;

// ── AUTH ──
function resetGoogleSignInButton() {
  if (NO_AUTH_MODE || DEMO_MODE) return;
  const btn = document.getElementById('google-signin-btn');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = googleBtnHTML;
}

async function finalizeRedirectSignIn() {
  if (NO_AUTH_MODE || DEMO_MODE) return;
  if (redirectResultPromise) return redirectResultPromise;
  const hadPendingRedirect = sessionStorage.getItem('ap:auth:redirectPending') === '1';
  if (!hadPendingRedirect) return;
  redirectResultPromise = (async () => {
    try {
      await getRedirectResult(auth);
    } catch (e) {
      console.error('Redirect sign in error:', e.code, e.message);
      resetGoogleSignInButton();
    } finally {
      sessionStorage.removeItem('ap:auth:redirectPending');
      redirectResultPromise = null;
    }
  })();
  return redirectResultPromise;
}

async function signInWithGoogle() {
  if (NO_AUTH_MODE || DEMO_MODE) return;
  const btn = document.getElementById('google-signin-btn');
  if (!btn) return;
  btn.disabled = true; btn.textContent = 'Signing in…';
  try { 
    sessionStorage.setItem('ap:auth:redirectPending', '1');
    await signInWithRedirect(auth, provider);
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

redirectResultPromise = finalizeRedirectSignIn();

async function doSignOut() {
  if (DEMO_MODE) { window.location.reload(); return; }
  if (NO_AUTH_MODE) {
    await bootstrapNoAuthSession();
    return;
  }
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  stopStatusConfigListener();
  stopGamificationListeners();
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
  document.getElementById('login-screen').classList.remove('visible');
  document.getElementById('app').classList.add('visible');
  applyUserIdentityToShell(user);

  // Write user lookup record so admins can find this user by email when adding to plants.
  // Fire-and-forget — failure is non-fatal.
  if (user.email && shouldSyncUserLookup(user.email)) {
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
  await hydrateCurrentPlantView();
  gameConfig = null;
  await ensureGamificationConfig();
  await backfillGlobalXpIfNeeded();
  startGamificationListeners();
  startListener();
  _startMessagingInboxWatcher();
  startRoleFeedAlertsWatcher();
  _bindMessagingKeyboardShortcut();
  setTodayDate();
  if (!localStorage.getItem(TUTORIAL_KEY)) setTimeout(() => window.openTutorial(), 900);
}

async function bootstrapDemoSession(user) {
  currentUser = user;
  document.getElementById('login-screen').classList.remove('visible');
  document.getElementById('app').classList.add('visible');
  document.getElementById('user-name-display').textContent = 'Demo Mode';
  const fullNameEl = document.getElementById('dropdown-full-name');
  const emailEl = document.getElementById('dropdown-email');
  if (fullNameEl) fullNameEl.textContent = 'AP Tracker Demo';
  if (emailEl) emailEl.textContent = 'Simulating 10 virtual team members…';

  await _bootstrapDemoPlant();
  currentPlantId = 'plant_demo';
  currentPlantName = 'Demo Plant';
  userPlants = [{ id: 'plant_demo', name: 'Demo Plant', location: '' }];
  buildPlantDropdown();
  document.getElementById('plant-name-display').textContent = currentPlantName;
  await Promise.all([loadPlantPresses(), loadCurrentMember(currentPlantId), loadStoreConfig()]);
  buildFloorMap();
  await loadConfig();
  startListener();
  setTodayDate();
  buildDemoControls();
  startDemoEngine();
}

onAuthStateChanged(auth, async user => {
  if (DEMO_MODE) {
    if (!user) {
      try { await signInAnonymously(auth); } catch (e) { console.error('Demo anon sign-in failed:', e); }
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
  if (!resolvedUser && sessionStorage.getItem('ap:auth:redirectPending') === '1') {
    await (redirectResultPromise || finalizeRedirectSignIn());
    resolvedUser = auth.currentUser;
  }
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
          <button onclick="window.location.reload()" style="font-size:13px;padding:8px 18px;border-radius:8px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-family:'Nunito',sans-serif;">Reload</button>
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

function startListener() {
  if (pageHidden) return;
  if (unsubscribe) unsubscribe();
  if (retryTimeout) { clearTimeout(retryTimeout); retryTimeout = null; }
  if (issueBootstrapTimeout) { clearTimeout(issueBootstrapTimeout); issueBootstrapTimeout = null; }
  if (!currentPlantId) return;
  issuesById.clear();
  issueHistoryCursor = null;
  issueHistoryFetchInFlight = null;

  const q = query(plantCol('issues'), orderBy('createdAt', 'desc'), limit(MAX_LIVE_ISSUES));
  let firstSnapshotReceived = false;
  unsubscribe = onSnapshot(q, snap => {
    firstSnapshotReceived = true;
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
    setSyncStatus('ok', 'Live — synced across all devices');
  }, err => {
    console.error('Snapshot error:', err);
    const isPermissionError = err?.code === 'permission-denied';
    if (isPermissionError) {
      setSyncStatus('err', 'Access denied. Reload the page if this persists.');
      return;
    }
    retryCount++;
    const delay = Math.min(2000 * retryCount, 15000); // 2s, 4s, 6s… up to 15s
    setSyncStatus('err', `Connection lost. Retrying in ${Math.round(delay/1000)}s…`);
    // Show retry button in issue list
    document.getElementById('issues-list').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📡</div>
        <div class="empty-state-text" style="margin-bottom:12px;">Connection lost. Retrying…</div>
        <button onclick="startListener()" style="font-size:13px;padding:8px 18px;border-radius:8px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-family:'Nunito',sans-serif;">Retry Now</button>
      </div>`;
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
      setSyncStatus('ok', 'Live connection delayed — loaded cached/latest data');
    } catch (e) {
      console.warn('Bootstrap issues fallback read failed:', e);
    }
  }, 6000);
}

// ── SYNC ──
function setSyncStatus(status, text) {
  const dot = document.getElementById('sync-dot');
  dot.className = 'sync-dot' + (status==='ok'?' ok':status==='err'?' err':'');
  document.getElementById('sync-text').textContent = text;
  document.getElementById('sync-banner').classList.add('visible');
  if (status==='ok') setTimeout(() => document.getElementById('sync-banner').classList.remove('visible'), 2500);
}

// ── SCOPE TOGGLE ──
window.setScope = s => {
  issueScope = s;
  ['all','mine'].forEach(x => document.getElementById('scope-'+x).classList.toggle('active', x===s));
  renderIssues(); updatePressStates(); updateStats();
};

// ── SHIFT FILTER ──
window.setShiftFilter = s => {
  issueShiftFilter = s;
  ['all','first','second','third'].forEach(x => document.getElementById('shift-pill-'+x)?.classList.toggle('active', x===s));
  renderIssues(); updateFilterBadge();
};

// ── PERIOD TOGGLE ──
window.setPeriod = s => {
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
    window.setPeriod?.('all');
  }
  if (mode === 'log') {
    if (prevMode === 'hist') {
      document.getElementById('machine-filter').value = '';
      const bc = document.getElementById('machine-breadcrumb');
      if (bc) bc.classList.remove('visible');
      window.setPeriod?.('today');
    }
    document.getElementById('machine-filter').value = '';
    renderIssues(); updateFilterBadge();
  }
  renderRowTabs();
};

// ── PRESS MINI-CARD STATE ──
let activeMiniCard = null; // { machine, rowName }

window.handlePressClick = p => {
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
    statusPill.style.cssText = 'color:var(--green);border-color:rgba(34,197,94,0.4);background:rgba(34,197,94,0.1);';
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
    statusPill.style.cssText = 'color:var(--accent);border-color:rgba(249,115,22,0.4);background:rgba(249,115,22,0.1);';
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
    addBtn.style.color = 'var(--accent)';
    addBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' + (openIssues.length > 0 ? 'Add' : 'Report');
    addBtn.onclick = () => { closeMiniCard(); openAddModal(p); };
    toolbar.appendChild(addBtn);
  }
  // Wiki button (middle)
  const pressId = toPressId(p);
  const wikiBtn = document.createElement('button');
  wikiBtn.className = 'mc-toolbar-btn';
  wikiBtn.style.color = 'var(--teal)';
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
  notesBtn.style.color = 'var(--yellow)';
  notesBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M3 2h10v10l-2 2H3V2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 5h6M5 8h4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>Notes';
  notesBtn.onclick = () => { closeMiniCard(); window.openNotesModalFromPress?.(p); };
  toolbar.appendChild(notesBtn);
  const timelineBtn = document.createElement('button');
  timelineBtn.className = 'mc-toolbar-btn';
  timelineBtn.style.color = 'var(--blue)';
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
  card.style.boxShadow = '0 0 0 2px var(--accent)';
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
  const urgent = document.getElementById('issue-urgent');
  const shift = document.getElementById('issue-shift');
  issueLogPrefs.timerMinutes = String(timer?.value || '');
  issueLogPrefs.urgent = Boolean(urgent?.checked);
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
  if (urgent) urgent.checked = Boolean(issueLogPrefs.urgent);
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
    btn.innerHTML = `<span class="log-cat-icon">${st.icon}</span><span class="log-cat-label">${getStatusLabel(key, 'short')}</span>`;
    addTapListener(btn, ()=>logCatSelectStatus(key));
    row.appendChild(btn);
  });
}

function renderLogSubChips() {
  const row = document.getElementById('log-sub-row'); if (!row) return;
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
  if (!logCatKey) { sel.classList.remove('visible'); return; }
  const st = getStatusDef(logCatKey);
  const col = getStatusColor(logCatKey);
  sel.classList.add('visible');
  pill.textContent = st.icon+' '+getStatusLabel(logCatKey, 'short')+(logCatSub?' › '+logCatSub:'');
  pill.style.color=col; pill.style.borderColor=alphaColor(col,0.53); pill.style.background=alphaColor(col,0.08);
}

function scrollAddModalToBottom() {
  const modal = document.querySelector('#add-modal .modal');
  if (!modal) return;
  requestAnimationFrame(() => modal.scrollTo({ top: modal.scrollHeight, behavior: 'smooth' }));
}

function logCatSelectStatus(key) {
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
  closeSubcategorySheet();
  logCatKey=null;logCatSub=null;
  issueLogPrefs.lastStatusKey = '';
  issueLogPrefs.lastStatusSub = '';
  saveIssueLogPrefs();
  renderLogCatButtons();renderLogSubChips();updateLogCatPill();
},{passive:false});
document.getElementById('log-cat-clear')?.addEventListener('click', ()=>{
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
  return Math.round(val);
}

function buildIssueTimer(minutes, baseDate = new Date(), existingTimer = null) {
  const m = parseTimerMinutes(minutes);
  if (!m) return null;
  const startedAtMs = Number(existingTimer?.startedAtMs || 0);
  const startMs = Number.isFinite(startedAtMs) && startedAtMs > 0
    ? startedAtMs
    : (baseDate instanceof Date ? baseDate.getTime() : Date.now());
  return {
    minutes: m,
    startedAtMs: startMs,
    dueAtMs: startMs + m * 60 * 1000
  };
}

const ISSUE_REMINDER_STORAGE_KEY = 'aptracker_issue_reminders_v1';
let issueReminderMap = {};
const _issueReminderNotified = new Set();
const _issueReminderEscalated = new Set();
const AUTO_CRITICAL_GRACE_MS = 30 * 1000;

function loadIssueReminders() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ISSUE_REMINDER_STORAGE_KEY) || '{}');
    issueReminderMap = (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    issueReminderMap = {};
  }
}

function saveIssueReminders() {
  try {
    localStorage.setItem(ISSUE_REMINDER_STORAGE_KEY, JSON.stringify(issueReminderMap));
  } catch (e) {}
}

function clearIssueReminder(issueId) {
  if (!issueId) return;
  delete issueReminderMap[issueId];
  saveIssueReminders();
}

function setIssueReminder(issueId, minutes) {
  const m = parseTimerMinutes(minutes);
  if (!issueId || !m) return false;
  const now = Date.now();
  issueReminderMap[issueId] = {
    minutes: m,
    setAt: now,
    dueAt: now + m * 60 * 1000
  };
  saveIssueReminders();
  return true;
}

function getIssueReminderState(issueId, nowMs = Date.now()) {
  const reminder = issueReminderMap?.[issueId];
  if (!reminder?.dueAt) return null;
  const dueAt = Number(reminder.dueAt || 0);
  if (!Number.isFinite(dueAt) || dueAt <= 0) return null;
  const remainingMs = dueAt - nowMs;
  const absMin = Math.max(1, Math.ceil(Math.abs(remainingMs) / 60000));
  return {
    dueAt,
    minutes: Number(reminder.minutes || 0),
    isOverdue: remainingMs <= 0,
    remainingMs,
    label: remainingMs > 0 ? `⏱ Remind in ${absMin}m` : `⏰ Reminder due ${absMin}m`
  };
}

function formatReminderClock(state) {
  if (!state) return '00:00';
  const seconds = Math.max(0, Math.floor(Math.abs(Number(state.remainingMs || 0)) / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

let issueReminderModalIssueId = null;
let issueReminderWheelValue = { hours: 0, mins: 0, secs: 0 };

function _buildReminderWheel(elId, max, key) {
  const wheel = document.getElementById(elId);
  if (!wheel) return;
  wheel.innerHTML = '';
  for (let i = 0; i <= max; i++) {
    const item = document.createElement('div');
    item.className = 'timer-wheel-item';
    item.textContent = String(i);
    item.dataset.value = String(i);
    wheel.appendChild(item);
  }
  const updateValue = () => {
    const itemHeight = 42;
    const idx = Math.max(0, Math.min(max, Math.round(wheel.scrollTop / itemHeight)));
    issueReminderWheelValue[key] = idx;
    wheel.querySelectorAll('.timer-wheel-item').forEach((el, i) => el.classList.toggle('active', i === idx));
  };
  wheel.onscroll = updateValue;
  setTimeout(() => updateValue(), 0);
}

function _setReminderWheelValue(elId, val) {
  const wheel = document.getElementById(elId);
  if (!wheel) return;
  wheel.scrollTop = Math.max(0, Number(val || 0)) * 42;
}
window.openIssueReminderModal = function(issueId) {
  const issue = issues.find(i => i.id === issueId);
  if (!issue) return;
  issueReminderModalIssueId = issueId;
  const cur = getIssueReminderState(issueId);
  const mins = Math.max(0, Number(cur?.minutes || 0));
  _buildReminderWheel('issue-reminder-hours-wheel', 23, 'hours');
  _buildReminderWheel('issue-reminder-mins-wheel', 59, 'mins');
  _buildReminderWheel('issue-reminder-secs-wheel', 59, 'secs');
  _setReminderWheelValue('issue-reminder-hours-wheel', Math.floor(mins / 60));
  _setReminderWheelValue('issue-reminder-mins-wheel', mins % 60);
  _setReminderWheelValue('issue-reminder-secs-wheel', 0);
  issueReminderWheelValue.hours = Math.floor(mins / 60);
  issueReminderWheelValue.mins = mins % 60;
  issueReminderWheelValue.secs = 0;
  const sub = document.getElementById('issue-reminder-modal-subtitle');
  if (sub) sub.textContent = `Press ${issue.machine || 'Unknown'} • pick a timer`;
  document.getElementById('issue-reminder-modal')?.classList.add('visible');
};
window.closeIssueReminderModal = function() {
  document.getElementById('issue-reminder-modal')?.classList.remove('visible');
  issueReminderModalIssueId = null;
};
window.setIssueReminderFromModal = function(minutes) {
  if (!issueReminderModalIssueId) return;
  setIssueReminder(issueReminderModalIssueId, minutes);
  showGameToast(`⏱ Reminder set for ${minutes}m.`);
  closeIssueReminderModal();
  renderIssues();
};
window.setIssueReminderFromModalCustom = function() {
  const h = Number(issueReminderWheelValue.hours || 0);
  const m = Number(issueReminderWheelValue.mins || 0);
  const s = Number(issueReminderWheelValue.secs || 0);
  const total = Math.floor((h * 60) + m + (s / 60));
  if (total <= 0) { showGameToast('Pick a time greater than 0 minutes.'); return; }
  window.setIssueReminderFromModal(total);
};
window.clearIssueReminderFromModal = function() {
  if (!issueReminderModalIssueId) return;
  clearIssueReminder(issueReminderModalIssueId);
  showGameToast('Reminder cleared.');
  closeIssueReminderModal();
  renderIssues();
};

window.setIssueReminderFromCard = function(issueId) {
  const minutes = parseTimerMinutes(document.getElementById(`issue-reminder-minutes-${issueId}`)?.value);
  if (!minutes) { showGameToast('Select a reminder time first.'); return; }
  if (!setIssueReminder(issueId, minutes)) return;
  showGameToast(`⏱ Reminder set for ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  renderIssues();
};

window.setIssueReminderQuick = function(issueId, minutes) {
  const m = parseTimerMinutes(minutes);
  if (!m) return;
  const sel = document.getElementById(`issue-reminder-minutes-${issueId}`);
  if (sel) sel.value = String(m);
  setIssueReminder(issueId, m);
  showGameToast(`⏱ Reminder set for ${m} minute${m === 1 ? '' : 's'}.`);
  renderIssues();
};

window.clearIssueReminderFromCard = function(issueId) {
  clearIssueReminder(issueId);
  showGameToast('Reminder cleared.');
  renderIssues();
};

async function autoEscalateReminderToCritical(issue, state) {
  if (!issue?.id || !state?.dueAt) return;
  if (issue.highPriority === true && issue.priority === 'critical') return;
  const graceThreshold = Number(state.dueAt) + AUTO_CRITICAL_GRACE_MS;
  if (!Number.isFinite(graceThreshold) || Date.now() < graceThreshold) return;
  const dedupeKey = `${issue.id}:${state.dueAt}`;
  if (_issueReminderEscalated.has(dedupeKey)) return;
  _issueReminderEscalated.add(dedupeKey);
  try {
    await updateDoc(plantDoc('issues', issue.id), {
      highPriority: true,
      priority: 'critical',
      priorityChangedAt: serverTimestamp(),
      priorityChangedBy: currentActor()
    });
    await addDoc(issueEventsCol(issue.id), {
      eventType: 'issue_priority_changed',
      actor: currentActor(),
      note: 'Auto-escalated to critical after timer expiry.',
      metadata: {
        fromHighPriority: !!issue.highPriority,
        fromPriority: issue.priority || null,
        toHighPriority: true,
        toPriority: 'critical',
        escalationReason: 'timer_expired_unacknowledged',
        reminderDueAt: Number(state.dueAt)
      },
      eventAt: serverTimestamp()
    });
    showGameToast(`🚨 Auto-critical: Press ${issue.machine || 'Unknown'}`);
  } catch (e) {
    _issueReminderEscalated.delete(dedupeKey);
    console.warn('Issue reminder escalation failed', e);
  }
}

async function maybeNotifyIssueReminders(issueList = issues) {
  if (!Array.isArray(issueList) || issueList.length === 0) return;
  for (const issue of issueList) {
    const state = getIssueReminderState(issue.id);
    if (!state?.isOverdue) continue;
    const dedupeKey = `${issue.id}:${state.dueAt}`;
    if (!_issueReminderNotified.has(dedupeKey)) {
      _issueReminderNotified.add(dedupeKey);
      showGameToast(`⏰ Reminder: check Press ${issue.machine || 'Unknown'}`);
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate([200, 120, 200, 120, 300]);
        } catch (e) {
          console.warn('Issue reminder vibration failed', e);
        }
      }
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(`Reminder — Press ${issue.machine || 'Unknown'}`, {
            body: issue.note || 'Go back and check the issue.'
          });
        } catch (e) {
          console.warn('Issue reminder notification failed', e);
        }
      }
    }
    try {
      await autoEscalateReminderToCritical(issue, state);
    } catch (e) {
      console.warn('Issue reminder auto-critical check failed', e);
    }
  }
}

function refreshReminderClocksInDom() {
  document.querySelectorAll('[data-reminder-id]').forEach(el => {
    const issueId = el.getAttribute('data-reminder-id');
    if (!issueId) return;
    const s = getIssueReminderState(issueId);
    if (!s) return;
    el.textContent = formatReminderClock(s);
  });
}

loadIssueReminders();

document.getElementById('subcategory-sheet-overlay')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeSubcategorySheet();
});
document.getElementById('subcategory-sheet-close')?.addEventListener('click', () => closeSubcategorySheet());

document.getElementById('issue-urgent')?.addEventListener('change', () => {
  issueLogPrefs.urgent = Boolean(document.getElementById('issue-urgent')?.checked);
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
  document.getElementById('submit-btn').innerHTML=on?'<span class="spinner"></span> Saving…':'⚠ Log Issue';
}

// ── SUBMIT NEW ──
window.submitIssue = async () => {
  if (!currentUserPermissions.canCreateIssue) return;
  setSubmitting(true);
  try {
    const d = getIssueDateFromInputs('issue-date','issue-time-input');
    const initialStatus = logCatKey || 'open';
    const initialSubStatus = logCatSub || '';
    const note = document.getElementById('issue-note').value.trim() || 'No Description Provided';
    const shiftSel = document.getElementById('issue-shift').value;
    const shift = shiftSel === 'auto' ? getShiftForTime(d, getShiftSchedule(currentPlantId)) : shiftSel;
    const timerMinutes = parseTimerMinutes(document.getElementById('issue-timer-minutes')?.value);
    const isUrgent = Boolean(document.getElementById('issue-urgent')?.checked);
    const issueRef = doc(plantCol('issues'));
    const uploadedPhotos = await uploadIssuePhotosToStorage(issueRef.id, pendingPhotos);
    const issuePayload = {
      machine: currentMachine, note,
      dateTime: fmtDate(d), dateKey: localDateStr(d), timestamp: d.getTime(),
      shift,
      timer: buildIssueTimer(timerMinutes, d),
      userId: currentUser.uid, userName: currentUser.displayName||currentUser.email,
      photoCount: uploadedPhotos.length,
      createdAt: serverTimestamp(),
      createdBy: currentActor(),
      ...(isUrgent ? { highPriority: true, priority: 'critical' } : {}),
      ...buildIssueV2Compat({
        machineCode: currentMachine,
        statusKey: initialStatus,
        subStatus: initialSubStatus,
        statusDateTime: fmtDate(d),
        note
      })
    };
    const batch = writeBatch(db);
    batch.set(issueRef, issuePayload);
    queueAttachmentDocs(batch, issueRef.id, uploadedPhotos);
    queueIssueEvent(batch, issueRef.id, 'issue_created', {
      machineCode: currentMachine,
      note,
      initialStatusKey: initialStatus,
      initialSubStatusKey: initialSubStatus,
      urgent: isUrgent
    });
    queueIssueEvent(batch, issueRef.id, 'status_changed', {
      fromStatusKey: null,
      fromSubStatusKey: null,
      toStatusKey: initialStatus,
      toSubStatusKey: initialSubStatus,
      note: ''
    });
    await batch.commit();
    issueLogPrefs.lastStatusKey = initialStatus;
    issueLogPrefs.lastStatusSub = initialSubStatus;
    issueLogPrefs.timerMinutes = String(document.getElementById('issue-timer-minutes')?.value || '');
    issueLogPrefs.urgent = isUrgent;
    saveIssueLogPrefs();
    await queueRoleFeedAlert({ id: issueRef.id, machine: currentMachine }, {
      statusKey: initialStatus,
      subStatus: initialSubStatus,
      note
    });
    if (timerMinutes > 0) setIssueReminder(issueRef.id, timerMinutes);
    attachmentPhotoCache.set(issueRef.id, uploadedPhotos);
    await awardGamification('issue_created_complete', { issueId: issueRef.id, dedupeSuffix: 'issue-created', tags: ['issue:create', `status:${initialStatus}`] });
    if (uploadedPhotos.length > 0) await awardGamification('photo_attached', { issueId: issueRef.id, dedupeSuffix: 'photo', tags: ['photo:attached'] });
    const createdIssue = {
      ...issuePayload,
      id: issueRef.id,
      photos: uploadedPhotos,
      currentStatus: {
        statusKey: initialStatus,
        subStatusKey: initialSubStatus,
        subLabel: initialSubStatus,
        notePreview: note
      },
      lifecycle: { isResolved: initialStatus === 'resolved' }
    };
    closeModal();
    showGameToast(`✅ Logged Press ${currentMachine}`);
    if (requiresSerialNumber(initialStatus, initialSubStatus)) {
      setTimeout(() => {
        openSerialModal(issueRef.id, initialStatus, initialSubStatus, fmtDate(d));
        if (!issues.find(i => i.id === issueRef.id)) {
          document.getElementById('serial-modal-machine').textContent = currentMachine;
        }
      }, 50);
    }
  } catch(e) { setSyncStatus('err','Error saving: '+e.message); setSubmitting(false); }
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
  document.getElementById('edit-timer-minutes').value = String(parseTimerMinutes(issueReminderMap?.[id]?.minutes) || '');
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
    const d = getIssueDateFromInputs('edit-date','edit-time-input');
    const issue = issues.find(i=>i.id===editTargetId);
    const last = currentStatus(issue || {});
    const shiftSel = document.getElementById('edit-shift').value;
    const shift = shiftSel === 'auto' ? getShiftForTime(d, getShiftSchedule(currentPlantId)) : shiftSel;
    const timerMinutes = parseTimerMinutes(document.getElementById('edit-timer-minutes')?.value);
    const uploadedPhotos = await uploadIssuePhotosToStorage(editTargetId, editPhotos);
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
    if (uploadedPhotos.length > 0) await awardGamification('photo_attached', { issueId: editTargetId, dedupeSuffix: 'photo', tags: ['photo:attached'] });
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
    const resolvedHistEntry = {
      status: 'resolved', subStatus: '',
      note: note || 'Resolved (no details provided)',
      dateTime: resolvedAtText,
      by: currentUser.displayName || currentUser.email
    };
    const issuePatch = {
      statusHistory: [...getMutableStatusHistory(issue || {}), resolvedHistEntry],
      workflowState: 'finished',
      'workflowStateHistory.finished': { by: currentActor(), at: serverTimestamp() },
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
    await awardGamification('issue_resolved', { issueId: resolveTargetId, dedupeSuffix: resolvedAtText, tags: ['issue:resolved', 'status:resolved'] });
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
    const statusHistory = getMutableStatusHistory(issue);
    statusHistory.push({ status: reopenStatusKey, subStatus: reopenSubStatus, note: note || '', dateTime: reopenDateTime, by: currentUser.displayName || currentUser.email });
    const issuePatch = {
      reopenNote:note||'',reopenDateTime,
      reopenedBy:currentUser.displayName||currentUser.email,resolveHistory,
      statusHistory,
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
    const batch = writeBatch(db);
    batch.update(plantDoc('issues',reopenTargetId), issuePatch);
    queueIssueEvent(batch, reopenTargetId, 'issue_reopened', { reason: note || '' });
    await batch.commit();
    await awardGamification('issue_reopened', { issueId: reopenTargetId, dedupeSuffix: reopenDateTime, tags: ['issue:reopened', `status:${reopenStatusKey}`] });
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
  try {
    const snap = await getDoc(plantDoc('issues', issueId));
    if (!snap.exists()) return fallbackIssue || null;
    return { ...(fallbackIssue || {}), ...snap.data() };
  } catch (_) {
    return fallbackIssue || null;
  }
}

// Add a new status entry to history
window.addStatusEntry = async (id, status, subStatus, note, dateTime) => {
  if (!currentUserPermissions.canEditIssue) return;
  const issue = issues.find(i => i.id === id);
  if (!issue) return;
  const entry = {
    status,
    subStatus: subStatus || '',
    note: note || '',
    dateTime: dateTime || fmtDate(new Date()),
    by: currentUser.displayName || currentUser.email
  };
  let prev = currentStatus(issue);
  try {
    await runTransaction(db, async tx => {
      const ref = plantDoc('issues', id);
      const snap = await tx.get(ref);
      const base = snap.exists() ? { id, ...snap.data() } : issue;
      prev = currentStatus(base || issue);
      const history = getMutableStatusHistory(base || issue);
      history.push(entry);
      const prevWorkflowState = (base?.workflowState || null);
      const issuePatch = {
        statusHistory: history,
        ...(status === 'resolved'
          ? { workflowState: 'finished', 'workflowStateHistory.finished': { by: currentActor(), at: serverTimestamp() } }
          : { workflowState: null }),
        ...(status !== 'resolved' && prev?.status && prevWorkflowState
          ? { [`workflowStateByStatus.${prev.status}`]: prevWorkflowState }
          : {}),
        ...(status !== 'resolved' ? { [`workflowStateByStatus.${status}`]: null } : {}),
        ...buildIssueV2Compat({
          machineCode: base?.machine || base?.machineCode || issue.machine || '',
          statusKey: status,
          subStatus: subStatus || '',
          statusDateTime: entry.dateTime,
          note: note || '',
          baseIssue: base || issue
        })
      };
      tx.update(ref, issuePatch);
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
    await queueRoleFeedAlert(issue, {
      statusKey: status,
      subStatus: subStatus || '',
      note: note || ''
    });
    issueEventHistoryCache.delete(id);
    await awardGamification('status_changed_valid', { issueId: id, dedupeSuffix: entry.dateTime || String(Date.now()), tags: ['status:changed', `status:${status}`] });
    if (status === 'resolved') await awardGamification('issue_resolved', { issueId: id, dedupeSuffix: 'status-resolved', tags: ['issue:resolved', 'status:resolved'] });
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
  const nextEntry = {
    status: source.status,
    subStatus: source.subStatus || '',
    note: source.note || '',
    dateTime: fmtDate(new Date()),
    by: currentUser.displayName || currentUser.email
  };
  history.push(nextEntry);
  try {
    const patch = {
      statusHistory: history,
      [`workflowStateByStatus.${nextEntry.status}`]: 'called',
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
      <select id="edit-status-sub" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:9px 11px;color:var(--text);font-family:'Nunito',sans-serif;font-size:13px;margin-bottom:14px;">
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
    await awardGamification('status_changed_valid', { issueId: id, dedupeSuffix: 'set-sub', tags: ['status:changed', `status:${last.status || 'open'}`, `sub:${sub || ''}`] });
  }
  catch(e) { setSyncStatus('err','Error updating: '+e.message); }
};

// ── WORKFLOW STATE ──
window.setWorkflowState = async (id, state) => {
  const validStates = ['called', 'accepted', 'in-progress', 'finished'];
  if (!validStates.includes(state)) return;
  const actor = currentActor();
  const issue = issues.find(i => i.id === id);
  if (issue && (issue.workflowState || 'called') === state) return;
  try {
    await updateDoc(plantDoc('issues', id), {
      workflowState: state,
      [`workflowStateHistory.${state}`]: { by: actor, at: serverTimestamp() },
      updatedAt: serverTimestamp(),
      updatedBy: actor
    });
  } catch(e) {
    setSyncStatus('err', 'Error updating workflow: ' + e.message);
  }
};

window.setWorkflowStateForStatus = async (issueId, statusKey, state) => {
  const validStates = ['called', 'accepted', 'in-progress', 'finished'];
  if (!validStates.includes(state)) return;
  const actor = currentActor();
  const issue = issues.find(i => i.id === issueId);
  const primaryKey = issue ? currentStatusKey(issue) : null;
  const current = (statusKey === primaryKey)
    ? (issue?.workflowState || null)
    : (issue?.workflowStateByStatus?.[statusKey] || null);
  if (current === state) return;
  try {
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
  const states = ['called', 'accepted', 'in-progress', 'finished'];
  const issue = issues.find(i => i.id === issueId);
  if (!issue) return;
  const primaryKey = currentStatusKey(issue);
  const current = statusKey === primaryKey
    ? (issue.workflowState || null)
    : (issue.workflowStateByStatus?.[statusKey] || null);
  const currentIdx = states.indexOf(current);
  const next = currentIdx < 0 ? 'called' : states[(currentIdx + 1) % states.length];
  await setWorkflowStateForStatus(issueId, statusKey, next);
};

window.cycleWorkflowState = async (id) => {
  const issue = issues.find(i => i.id === id);
  if (!issue) return;
  const states = ['called', 'accepted', 'in-progress', 'finished'];
  const currentState = issue.workflowState || 'called';
  const currentIndex = states.indexOf(currentState);
  const nextIndex = (currentIndex + 1) % states.length;
  const nextState = states[nextIndex];
  
  try {
    await updateDoc(plantDoc('issues', id), { workflowState: nextState });
    await awardGamification('workflow_step_advance', { issueId: id, dedupeSuffix: `${currentState}->${nextState}`, tags: ['workflow:advance', `workflow:${nextState}`] });
  } catch(e) {
    setSyncStatus('err', 'Error updating workflow: ' + e.message);
  }
};

// Dismiss the prompt arrow then set the workflow state
window.handleWfStepClick = (evt, issueId, statusKey, state) => {
  evt.stopPropagation();
  const arrow = document.getElementById(`wf-arrow-${issueId}`);
  if (arrow) {
    arrow.classList.add('wf-arrow-dismissed');
    setTimeout(() => arrow.remove(), 380);
  }
  setWorkflowStateForStatus(issueId, statusKey, state);
};

// ── PRIORITY TOGGLE ──
window.togglePriority = async (id) => {
  const issue = issues.find(i => i.id === id);
  if (!issue) return;
  try {
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
  if (!currentUserPermissions.canEditIssue) return;
  if (!confirm('Delete this issue permanently?')) return;
  try {
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
    const row=document.createElement('div'); row.className='issue-row'; row.dataset.id = issue.id;
    if (isAlertFocus) row.classList.add('alert-focus-issue');
    const card=document.createElement('div');
    card.className='issue-card'+(issueIsResolvedV2(issue)?' resolved':'')+(issue.highPriority?' high-priority':'')+(isAlertFocus?' alert-focus-card':'');

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

    const lastEntry = displayHistory[displayHistory.length-1];
    const scfg = STATUS_CONFIG_SAFE[currentKey];
    const sc = { ...scfg, label: scfg.label + (currentSubKey ? ' › '+currentSubKey : '') };

    const editedNote = issue.editedAt ? `<div style="font-size:10px;color:var(--text3);margin-top:3px;font-family:'Share Tech Mono',monospace">edited ${issue.editedAt}${issue.editedBy?' by '+esc(issue.editedBy):''}</div>` : '';

    // Helper to parse a formatted date string back into input values
    function parseDTForInputs(dtStr) {
      if (!dtStr) { const n=new Date(); return toLocalDTInputs(n); }
      try { const d=new Date(dtStr); if(isNaN(d.getTime())) { const n=new Date(); return toLocalDTInputs(n); } return toLocalDTInputs(d); }
      catch(e) { const n=new Date(); return toLocalDTInputs(n); }
    }

    // Workflow state configuration
    const workflowState = issue.workflowState || null;
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
    const wfStateHistory = issue.workflowStateHistory || {};
    const wfByStatusHistory = issue.workflowStateByStatusHistory || {};
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
        : (entry.status === currentKey ? workflowState : (wfByStatus[entry.status] || null));
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
        : `<button class="tl-wf-badge" style="color:${wfColor}" onclick="event.stopPropagation(); cycleWorkflowStateForStatus('${issue.id}','${entry.status}')" title="Tap to cycle workflow state">${wfBadgeLabel}</button>`;
      const entrySerialMatch = String(entry.note || '').match(/S\/N:\s*([A-Za-z0-9]+)/i);
      const entrySerialNumber = entrySerialMatch ? entrySerialMatch[1].toUpperCase() : '';
      const entryMaterialBadge = String(entry.status || '').toLowerCase() === 'materials' && entrySerialNumber
        ? ` <span class="issue-serial-tag" title="Serial Number: ${esc(entrySerialNumber)}">🏷️ ${esc(entrySerialNumber)}</span>`
        : '';

      return `<div class="tl-entry" style="border-left-color:${barColor};${entryBg}">
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
            ${!isResolvedEntry && entryWorkflowState === 'finished' ? `<button class="tl-edit-btn" onclick="setWorkflowStateForStatus('${issue.id}','${entry.status}','called')">Un-finish</button>` : ''}
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
    const canEdit = currentUserPermissions.canEditIssue;
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
          <button class="tl-mini-btn" style="background:var(--bg3);border:1px solid var(--border);color:var(--text2);padding:4px 11px;" onclick="setPendingStatus('${issue.id}','status','')">+ Add status entry</button>
        </div>`;

    const reminderState = getIssueReminderState(issue.id);
    const resolveHtml = `<div class="status-timeline">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text2);margin-bottom:8px;">Status History</div>
      <div class="tl-list">
        ${timelineEntries}
      </div>
      ${addRowHtml}
    </div>
    <div class="action-row issue-footer-actions" style="margin-top:10px;">
      <button class="issue-reminder-btn${reminderState?.isOverdue ? ' overdue' : ''}" onclick="event.stopPropagation(); openIssueReminderModal('${issue.id}')" title="Set check-back timer">⏱ <span data-reminder-id="${issue.id}">${formatReminderClock(reminderState)}</span></button>
      ${canEdit ? `<div class="issue-footer-actions-right">
      <button class="btn btn-ghost" onclick="openNotesModalFromIssue('${issue.id}')">📝 Notes</button>
      <button class="btn btn-edit" onclick="openEditModal('${issue.id}')">✏️ Edit</button>
      <button class="btn btn-danger" onclick="deleteIssue('${issue.id}')">🗑 Delete</button>
      </div>` : ''}
    </div>`;

    const datePart = issue.dateTime ? issue.dateTime.replace(/,\s*\d{4}/, '') : '';
    const submitterHtml=issue.userName?`<span class="issue-submitter">${esc(issue.userName.split(' ')[0])}${isMyIssue?' (you)':''}</span>`:'';
    const alertFocusHtml = isAlertFocus ? `<span class="issue-alert-focus-badge">Outside current time frame</span>` : '';

    // Secondary status keys (needed by workflow rows below)
    const secKeys = getSecondaryStatuses(issue).filter(k => k !== 'resolved');

    // Build compact 4-step header buttons with state label below
    const wfActorName = workflowState ? formatWorkflowActorName(wfStateHistory?.[workflowState]?.by?.name || wfStateHistory?.[workflowState]?.by) : '';
    const wfHeaderHtml = `<div class="wf-steps-wrap" onclick="event.stopPropagation()">
      <div class="wf-steps-row">
        ${hasNoWorkflowState ? `<div class="wf-prompt-arrow" id="wf-arrow-${issue.id}"></div>` : ''}
        <div class="wf-steps">${wfOrder.map(state => {
          const cfg = workflowConfig[state];
          const cls = state === workflowState ? `active ${cfg.cssState}` : isCompleted(state) ? 'completed' : 'pending';
          return `<button class="wf-step-btn ${cls}" onclick="handleWfStepClick(event,'${issue.id}','${currentKey}','${state}')" title="${cfg.label}">${cfg.icon}</button>`;
        }).join('')}</div>
      </div>
      <div class="wf-state-label ${workflowState ? workflowConfig[workflowState].cssState : ''}">${workflowState ? workflowConfig[workflowState].label : ''}</div>
      <div class="wf-state-meta ${workflowState ? workflowConfig[workflowState].cssState : ""}">${formatWorkflowActor(wfStateHistory[workflowState]?.by)}</div>
    </div>`;

    // Per-status workflow rows for expanded card body — derived from status history
    // Shows each department called (unique status keys from history), excluding the
    // primary status (already in header) and any already marked 'finished'
    const histStatKeys = [...new Set(
      [...displayHistory].reverse().map(e => e.status).filter(k => k && k !== 'open' && k !== 'resolved' && k !== currentKey)
    )].filter(k => wfByStatus[k] !== 'finished');

    const wfHistoryRowsHtml = histStatKeys.map(sKey => {
          const sCfg = STATUS_CONFIG_SAFE[sKey];
          const sColor = getStatusColor(sKey);
          const sState = wfByStatus[sKey] || null;
          const sCurrentIdx = sState ? wfOrder.indexOf(sState) : -1;
          const lastEntry = [...displayHistory].reverse().find(e => e.status === sKey);
          const sSubLabel = lastEntry?.subStatus || '';
          const btnHtml = wfOrder.map(st => {
            const cfg = workflowConfig[st];
            const cls = st === sState ? `active ${cfg.cssState}` : (sState && wfOrder.indexOf(st) < sCurrentIdx) ? 'completed' : 'pending';
            return `<button class="wf-step-btn ${cls}" onclick="event.stopPropagation(); setWorkflowStateForStatus('${issue.id}','${sKey}','${st}')" title="${cfg.label}">${cfg.icon}</button>`;
          }).join('');
          const sStateLabel = sState ? workflowConfig[sState].label : 'Not Started';
          const sStateClass = sState ? workflowConfig[sState].cssState : '';
          return `<div class="wf-status-row">
            <div class="wf-status-row-info">
              <div class="issue-status" style="color:${sColor};border-color:${sColor};background:${alphaColor(sColor,0.12)}">
                <span class="issue-status-main">${sCfg.icon} ${esc(sCfg.label)}</span>
              </div>
              ${sSubLabel ? `<span class="issue-status-sub" style="color:${sColor};">${esc(sSubLabel)}</span>` : ''}
            </div>
            <div class="wf-steps-wrap" onclick="event.stopPropagation()">
              <div class="wf-steps">${btnHtml}</div>
              <div class="wf-state-label ${sStateClass}">${sStateLabel}</div>
              <div class="wf-state-meta ${sStateClass}">${sState ? formatWorkflowActor(wfStateHistory[sState]?.by) : ''}</div>
            </div>
          </div>`;
        }).join('');

    // Split status label from sub-status for two-line display
    const baseLabel = scfg.label;
    const subLabel = currentSubKey;

    // Secondary status dots (shown on the current row)
    const secDotsHtml = secKeys.length > 0
      ? `<div class="secondary-status-dots">${secKeys.map(k => {
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

    const currentWfRowHtml = `<div class="wf-status-row">
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

    const wfStatusRowsHtml = `<div class="wf-status-rows" onclick="event.stopPropagation()">
      ${currentWfRowHtml}
      ${wfHistoryRowsHtml}
    </div>`;

    const _shiftDef = issue.shift ? getShiftSchedule(currentPlantId).find(s => s.key === issue.shift) : null;
    const shiftBadgeHtml = _shiftDef
      ? `<span class="shift-badge" style="background:${_shiftDef.color}20;color:${_shiftDef.color};border-color:${_shiftDef.color}50">${_shiftDef.shortLabel}</span>`
      : '';
    const timerBadgeHtml = reminderState ? `<span class="shift-badge ${reminderState.isOverdue ? 'status-open' : ''}" data-reminder-id="${issue.id}">${formatReminderClock(reminderState)}</span>` : '';

    card.innerHTML=`
      <div class="issue-card-header" onclick="toggleCard('${issue.id}')">
        <div class="issue-card-top">
          <div class="issue-machine-tag">${esc(issue.machine)}</div>
          <div class="issue-meta">
            <div class="issue-note-preview">${esc(issue.note)}</div>
            <div class="issue-time">${datePart} ${submitterHtml}${shiftBadgeHtml}${timerBadgeHtml}${(issue.photos||[]).length?`<span class="photo-count-badge">📷 ${issue.photos.length}</span>`:''}${issue.editedAt?'<span style="color:var(--text3)">(edited)</span>':''}${alertFocusHtml}</div>
          </div>
          <button class="priority-btn${issue.highPriority?' active':''}" onclick="event.stopPropagation(); togglePriority('${issue.id}')" title="${issue.highPriority?'Remove high priority':'Mark as high priority'}">!</button>
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

    catPanel.appendChild(catInner);

    // Sub-status panel
    const subPanel = document.createElement('div');
    subPanel.className = 'swipe-sub-panel';
    subPanel.innerHTML = '<div class="swipe-sub-inner"></div>';

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
      c.classList.remove('swiped');
      const r = c.closest('.issue-row');
      const cp = r.querySelector('.swipe-category-panel');
      const sp = r.querySelector('.swipe-sub-panel');
      cp.classList.remove('visible', 'has-subs');
      sp.classList.remove('visible');
      cp.querySelector('.swipe-category-inner')?.classList.remove('has-selection');
      cp.querySelectorAll('.swipe-status-tile').forEach(t => t.classList.remove('selected'));
      if (openSwipeRow?.card === c) openSwipeRow = null;
      scheduleIssueLogRelayout();
    };

    // Tile clicks
    let lastTileTap = null; // { key, stamp } — tracks last tap for double-click/double-tap detection
    catInner.querySelectorAll('.swipe-status-tile').forEach(tile => {
      const handleTileClick = (e) => {
        const statusKey = tile.dataset.status;
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
          skipChip.innerHTML = `<span class="subcategory-item-label" style="color:var(--text3); font-style:italic;">Skip ›</span>`;
          skipChip.style.borderColor = 'var(--border)';
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
  if (openSwipeRow && !e.target.closest('.issue-row')) closeSwipe();
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
    target: null,
    mascotKey: 'open',
    headline: 'WELCOME TO AP TRACKER',
    body: "I'm KLAX. When a press goes down, I'm the first to sound off. Let me walk you through the floor.",
  },
  {
    target: '#floor-map',
    padding: 10,
    mascotKey: 'controlman',
    headline: 'YOUR FLOOR MAP',
    body: "Every row and press on your floor, live. Colors show what's happening right now at a glance.",
  },
  {
    target: '#row-tabs',
    padding: 8,
    mascotKey: 'maintenance',
    headline: 'REPORT AN ISSUE',
    body: "Tap a row tab to expand it, then tap any press button. Hit + Add to log an issue in about 20 seconds.",
  },
  {
    target: '.issues-section',
    padding: 8,
    mascotKey: 'alert',
    headline: 'ROUTE & TRACK',
    body: "Swipe right on a card to route it to the right team. Tap the workflow badge to move it through Called → Accepted → In Progress → Finished.",
    wf: true,
  },
  {
    target: '.controls',
    padding: 8,
    mascotKey: 'processengineer',
    headline: 'FILTER & EXPORT',
    body: "Filter by time period, machine, or status. Hit PDF to export a report for your end-of-shift.",
  },
  {
    target: '#user-pill-wrap',
    padding: 8,
    mascotKey: 'resolved',
    headline: 'ALL DONE',
    body: "Case closed. Tap here anytime to find the Tutorial button if you need a refresher.",
    isLast: true,
  },
];

let _sptStep = 0;

window.openTutorial = function(step = 0) {
  _sptStep = step;
  document.getElementById('spotlight-overlay')?.classList.add('visible');
  document.getElementById('spt-wrap')?.classList.add('visible');
  _renderSptStep();
};

window.closeTutorial = function() {
  localStorage.setItem(TUTORIAL_KEY, '1');
  document.getElementById('spotlight-overlay')?.classList.remove('visible');
  document.getElementById('spt-wrap')?.classList.remove('visible');
  const hl = document.getElementById('spotlight-hl');
  if (hl) { hl.style.transition = 'none'; hl.style.opacity = '0'; hl.classList.remove('active'); }
};

window.tutorialNext = function() {
  if (_sptStep >= SPOTLIGHT_STEPS.length - 1) { window.closeTutorial(); return; }
  _sptStep++;
  _renderSptStep();
};

window.tutorialBack = function() {
  if (_sptStep <= 0) return;
  _sptStep--;
  _renderSptStep();
};

function _renderSptStep() {
  const step = SPOTLIGHT_STEPS[_sptStep];
  if (!step) return;
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
  const target = step.target ? document.querySelector(step.target) : null;

  if (!target) {
    if (hl) { hl.style.transition = 'none'; hl.style.opacity = '0'; hl.classList.remove('active'); }
    if (wrap) { wrap.style.top = '50%'; wrap.style.left = '50%'; wrap.style.transform = 'translate(-50%, -50%)'; }
    if (cup)   cup.style.display   = 'none';
    if (cdown) cdown.style.display = 'none';
    return;
  }

  if (hl) hl.style.transition = '';
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

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

function localDateStr(d) {
  const pad=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}
function fmtDate(d) {
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' '+
    d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
}
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

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
document.getElementById('user-pill').addEventListener('click', toggleUserDropdown);

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

const TOOL_MODAL_ORDER = ['wiki', 'notes', 'messages', 'alerts'];
const _toolModalScrollState = {
  wiki: { shellTop: 0 },
  notes: { listTop: 0, editorTop: 0 },
  messages: { listTop: 0, threadTop: 0 },
  alerts: { listTop: 0 }
};

function _toolModalCurrentKey() {
  if (document.getElementById('role-alerts-modal')?.classList.contains('visible')) return 'alerts';
  if (document.getElementById('messaging-modal')?.classList.contains('visible')) return 'messages';
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
    case 'toggle-stat-filter':
      window.toggleStatFilter?.(value);
      break;
    case 'set-shift-filter':
      window.setShiftFilter?.(value);
      break;
    case 'set-map-mode':
      window.setMapMode?.(value);
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

function themeLabelSansIcon(label) {
  return String(label || '').replace(/^[^\s]+\s/, '');
}

function inferThemeModeFromBg(bgHex) {
  const hex = String(bgHex || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return 'dark';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.68 ? 'light' : 'dark';
}

function normalizeThemeColors(colors, vars = {}) {
  const fallback = [
    vars['--bg'] || '#111111',
    vars['--accent'] || '#888888',
    vars['--text'] || '#ffffff',
  ];
  return Array.isArray(colors) && colors.length >= 3 ? colors : fallback;
}

function getThemePreviewColors(theme) {
  const vars = theme && typeof theme === 'object' ? (theme.vars || {}) : {};
  return normalizeThemeColors(theme?.colors, vars);
}

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
      const vars = { ...item.customVars };
      return {
        key: `storetheme_${item.id}`,
        source: 'store-custom',
        label: `🎨 ${item.name || 'Custom Theme'}`,
        shortLabel: item.name || 'Custom Theme',
        colors: [
          vars['--bg'] || '#111111',
          vars['--accent'] || '#888888',
          vars['--text'] || '#ffffff',
        ],
        vars,
        mode: inferThemeModeFromBg(vars['--bg']),
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
      const vars = { ...(theme.vars || {}) };
      return {
        key: `custom_${theme.id}`,
        source: 'saved-custom',
        label: `🎨 ${theme.name || 'Custom Theme'}`,
        shortLabel: theme.name || 'Custom',
        colors: normalizeThemeColors(null, vars),
        vars,
        mode: inferThemeModeFromBg(vars['--bg']),
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

// ── THEME EDITOR ──
const CUSTOM_THEMES_KEY = 'apTracker_customThemes';

const THEME_EDITOR_CORE_VARS = [
  '--bg', '--bg2', '--bg3', '--border',
  '--text', '--text2', '--text3',
  '--accent', '--accent2',
  '--green', '--red', '--blue', '--yellow', '--orange',
  '--purple', '--teal', '--babyblue'
];

const CUSTOM_THEME_CLEAR_VARS = [
  '--bg','--bg2','--bg3','--border','--text','--text2','--text3',
  '--accent','--accent2','--accent-glow',
  '--green','--green-dim','--red','--red-dim','--blue','--blue-dim',
  '--yellow','--yellow-dim','--orange','--orange-dim',
  '--purple','--purple-dim','--teal','--teal-dim','--babyblue','--babyblue-dim',
  '--bg-svg','--bg-svg-image'
];
let _appliedCustomVarKeys = new Set();


function _themeSvgToDataUrl(svgMarkup) {
  const source = String(svgMarkup || '').trim();
  if (!source) return '';
  const normalized = source.replace(/\r\n?/g, '\n').replace(/\t/g, '  ');
  return `url("data:image/svg+xml,${encodeURIComponent(normalized)}")`;
}


function __apThemeSvgToDataUrl(svgMarkup) {
  const source = String(svgMarkup || '').trim();
  if (!source) return '';
  const normalized = source.replace(/\r\n?/g, '\n').replace(/\t/g, '  ');
  return `url("data:image/svg+xml,${encodeURIComponent(normalized)}")`;
}


function _hexToRgba(hex, alpha) {
  const h = hex.replace('#','');
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function clearCustomThemeVars() {
  const keys = new Set([...CUSTOM_THEME_CLEAR_VARS, ..._appliedCustomVarKeys]);
  keys.forEach(v => document.documentElement.style.removeProperty(v));
  _appliedCustomVarKeys = new Set();
}

function applyDerivedVars(vars) {
  const root = document.documentElement.style;
  if (vars['--accent']) root.setProperty('--accent-glow', _hexToRgba(vars['--accent'], 0.22));
  ['--green','--red','--blue','--yellow','--orange','--purple','--teal','--babyblue'].forEach(k => {
    if (vars[k]) root.setProperty(k + '-dim', _hexToRgba(vars[k], 0.12));
  });
  if (typeof vars['--bg-svg'] === 'string' && vars['--bg-svg'].trim()) {
    const svgSource = String(vars['--bg-svg']).trim();
    const svgNormalized = svgSource.replace(/\r\n?/g, '\n').replace(/\t/g, '  ');
    root.setProperty('--bg-svg-image', `url(\"data:image/svg+xml,${encodeURIComponent(svgNormalized)}\")`);
  }
}


function applyCustomThemeVars(vars) {
  clearCustomThemeVars();
  Object.entries(vars).forEach(([k, v]) => {
    if (!String(k || '').startsWith('--')) return;
    document.documentElement.style.setProperty(k, v);
    _appliedCustomVarKeys.add(k);
  });
  applyDerivedVars(vars);
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

function _loadCustomThemes() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_THEMES_KEY) || '{"customThemes":[],"activeCustomId":null}'); }
  catch(e) { return { customThemes: [], activeCustomId: null }; }
}

function _saveCustomThemesStorage(data) {
  try { localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(data)); } catch(e) {}
  _syncThemePrefsToFirestore();
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
    const activeTheme = localStorage.getItem('pressTrackerTheme') || 'midnight';
    const { customThemes } = _loadCustomThemes();
    const payload = { activeTheme, customThemes };
    const signature = _themePrefsPayloadSignature(uid, payload);
    if (signature === _lastThemePrefsSyncSig) return;
    if (_themePrefsSyncTimer) clearTimeout(_themePrefsSyncTimer);
    _themePrefsSyncTimer = setTimeout(() => {
      setDoc(doc(db, 'users', uid), {
        themePrefs: payload
      }, { merge: true })
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
      local.customThemes = prefs.customThemes;
      try { localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(local)); } catch(e) {}
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
    const safeName = theme.name.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    item.innerHTML = `
      <span class="te-saved-name">${safeName}</span>
      <span class="te-saved-swatches">
        <span class="te-saved-swatch" style="background:${theme.vars['--bg'] || '#000'}"></span>
        <span class="te-saved-swatch" style="background:${theme.vars['--accent'] || '#888'}"></span>
        <span class="te-saved-swatch" style="background:${theme.vars['--text'] || '#fff'}"></span>
      </span>
      <button class="te-saved-apply" data-id="${theme.id}">Apply</button>
      <button class="te-saved-delete" data-id="${theme.id}" title="Delete">🗑</button>`;
    list.appendChild(item);
  });
}

function updateActiveThemeChoice(theme) {
  const savedTheme = theme ?? localStorage.getItem('pressTrackerTheme');
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
      document.body.classList.remove(...THEME_KEYS.map(key => `theme-${key}`));
      applyCustomThemeVars(item.customVars);
      document.body.dataset.themeMode = inferThemeModeFromVars(item.customVars);
      try { localStorage.setItem('pressTrackerTheme', resolvedTheme); } catch(e) {}
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
      document.body.classList.remove(...THEME_KEYS.map(key => `theme-${key}`));
      applyCustomThemeVars(found.vars);
      document.body.dataset.themeMode = 'dark';
      try { localStorage.setItem('pressTrackerTheme', resolvedTheme); } catch(e) {}
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
      document.body.classList.remove(...THEME_KEYS.map(key => `theme-${key}`));
      applyCustomThemeVars(storeTheme.vars || {});
      document.body.dataset.themeMode = storeTheme.mode || 'dark';
      try { localStorage.setItem('pressTrackerTheme', resolvedTheme); } catch(e) {}
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
  document.body.classList.remove(...THEME_KEYS.map(key => `theme-${key}`));
  if (normalizedTheme !== 'midnight') document.body.classList.add(`theme-${normalizedTheme}`);
  const selectedTheme = THEME_OPTIONS.find(opt => opt.key === normalizedTheme) || THEME_OPTIONS[0];
  document.body.dataset.themeMode = selectedTheme.mode;
  updateActiveThemeChoice(normalizedTheme);
  try { localStorage.setItem('pressTrackerTheme', normalizedTheme); } catch(e) {}
  _syncThemePrefsToFirestore();
  updateThemeModeUI();
}
window.applyTheme = applyTheme;

// Load saved theme (handles both built-in keys and custom_<id>)
try {
  const saved = localStorage.getItem('pressTrackerTheme');
  if (saved && saved.startsWith('custom_')) {
    const data = _loadCustomThemes();
    const found = data.customThemes.find(t => 'custom_' + t.id === saved);
    if (found) { document.body.classList.remove(...THEME_KEYS.map(key => `theme-${key}`)); applyCustomThemeVars(found.vars); document.body.dataset.themeMode = 'dark'; updateActiveThemeChoice(null); }
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
updateActiveThemeChoice(localStorage.getItem('pressTrackerTheme') || 'midnight');


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
    if ((localStorage.getItem('pressTrackerTheme') || '') === 'custom_' + deleteBtn.dataset.id) applyTheme('midnight');
    renderAppearanceCustomThemes();
    renderThemeChoices();
    renderStoreModal();
    updateActiveThemeChoice(localStorage.getItem('pressTrackerTheme') || 'midnight');
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
  updateActiveThemeChoice(localStorage.getItem('pressTrackerTheme') || 'midnight');
  document.getElementById('appearance-modal').classList.add('visible');
};

window.closeAppearanceModal = function() {
  document.getElementById('appearance-modal').classList.remove('visible');
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

window.openThemeEditor = function() {
  const themeEditorModal = document.getElementById('theme-editor-modal');
  const appearanceModal = document.getElementById('appearance-modal');
  if (!themeEditorModal || !appearanceModal) return;
  document.getElementById('user-dropdown')?.classList.remove('visible');
  document.getElementById('user-pill')?.classList.remove('open');
  _tePrevThemeKey = localStorage.getItem('pressTrackerTheme') || 'midnight';
  _teEditingId = null;
  const saveBtn = document.getElementById('te-save-btn');
  if (saveBtn) saveBtn.textContent = '💾 Save';

  // Populate base select
  const sel = document.getElementById('te-base-select');
  if (sel) sel.innerHTML = THEME_OPTIONS.map(t => `<option value="${t.key}">${t.label}</option>`).join('');

  // Seed vars from current theme (custom or built-in)
  if (_tePrevThemeKey.startsWith('custom_')) {
    const data = _loadCustomThemes();
    const found = data.customThemes.find(t => 'custom_' + t.id === _tePrevThemeKey);
    _teCurrentVars = found ? { ...found.vars } : { ...THEME_VARS_MAP.midnight };
    if (sel) sel.value = 'midnight';
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
  document.body.classList.remove(...THEME_KEYS.map(key => `theme-${key}`));
  applyCustomThemeVars(_teCurrentVars);

  _renderTEVarsList();
  _renderTESavedList();
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
  // Revert to what was active before editor opened
  const saved = localStorage.getItem('pressTrackerTheme') || 'midnight';
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
  }
});

document.getElementById('te-theme-search')?.addEventListener('input', () => _renderTEVarsList());

function _renderTEVarsList() {
  const container = document.getElementById('te-vars-list');
  if (!container) return;
  const baseKey = document.getElementById('te-base-select')?.value || 'midnight';
  const baseVars = THEME_VARS_MAP[baseKey] || THEME_VARS_MAP.midnight || {};
  const search = String(document.getElementById('te-theme-search')?.value || '').trim().toLowerCase();
  const vars = _teGetAllVariables().filter(cssVar => !search || cssVar.toLowerCase().includes(search));
  const countEl = document.getElementById('te-var-count');
  if (countEl) countEl.textContent = `${vars.length} var${vars.length === 1 ? '' : 's'}`;

  container.innerHTML = '';
  if (!vars.length) {
    container.innerHTML = `<div class="te-empty-vars">No CSS variables match your search.</div>`;
    return;
  }

  vars.forEach(cssVar => {
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
      _teCurrentVars[cssVar] = e.target.value.trim();
      const nextHex = _teToHexIfColor(_teCurrentVars[cssVar]);
      colorInput.style.visibility = nextHex ? 'visible' : 'hidden';
      if (nextHex) colorInput.value = nextHex;
      applyCustomThemeVars(_teCurrentVars);
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
      _teCurrentVars[cssVar] = e.target.value;
      textInput.value = e.target.value;
      applyCustomThemeVars(_teCurrentVars);
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
        _teCurrentVars[cssVar] = baseVal;
        textInput.value = baseVal;
      } else {
        delete _teCurrentVars[cssVar];
        textInput.value = '';
      }
      const nextHex = _teToHexIfColor(textInput.value);
      colorInput.style.visibility = nextHex ? 'visible' : 'hidden';
      if (nextHex) colorInput.value = nextHex;
      applyCustomThemeVars(_teCurrentVars);
    });

    container.appendChild(row);
  });
}



document.getElementById('te-bg-svg-input')?.addEventListener('input', e => {
  _teCurrentVars = _teCurrentVars || {};
  _teCurrentVars['--bg-svg'] = e.target.value || '';
  applyCustomThemeVars(_teCurrentVars);
});

window.saveCustomTheme = function() {
  const nameEl = document.getElementById('te-theme-name');
  if (!nameEl) return;
  const name = nameEl.value.trim();
  if (!name) { nameEl.focus(); return; }
  const data = _loadCustomThemes();
  if (_teEditingId) {
    const idx = data.customThemes.findIndex(t => t.id === _teEditingId);
    if (idx >= 0) data.customThemes[idx] = { ...data.customThemes[idx], name, vars: { ..._teCurrentVars } };
    _saveCustomThemesStorage(data);
    applyTheme('custom_' + _teEditingId);
    _teEditingId = null;
    const saveBtn = document.getElementById('te-save-btn');
    if (saveBtn) saveBtn.textContent = '💾 Save';
  } else {
    const id = 'custom_' + Date.now();
    data.customThemes.push({ id, name, vars: { ..._teCurrentVars }, createdAt: Date.now() });
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
    const safeName = theme.name.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    item.innerHTML = `
      <span class="te-saved-name">${safeName}</span>
      <span class="te-saved-swatches">
        <span class="te-saved-swatch" style="background:${theme.vars['--bg'] || '#000'}"></span>
        <span class="te-saved-swatch" style="background:${theme.vars['--accent'] || '#888'}"></span>
        <span class="te-saved-swatch" style="background:${theme.vars['--text'] || '#fff'}"></span>
      </span>
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
      if ((localStorage.getItem('pressTrackerTheme') || '') === 'custom_' + theme.id) applyTheme('midnight');
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
});
document.getElementById('machine-filter').addEventListener('change', () => {
  const mf = document.getElementById('machine-filter').value;
  const bc = document.getElementById('machine-breadcrumb');
  if (bc) {
    if (mf) { bc.classList.add('visible'); document.getElementById('breadcrumb-machine').textContent = 'Press ' + mf; }
    else { bc.classList.remove('visible'); }
  }
  renderIssues(); updateFilterBadge();
});
document.getElementById('status-filter').addEventListener('change', ()=>{ updateStatPillStyles(); renderIssues(); updateFilterBadge(); });

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
}

// Sync from filter drawer select to header dropdown
document.getElementById('sort-select')?.addEventListener('change', function() {
  setSort(this.value);
});

window.toggleSortDropdown = () => {
  const dd = document.getElementById('sort-dropdown');
  const btn = document.getElementById('sort-dropdown-btn');
  const isOpen = dd.classList.contains('visible');
  dd.classList.toggle('visible', !isOpen);
  btn.classList.toggle('open', !isOpen);
};

function closeSortDropdown() {
  document.getElementById('sort-dropdown')?.classList.remove('visible');
  document.getElementById('sort-dropdown-btn')?.classList.remove('open');
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('sort-dropdown-wrap');
  if (wrap && !wrap.contains(e.target)) closeSortDropdown();
});

buildSortDropdown();

window.toggleExportDropdown = () => {
  const dd = document.getElementById('export-dropdown');
  const btn = document.getElementById('export-menu-btn');
  const isOpen = dd?.classList.contains('visible');
  dd?.classList.toggle('visible', !isOpen);
  btn?.classList.toggle('open', !isOpen);
};

window.closeExportDropdown = () => {
  document.getElementById('export-dropdown')?.classList.remove('visible');
  document.getElementById('export-menu-btn')?.classList.remove('open');
};

document.addEventListener('click', e => {
  const wrap = document.getElementById('export-dropdown-wrap');
  if (wrap && !wrap.contains(e.target)) window.closeExportDropdown?.();
});

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
    serialInput.style.borderColor = 'var(--red)';
    document.getElementById('serial-select').style.borderColor = 'var(--red)';
    serialInput.focus();
    return;
  }
  if (!serialPattern.test(sn)) {
    serialError.textContent = 'Serial should usually look like STK##### (example: STK12345)';
    serialError.style.display = 'block';
    serialInput.style.borderColor = 'var(--red)';
    document.getElementById('serial-select').style.borderColor = 'var(--red)';
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

  return messageRef.id;
};

window.markConversationRead = async (conversationId, lastReadMessageId = null) => {
  if (!_requireChatContext()) return;
  if (!conversationId) return;
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
  if (!currentPlantId || !currentUser?.uid) {
    _updateMessagingEntryBadges(0);
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
  wrap.innerHTML = `<div class="msg-reaction" style="display:inline-flex;margin:8px 0;">📷 ${esc(file.name || 'image')}</div><img src="${objectUrl}" alt="selected photo preview" style="max-width:180px;border-radius:10px;border:1px solid var(--border);margin-top:6px;">`;
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
    const at = a.lastMessageAt?.toMillis?.() ?? a.lastMessageAt?.seconds * 1000 ?? 0;
    const bt = b.lastMessageAt?.toMillis?.() ?? b.lastMessageAt?.seconds * 1000 ?? 0;
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
  const lastSenderUid = conv?.lastMessage?.sender?.uid;
  if (!lastId || !lastSenderUid || lastSenderUid === currentUser?.uid) return 0;
  return _messagingState.lastSeenByConversation[conv.id] === lastId ? 0 : 1;
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
      .map(att => `<img class="messaging-msg-image" src="${esc(att.url)}" alt="${esc(att.fileName || 'image')}" style="max-width:200px;border-radius:10px;border:1px solid var(--border);margin-top:4px;">`).join('');
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
    markConversationRead(conversationId, lastId).catch(err => console.warn('markConversationRead failed', err));
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
  if (!('Notification' in window)) {
    _messagingSetError('Notifications are not supported in this browser.');
    return;
  }
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    _messagingSetError('');
    showGameToast('🔔 Messaging alerts enabled');
  } else {
    _messagingSetError('Notification permission was not granted.');
  }
};

async function _uploadMessagingPhoto(file, conversationId) {
  const path = `plants/${currentPlantId}/conversations/${conversationId}/photos/${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name || 'image.jpg'}`;
  const fileRef = storageRef(storage, path);
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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

let _notesLoadToken = 0;
let _notesSaveTimer = null;
let _notesUnsubscribe = null;
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
  row.style.borderBottom = '1px solid var(--line)';
  row.style.background = node.id === _pressWikiSelectedPageId ? 'color-mix(in srgb, var(--ios-blue) 14%, transparent)' : 'transparent';
  row.style.color = 'var(--text)';
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
    toggle.style.border = '1px solid var(--line)';
    toggle.style.background = 'var(--bg2)';
    toggle.style.color = 'var(--text2)';
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
  meta.style.color = 'var(--text3)';
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
    btn.style.background = 'var(--bg3)';
    btn.style.borderColor = 'var(--border)';
    btn.style.color = 'var(--text2)';
  });
  if (pressBtn) {
    pressBtn.style.background = !isShared ? 'var(--accent)' : 'var(--bg3)';
    pressBtn.style.borderColor = !isShared ? 'var(--accent)' : 'var(--border)';
    pressBtn.style.color = !isShared ? 'white' : 'var(--text2)';
  }
  if (sharedBtn) {
    sharedBtn.style.background = isShared ? 'var(--accent)' : 'var(--bg3)';
    sharedBtn.style.borderColor = isShared ? 'var(--accent)' : 'var(--border)';
    sharedBtn.style.color = isShared ? 'white' : 'var(--text2)';
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
      cap.style.color = 'var(--text3)';
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
    hr.style.borderTop = '1px solid var(--line)';
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
    empty.style.color = 'var(--text3)';
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
  const pagesSnap = await getDocs(wikiPagesColForScope(_pressWikiScope, queryPressId));
  const pages = pagesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
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
    const pageRef = wikiPageDocForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId);
    const pageSnap = await getDoc(pageRef);
    if (!pageSnap.exists()) {
      _pressWikiSelectedPageId = null;
      renderPressWikiEmptySelection(_pressWikiEmptySelectionMessage());
      _pressWikiSyncScopeBadge(_pressWikiScope);
      return;
    }
    const page = pageSnap.data() || {};
    const currentRevisionId = page.currentRevisionId || null;
    titleEl.textContent = page.title || pageId;
    metaEl.textContent = `${_pressWikiScopeLabel(page.scope || _pressWikiScope)} · Updated ${_relativeTime(page.updatedAt) || 'recently'}`;
    _pressWikiSyncScopeBadge(page.scope || _pressWikiScope);
    const revSnap = await getDocs(query(wikiRevisionsColForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId), orderBy('editedAt', 'desc'), limit(30)));
    const revisions = revSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const currentRevision = revisions.find(r => r.id === currentRevisionId) || revisions[0] || null;
    _renderPressWikiBody(currentRevision?.body || 'No revision body available.');
    revisionsEl.innerHTML = revisions.length ? '' : '<div style="color:var(--text3);">No revisions yet.</div>';
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
    const attachSnap = await getDocs(query(wikiAttachmentsColForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId), orderBy('uploadedAt', 'desc'), limit(24)));
    _pressWikiAttachmentsCache = attachSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
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
    const attachmentSnap = await getDocs(wikiAttachmentsColForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId));
    const attachments = attachmentSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    await Promise.allSettled(attachments.map(async a => {
      if (!a?.storagePath) return;
      const attStorage = a.storageBucket ? getStorage(app, `gs://${a.storageBucket}`) : storage;
      await deleteObject(storageRef(attStorage, a.storagePath));
    }));
    await _deleteWikiDocsInBatches(wikiAttachmentsColForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId));
    await _deleteWikiDocsInBatches(wikiRevisionsColForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId));
    await deleteDoc(wikiPageDocForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, pageId));
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
  await loadPressWikiPage(pageId);
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
  picker.innerHTML = '<div style="font-size:12px;color:var(--text3);margin-bottom:6px;">Insert from press wiki photos</div>';
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
    wikiEditBody.style.borderColor = 'var(--accent)';
    wikiEditBody.style.background = 'var(--bg2)';
  });
  wikiEditBody.addEventListener('dragleave', (e) => {
    e.preventDefault();
    wikiEditBody.style.borderColor = 'var(--border)';
    wikiEditBody.style.background = 'var(--bg3)';
  });
  wikiEditBody.addEventListener('drop', async (e) => {
    e.preventDefault();
    wikiEditBody.style.borderColor = 'var(--border)';
    wikiEditBody.style.background = 'var(--bg3)';
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
      const path = wikiStoragePrefixForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, _pressWikiSelectedPageId) + `/attachments/${attId}.${ext}`;
      const sRef = storageRef(storage, path);
      
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
      
      await setDoc(doc(db, ...wikiStoragePrefixForScope(_pressWikiScope, _pressWikiScope === WIKI_SCOPE_PRESS ? activePressId : _pressWikiModalPressId, _pressWikiSelectedPageId).split('/'), 'attachments', attId), attDoc);
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
    
    if (uploadedCount > 0) {
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
  const updatedAt = note?.updatedAt?.toMillis?.() ?? note?.updatedAt?.seconds * 1000 ?? 0;
  return {
    pinned: note?.isPinned ? 1 : 0,
    archived: note?.isArchived ? 1 : 0,
    updatedAt,
    title: String(note?.title || '').toLowerCase()
  };
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
  document.getElementById('notes-link-press-btn')?.toggleAttribute('disabled', !note?.id || !_notesContext.pressId);
  document.getElementById('notes-link-issue-btn')?.toggleAttribute('disabled', !note?.id || !_notesContext.issueId);
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
    if (att.storagePath) {
      const attStorage = att.storageBucket ? getStorage(app, `gs://${att.storageBucket}`) : storage;
      await deleteObject(storageRef(attStorage, att.storagePath));
    }
    await deleteDoc(doc(noteAttachmentsCol(noteId), attachmentId));
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
  return {
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
    updatedAt: serverTimestamp(),
    updatedBy: actor,
    schemaVersion: 1,
    ...(persistCreatedAt ? {
      createdAt: note?.createdAt || serverTimestamp(),
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
    await setDoc(noteDoc(note.id), payload, { merge: true });
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
    const pressId = _notesContext.pressId || '';
    const machineCode = _notesContext.machineCode || _notesContext.label?.replace(/^Press\s+/i, '') || '';
    _notesState.currentNote.pressId = pressId;
    _notesState.currentNote.machineCode = machineCode;
  } else if (kind === 'issue') {
    _notesState.currentNote.issueId = _notesContext.issueId || '';
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
  const ref = doc(notesCol());
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
    id: ref.id,
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
    createdAt: serverTimestamp(),
    createdBy: currentActor(),
    updatedAt: serverTimestamp(),
    updatedBy: currentActor(),
    schemaVersion: 1
  };
  _notesState.creating = true;
  _notesState.activeNoteId = ref.id;
  _notesSetView('editor');
  _notesRenderEditor(_notesNormalizeDoc(draft));
  queueMicrotask(_notesFocusTitle);
  await setDoc(ref, draft);
  await _notesLoadAttachments(ref.id);
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
    const snap = await getDocs(noteAttachmentsCol(note.id));
    await Promise.allSettled(snap.docs.map(async d => {
      const att = d.data() || {};
      if (!att.storagePath) return;
      const attStorage = att.storageBucket ? getStorage(app, `gs://${att.storageBucket}`) : storage;
      await deleteObject(storageRef(attStorage, att.storagePath));
    }));
    await _deleteWikiDocsInBatches(noteAttachmentsCol(note.id));
    await deleteDoc(noteDoc(note.id));
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
      const path = `${noteStoragePrefix(noteId)}/attachments/${attId}.${ext}`;
      const dataUrl = await readFileAsDataUrl(file);
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
      const attDoc = {
        storagePath: path,
        storageBucket: sRef.bucket,
        url,
        fileName: file.name || `attachment_${uploaded.length + 1}.${ext}`,
        contentType: file.type || 'image/jpeg',
        sizeBytes: file.size || 0,
        uploadedBy: currentActor(),
        uploadedAt: serverTimestamp(),
        schemaVersion: 1
      };
      await setDoc(doc(noteAttachmentsCol(noteId), attId), attDoc);
      uploaded.push(attDoc);
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
  if (!currentPlantId || !currentUser?.uid) {
    _notesRenderList();
    _notesRenderEditor(null);
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
  if (!_notesContext.pressId) return;
  void _notesSetContextLink('press');
});
document.getElementById('notes-link-issue-btn')?.addEventListener('click', () => {
  if (!_notesContext.issueId) return;
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

// ── EXPORT PDF ──
window.openExportModal = () => {
  // Build PDF preview from current filtered issues
  const search = document.getElementById('search-input').value.toLowerCase();
  const mf = document.getElementById('machine-filter').value;
  const sf = document.getElementById('status-filter').value;
  const sort = currentSort;

  const activeRowMachines = new Set();
  if (issueRowScope === 'active' && activeRows.size > 0) {
    activeRows.forEach(rowName => { (PRESSES[rowName]||[]).forEach(m => activeRowMachines.add(m)); });
  }

  let filtered = issues.filter(i => {
    if (issueScope === 'mine' && i.userId !== currentUser?.uid) return false;
    if (!periodFilter(i)) return false;
    if (issueRowScope === 'active' && activeRows.size > 0 && !activeRowMachines.has(i.machine)) return false;
    if (mf && i.machine !== mf) return false;
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

  // Apply same sort as the issue log so the PDF always matches what the user sees.
  applySortOrder(filtered, sort);

  document.getElementById('export-subtitle').textContent = filtered.length + ' issue' + (filtered.length!==1?'s':'') + ' in current view';

  // Build print-ready HTML
  const STATUS_CONFIG = Object.fromEntries(Object.entries(STATUSES).map(([k,v])=>[k,{label:v.label,icon:v.icon,color:v.swipeColor||v.cssColor||v.color,subs:v.subs}]));
  const STATUS_CONFIG_FALLBACK = key => STATUS_CONFIG[key] || { label: key || 'Unknown', icon: '●', color: '#8b949e', subs: [] };
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const userName = currentUser?.displayName || currentUser?.email || 'Unknown';

  let cardsHtml = '';
  filtered.forEach(issue => {
    const history = issue.eventHistory && issue.eventHistory.length > 0
      ? issue.eventHistory
      : [{
          status: currentStatusKey(issue),
          subStatus: issue.currentStatus?.subStatusKey || '',
          note: issue.currentStatus?.notePreview || '',
          dateTime: issue.currentStatus?.enteredDateTime || issue.dateTime || '',
          by: issue.currentStatus?.enteredBy?.name || issue.userName || ''
        }];
    const lastEntry = history[history.length-1];
    const lastKey = lastEntry.status || 'open';
    const cfg = STATUS_CONFIG_FALLBACK(lastKey);
    const statusLabel = cfg.label + (lastEntry.subStatus ? ' \u203a '+lastEntry.subStatus : '');
    const col = cfg.color || '#ef4444';

    // Status pill colors for print (light bg)
    const pillBg = alphaColor(col, 0.09);
    const pillBorder = alphaColor(col, 0.27);

    // Photos
    const photosHtml = (issue.photos||[]).length
      ? '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">' + issue.photos.map(p => '<img src="'+p.dataUrl+'" style="width:60px;height:60px;object-fit:cover;border-radius:4px;border:1px solid #ddd;">').join('') + '</div>' : '';

    // Timeline
    let tlHtml = '';
    history.forEach((entry, idx) => {
      const ecfg = STATUS_CONFIG_FALLBACK(entry.status);
      const isCurrent = idx === history.length - 1;
      tlHtml += '<div style="padding:3px 0 3px 10px;border-left:2px solid '+(isCurrent?ecfg.color:'#ddd')+';margin-bottom:2px;">'
        + '<div style="font-size:9px;font-weight:700;color:'+ecfg.color+';">'+ecfg.icon+' '+ecfg.label+(entry.subStatus?' \u203a '+esc(entry.subStatus):'')+(isCurrent?' (current)':'')+'</div>'
        + '<div style="font-size:8px;color:#999;">'+(entry.dateTime||'')+(entry.by?' \u2014 '+esc(entry.by):'')+'</div>'
        + (entry.note ? '<div style="font-size:8px;color:#666;font-style:italic;">\u201c'+esc(entry.note)+'\u201d</div>' : '')
        + '</div>';
    });

    const datePart = issue.dateTime || '';

    cardsHtml += `<div style="border:1px solid #ddd;border-radius:6px;margin-bottom:10px;overflow:hidden;page-break-inside:avoid;">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #eee;background:#fafafa;">
        <span style="font-size:14px;font-weight:700;color:#ea580c;font-family:monospace;background:#fff7ed;border:1px solid #fed7aa;border-radius:4px;padding:2px 8px;">${esc(issue.machine)}</span>
        <span style="font-size:12px;font-weight:700;flex:1;">${esc(issue.note||'')}</span>
        <span style="font-size:8px;font-weight:700;padding:2px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:0.3px;background:${pillBg};color:${col};border:1px solid ${pillBorder};">${esc(statusLabel)}</span>
      </div>
      <div style="padding:10px;font-size:10px;">
        <div style="font-size:11px;line-height:1.5;margin-bottom:6px;color:#333;">${esc(issue.note||'')}</div>
        <div style="display:flex;gap:16px;color:#666;font-size:9px;margin-bottom:4px;">
          <span><span style="color:#999;">Logged:</span> ${esc(datePart)}</span>
          <span><span style="color:#999;">By:</span> ${esc(issue.userName||'')}</span>
        </div>
        ${issue.resolveNote ? '<div style="display:flex;gap:16px;color:#666;font-size:9px;margin-bottom:4px;"><span><span style="color:#999;">Resolved:</span> '+(issue.resolveDateTime||'')+'</span><span><span style="color:#999;">By:</span> '+(issue.resolvedBy||'')+'</span></div><div style="font-size:9px;color:#166534;background:#dcfce7;padding:4px 8px;border-radius:4px;margin-bottom:6px;">'+esc(issue.resolveNote)+'</div>' : ''}
        ${photosHtml}
        <div style="margin-top:8px;padding-top:6px;border-top:1px solid #eee;">
          <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#999;margin-bottom:4px;">Status history</div>
          ${tlHtml}
        </div>
      </div>
    </div>`;
  });

  const previewHtml = `<div id="pdf-content" style="background:white;padding:20px;color:#1a1a1a;font-family:'Segoe UI',sans-serif;font-size:11px;">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;border-bottom:2px solid #ea580c;padding-bottom:8px;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:700;color:#ea580c;letter-spacing:0.5px;">AP-TRACKER</div>
      <div style="text-align:right;font-size:9px;color:#666;line-height:1.5;">Issue log report<br>${dateStr}<br>Generated by ${esc(userName)}</div>
    </div>
    ${cardsHtml}
  </div>`;

  document.getElementById('export-preview').innerHTML = previewHtml;
  document.getElementById('export-modal').classList.add('visible');
};

window.closeExportModal = () => {
  document.getElementById('export-modal').classList.remove('visible');
};

window.downloadPDF = async () => {
  const btn = document.getElementById('export-dl-btn');
  let wrapper = null;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generating…';
  try {
    const src = document.getElementById('pdf-content');
    if (!src) throw new Error('PDF content not found');
    closeExportModal();
    // Clone into a temp wrapper at position 0,0 to prevent html2pdf top-margin bug
    wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;top:0;left:-10000px;width:816px;background:white;opacity:0.01;pointer-events:none;';
    const clone = src.cloneNode(true);
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    const opt = {
      margin: [0.4, 0.4, 0.4, 0.4],
      filename: 'AP-Tracker-Report-' + localDateStr(new Date()) + '.pdf',
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, scrollY: 0, scrollX: 0 },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css'] }
    };
    await html2pdf().set(opt).from(clone).save();
  } catch(e) {
    console.error('PDF export error:', e);
  } finally {
    if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12v1a1 1 0 001 1h8a1 1 0 001-1v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Download PDF';
  }
};

// Close export modal on escape / overlay click
document.getElementById('export-modal')?.addEventListener('click', e => { if(e.target===document.getElementById('export-modal')) closeExportModal(); });

window.downloadExcel = async () => {
  if (typeof XLSX === 'undefined') {
    alert('Excel library not loaded. Please refresh and try again.');
    return;
  }
  const btn = document.getElementById('export-excel-menu-item');
  const origInner = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Building…';
  try {
    // Apply the same filters as the PDF export and the issue log view
    const search = document.getElementById('search-input').value.toLowerCase();
    const mf = document.getElementById('machine-filter').value;
    const sf = document.getElementById('status-filter').value;
    const sort = currentSort;

    const activeRowMachines = new Set();
    if (issueRowScope === 'active' && activeRows.size > 0) {
      activeRows.forEach(rowName => { (PRESSES[rowName]||[]).forEach(m => activeRowMachines.add(m)); });
    }

    let filtered = issues.filter(i => {
      if (issueScope === 'mine' && i.userId !== currentUser?.uid) return false;
      if (!periodFilter(i)) return false;
      if (issueRowScope === 'active' && activeRows.size > 0 && !activeRowMachines.has(i.machine)) return false;
      if (mf && i.machine !== mf) return false;
      if (sf && !issueHasActiveStatus(i, sf)) return false;
      if (search) {
        const mt = String(i.machine||'').toLowerCase(), nt = String(i.note||'').toLowerCase();
        const rt = String(i.resolveNote||'').toLowerCase(), ut = String(i.userName||'').toLowerCase();
        if (!mt.includes(search) && !nt.includes(search) && !rt.includes(search) && !ut.includes(search)) return false;
      }
      return true;
    });
    applySortOrder(filtered, sort);

    // Ensure event history and photos are fetched for all filtered issues
    await Promise.all(filtered.map(async issue => {
      if (issue.schemaVersion === 2 && (!issue.eventHistory || issue.eventHistory.length === 0)) {
        const h = await fetchIssueEventHistory(issue);
        if (h.length > 0) issue.eventHistory = h;
      }
      if (Number(issue.photoCount || 0) > 0 && (!issue.photos || issue.photos.length === 0)) {
        issue.photos = await fetchAttachmentPhotos(issue.id);
      }
    }));

    // Build rowId → human-readable row name lookup
    const rowIdToName = {};
    Object.entries(PRESSES).forEach(([rowName, machines]) => {
      rowIdToName[toRowId(rowName)] = rowName;
    });

    // Convert a Firestore Timestamp, epoch ms number, or Date to a JS Date (or null)
    const toJsDate = ts => {
      if (!ts) return null;
      if (ts instanceof Date) return ts;
      if (typeof ts.toDate === 'function') return ts.toDate();
      if (typeof ts === 'number') return new Date(ts);
      return null;
    };

    // ── Issues sheet ──
    const ISSUE_HEADERS = ['Issue ID','Plant ID','Machine','Row','Date Logged','Note','Status','Sub-Status',
      'Logged By','Resolved','Resolved At','Resolve Note','Resolved By','Photo Count','Photo URLs',
      'Workflow State','Created At','Updated At'];
    const issueRows = filtered.map(issue => {
      const statusKey = currentStatusKey(issue);
      const statusLabel = getStatusDef(statusKey).label || statusKey;
      const subStatus = issue.currentStatus?.subStatusKey || '';
      const rowName = rowIdToName[issue.rowId] || issue.rowId || '';
      const isResolved = !!(issue.lifecycle?.isResolved || issue.resolved);
      const history = issue.eventHistory || issue.statusHistory || [];
      const resolvedEntry = history.slice().reverse().find(e => e.status === 'resolved');
      const photoUrls = (issue.photos||[]).map(p=>p.dataUrl).filter(Boolean).join('\n');
      return {
        'Issue ID': issue.id,
        'Plant ID': issue.plantId || currentPlantId,
        'Machine': issue.machine || '',
        'Row': rowName,
        'Date Logged': toJsDate(issue.timestamp) || issue.dateTime || '',
        'Note': issue.note || '',
        'Status': statusLabel,
        'Sub-Status': subStatus,
        'Logged By': issue.userName || '',
        'Resolved': isResolved ? 'Yes' : 'No',
        'Resolved At': toJsDate(issue.lifecycle?.resolvedAt) || '',
        'Resolve Note': issue.resolveNote || '',
        'Resolved By': resolvedEntry?.by || issue.resolvedBy || '',
        'Photo Count': Number(issue.photoCount || 0),
        'Photo URLs': photoUrls,
        'Workflow State': issue.workflowState || 'called',
        'Created At': toJsDate(issue.createdAt) || '',
        'Updated At': toJsDate(issue.updatedAt) || '',
      };
    });

    // ── Events sheet ──
    const EVENT_HEADERS = ['Issue ID','Machine','Event #','Date/Time','From Status','To Status','Sub-Status','Note','By'];
    const eventRows = [];
    filtered.forEach(issue => {
      const history = issue.eventHistory || issue.statusHistory || [];
      history.forEach((entry, idx) => {
        const prevKey = idx > 0 ? history[idx-1].status : '';
        eventRows.push({
          'Issue ID': issue.id,
          'Machine': issue.machine || '',
          'Event #': idx + 1,
          'Date/Time': entry.dateTime || '',
          'From Status': prevKey ? (getStatusDef(prevKey).label || prevKey) : '',
          'To Status': getStatusDef(entry.status).label || entry.status || '',
          'Sub-Status': entry.subStatus || '',
          'Note': entry.note || '',
          'By': entry.by || '',
        });
      });
    });

    // ── Photos sheet ──
    const PHOTO_HEADERS = ['Issue ID','Machine','File Name','Storage Path','Download URL','Content Type','Size (bytes)'];
    const photoRows = [];
    filtered.forEach(issue => {
      (issue.photos||[]).forEach(p => {
        photoRows.push({
          'Issue ID': issue.id,
          'Machine': issue.machine || '',
          'File Name': p.name || '',
          'Storage Path': p.storagePath || '',
          'Download URL': p.dataUrl || '',
          'Content Type': p.contentType || '',
          'Size (bytes)': Number(p.sizeBytes || 0),
        });
      });
    });

    const mkSheet = (rows, headers) => XLSX.utils.json_to_sheet(
      rows.length > 0 ? rows : [Object.fromEntries(headers.map(h=>[h,null]))],
      { header: headers, cellDates: true }
    );

    const wsIssues = mkSheet(issueRows, ISSUE_HEADERS);
    const wsEvents = mkSheet(eventRows, EVENT_HEADERS);
    const wsPhotos = mkSheet(photoRows, PHOTO_HEADERS);

    wsIssues['!cols'] = [24,14,10,12,20,44,18,18,20,10,20,44,20,12,60,16,20,20].map(w=>({wch:w}));
    wsEvents['!cols'] = [24,10,8,20,18,18,18,44,20].map(w=>({wch:w}));
    wsPhotos['!cols'] = [24,10,30,60,80,14,14].map(w=>({wch:w}));

    if (issueRows.length > 0) {
      const r = XLSX.utils.decode_range(wsIssues['!ref']);
      wsIssues['!autofilter'] = { ref: XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:0,c:r.e.c}}) };
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsIssues, 'Issues');
    XLSX.utils.book_append_sheet(wb, wsEvents, 'Events');
    XLSX.utils.book_append_sheet(wb, wsPhotos, 'Photos');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'AP-Tracker-Export-' + localDateStr(new Date()) + '.xlsx';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch(e) {
    console.error('Excel export error:', e);
    alert('Excel export failed. See console for details.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origInner;
  }
};

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
      bulkInput.style.background = 'var(--bg2)';
      bulkInput.style.border = '1px solid var(--border)';
      bulkInput.style.borderRadius = '8px';
      bulkInput.style.padding = '10px';
      bulkInput.style.color = 'var(--text)';
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
  addError.style.color = 'var(--red)';
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
    open:            { label:'Open',             shortLabel:'Open',         icon:'●',  cssColor:'var(--red)',      swipeColor:'#ef4444', floorCls:'has-open',            cls:'status-open',            subs:['New Fault / Issue','Pending Triage','Scheduled Mold Change','Re-opened'],                                               statLabel:'Open',          order:0 },
    alert:           { label:'Alert',            shortLabel:'Alert',        icon:'🚨', cssColor:'#dc2626',         swipeColor:'#dc2626', floorCls:'has-alert',           cls:'status-alert',           subs:['Mold Protection Fault','E-Stop / Safety Hazard','Press Down - Critical','Major Oil / Fluid Leak'],                   statLabel:'Alert',         order:1 },
    controlman:      { label:'Controlman',       shortLabel:'Controlman',   icon:'🎛️', cssColor:'var(--babyblue)', swipeColor:'#38bdf8', floorCls:'has-controlman',      cls:'status-controlman',      subs:['Robot / EOAT (End of Arm Tooling) Fault','Vision System / Camera Error','Conveyor / Auxiliary Comm Loss','PLC / HMI Error'], statLabel:'Controlman',    order:2 },
    maintenance:     { label:'Maintenance',      shortLabel:'Maintenance',  icon:'🔧', cssColor:'var(--yellow)',   swipeColor:'#eab308', floorCls:'has-maintenance',     cls:'status-maintenance',     subs:['Hydraulic Leak / Pressure Drop','Heater Band / Thermocouple Failure','Barrel / Screw / Check Ring Issue','Chiller / Thermolator Failure'], statLabel:'Maintenance',   order:3 },
    materials:       { label:'Materials',        shortLabel:'Materials',    icon:'📦', cssColor:'#8b5cf6',         swipeColor:'#8b5cf6', floorCls:'has-materials',       cls:'status-materials',       subs:['Resin Moisture / Drying Issue','Colorant / Masterbatch Ratio Error','Vacuum / Material Loader Blockage','Wrong Resin / Regrind Issue'], statLabel:'Materials',     order:4 },
    processengineer: { label:'Process Engineer', shortLabel:'Process Eng.', icon:'⚙️', cssColor:'var(--purple)',   swipeColor:'#a855f7', floorCls:'has-processengineer', cls:'status-processengineer', subs:['Fill / Pack Pressure Adjustment','Temperature Profile Tuning','Cycle Time Optimization','Process Drift / Instability'], statLabel:'Process Eng.',  order:5 },
    quality:         { label:'Quality',          shortLabel:'Quality',      icon:'✨', cssColor:'#06b6d4',         swipeColor:'#06b6d4', floorCls:'has-quality',         cls:'status-quality',         subs:['Short Shot / Non-fill','Flash / Burrs','Sink Marks / Voids','Splay / Silver Streaks','Burn Marks / Degradation','Warp / Dimensional Out-of-Spec'], statLabel:'Quality',       order:6 },
    startup:         { label:'Startup',          shortLabel:'Startup',      icon:'🚀', cssColor:'var(--teal)',     swipeColor:'#14b8a6', floorCls:'has-startup',         cls:'status-startup',         subs:['Purging / Color Change','Mold Heat-Up / Stabilization','First Article Inspection (FAI)','Robot Homing / Path Setup'], statLabel:'Startup',       order:7 },
    tooldie:         { label:'Tool & Die',       shortLabel:'Tool & Die',   icon:'🔩', cssColor:'var(--orange)',   swipeColor:'#f97316', floorCls:'has-tooldie',         cls:'status-tooldie',         subs:['Broken / Bent Ejector Pin','Hot Runner / Gate Issue','Water Leak in Mold','Stuck Part / Sprue','Mold Greasing / PM'], statLabel:'Tool & Die',    order:8 },
    resolved:        { label:'Resolved',         shortLabel:'Resolved',     icon:'✓',  cssColor:'var(--green)',    swipeColor:'#22c55e', floorCls:'all-resolved',        cls:'status-resolved',        subs:['Process Parameter Adjusted','Mold Cleaned / Repaired','Hardware Replaced','Temporary Workaround'],                      statLabel:'Resolved',      order:9 },
  };
  
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
  if (issues.length > 0) renderIssues();
}, 60000);

setInterval(() => {
  if (document.hidden) return;
  refreshReminderClocksInDom();
}, 1000);

// ── DEMO MODE ENGINE ──

const DEMO_PLANT_ID = 'plant_demo';

async function _bootstrapDemoPlant() {
  const plantRef = doc(db, 'plants', DEMO_PLANT_ID);
  const snap = await getDoc(plantRef);
  if (snap.exists()) return;
  const batch1 = writeBatch(db);
  batch1.set(plantRef, { name: 'Demo Plant', location: 'Demo Location', createdAt: serverTimestamp(), isActive: true });
  batch1.set(doc(db, 'plants', DEMO_PLANT_ID, 'members', currentUser.uid), {
    userId: currentUser.uid, displayName: 'Demo Session', email: '', photoURL: '',
    role: 'admin', isActive: true, addedAt: serverTimestamp(), permissions: { ...DEFAULT_PERMISSIONS }
  });
  batch1.set(doc(db, 'users', currentUser.uid), { plantIds: [DEMO_PLANT_ID], lastPlant: DEMO_PLANT_ID }, { merge: true });
  await batch1.commit();
  const batch2 = writeBatch(db);
  batch2.set(doc(db, 'plants', DEMO_PLANT_ID, 'config', 'presses'), { presses: DEFAULT_PRESSES });
  await batch2.commit();
}

const DEMO_AGENTS = [
  { uid: 'demo_sarah',   displayName: 'Sarah Chen',       email: 'sarah@demo.local',   role: 'processengineer', rows: ['Row 1','Row 2'],                              preferredStatuses: ['processengineer','quality'],       createWeight: 8,  statusWeight: 6 },
  { uid: 'demo_marcus',  displayName: 'Marcus Johnson',    email: 'marcus@demo.local',  role: 'maintenance',     rows: ['Row 3','Row 4'],                              preferredStatuses: ['maintenance'],                    createWeight: 6,  statusWeight: 8 },
  { uid: 'demo_emily',   displayName: 'Emily Rodriguez',   email: 'emily@demo.local',   role: 'quality',         rows: ['Row 5','Row 6'],                              preferredStatuses: ['quality'],                       createWeight: 5,  statusWeight: 7 },
  { uid: 'demo_james',   displayName: 'James Kim',          email: 'james@demo.local',   role: 'admin',           rows: ['Row 1','Row 2','Row 3','Row 4','Row 5','Row 6'], preferredStatuses: ['open','resolved'],               createWeight: 4,  statusWeight: 5 },
  { uid: 'demo_lisa',    displayName: 'Lisa Thompson',      email: 'lisa@demo.local',    role: 'operator',        rows: ['Row 1'],                                      preferredStatuses: ['alert','maintenance','materials'], createWeight: 10, statusWeight: 4 },
  { uid: 'demo_david',   displayName: 'David Wilson',       email: 'david@demo.local',   role: 'tooldie',         rows: ['Row 2','Row 3'],                              preferredStatuses: ['tooldie','maintenance'],          createWeight: 5,  statusWeight: 7 },
  { uid: 'demo_ana',     displayName: 'Ana Martinez',       email: 'ana@demo.local',     role: 'materials',       rows: ['Row 4'],                                      preferredStatuses: ['materials','startup'],            createWeight: 6,  statusWeight: 6 },
  { uid: 'demo_tom',     displayName: 'Tom Baker',          email: 'tom@demo.local',     role: 'controlman',      rows: ['Row 5'],                                      preferredStatuses: ['controlman','maintenance'],        createWeight: 4,  statusWeight: 8 },
  { uid: 'demo_rachel',  displayName: 'Rachel Green',       email: 'rachel@demo.local',  role: 'startup',         rows: ['Row 6'],                                      preferredStatuses: ['startup','quality'],              createWeight: 6,  statusWeight: 6 },
  { uid: 'demo_mike',    displayName: 'Mike Davis',         email: 'mike@demo.local',    role: 'general',         rows: ['Row 1','Row 2','Row 3','Row 4','Row 5','Row 6'], preferredStatuses: [],                               createWeight: 7,  statusWeight: 5 }
];

const DEMO_NOTE_POOLS = {
  general: [
    'Press {machine} - {issue}',
    '{machine} needs attention - {issue}',
    'Issue on {machine}: {issue}',
    '{machine} - {issue}',
    'Checking {machine}, found {issue}',
    '{issue} at {machine}',
    'Routine check on {machine} - {issue}',
    '{machine} reported with {issue}'
  ],
  issues: [
    'unusual noise during cycle',
    'part quality deviation detected',
    'misfeed on transfer mechanism',
    'sensor fault in safety circuit',
    'scratched part surface',
    'hydraulic pressure fluctuation',
    'tonnage reading out of spec',
    'slow cycle time',
    'limit switch not triggering',
    'coolant leak detected',
    'die alignment issue',
    'part dimension out of tolerance',
    'slide lubrication low',
    'air pressure drop in system',
    'guard door switch intermittent',
    'part stuck in die',
    'operator control panel unresponsive',
    'conveyor jam at discharge',
    'strip feed error',
    'counter reading mismatch'
  ]
};

function _demoPick(list) { return list[Math.floor(Math.random() * list.length)]; }

function _demoRandomNote(machine) {
  const issue = _demoPick(DEMO_NOTE_POOLS.issues);
  const tmpl = _demoPick(DEMO_NOTE_POOLS.general);
  return tmpl.replace('{machine}', machine).replace('{issue}', issue);
}

function _demoMachineForAgent(agent) {
  const machines = [];
  for (const row of agent.rows) {
    const rowMachines = PRESSES[row];
    if (rowMachines) machines.push(...rowMachines);
  }
  if (machines.length === 0) return '1.01';
  return _demoPick(machines);
}

function _demoPickAgent(weightKey) {
  const total = DEMO_AGENTS.reduce((s, a) => s + a[weightKey], 0);
  let r = Math.random() * total;
  for (const agent of DEMO_AGENTS) {
    r -= agent[weightKey];
    if (r <= 0) return agent;
  }
  return DEMO_AGENTS[0];
}

function _demoBuildIssuePayload(issueId, machine, note, statusKey, subStatus, simTime) {
  const d = new Date();
  d.setHours(6, 0, 0, 0);
  d.setSeconds(d.getSeconds() + simTime);
  const dateTime = fmtDate(d);
  const dateKey = localDateStr(d);
  const timestamp = d.getTime();
  const isUrgent = Math.random() < 0.08;
  return {
    machine, note,
    dateTime, dateKey, timestamp,
    shift: 'first',
    timer: { minutes: 0, endAt: 0, isRunning: false, alerted: false },
    userId: currentUser.uid, userName: currentUser.displayName || currentUser.email,
    photoCount: 0,
    createdAt: serverTimestamp(),
    createdBy: currentActor(),
    ...(isUrgent ? { highPriority: true, priority: 'critical' } : {}),
    schemaVersion: 2,
    plantId: DEMO_PLANT_ID,
    pressId: toPressId(machine),
    machineCode: machine,
    rowId: toRowId(findRowNameForMachine(machine)),
    currentStatus: {
      statusKey: statusKey || 'open',
      subStatusKey: subStatus || '',
      label: (getStatusDef(statusKey) || {}).label || statusKey || 'Open',
      subLabel: subStatus || '',
      color: getStatusColor(statusKey || 'open'),
      enteredAt: serverTimestamp(),
      enteredDateTime: dateTime,
      enteredBy: currentActor(),
      notePreview: note || ''
    },
    lifecycle: {
      isOpen: statusKey !== 'resolved',
      isResolved: statusKey === 'resolved',
      openedAt: serverTimestamp(),
      resolvedAt: statusKey === 'resolved' ? serverTimestamp() : null,
      closedAt: statusKey === 'resolved' ? serverTimestamp() : null,
      reopenedCount: 0
    },
    updatedAt: serverTimestamp(),
    updatedBy: currentActor()
  };
}

function _demoRunAs(agent, fn) {
  const prev = currentUser;
  currentUser = { ...prev, uid: agent.uid, displayName: agent.displayName, email: agent.email, photoURL: '' };
  try { return fn(); }
  finally { currentUser = prev; }
}

async function demoCreateIssue(agent, simTime) {
  const machine = _demoMachineForAgent(agent);
  const note = _demoRandomNote(machine);
  const isResolved = Math.random() < 0.05;
  const statusKey = isResolved ? 'resolved' : (agent.preferredStatuses.length > 0 && Math.random() < 0.6 ? _demoPick(agent.preferredStatuses) : 'open');
  const subStatus = '';
  return _demoRunAs(agent, async () => {
    const issueRef = doc(plantCol('issues'));
    const batch = writeBatch(db);
    batch.set(issueRef, _demoBuildIssuePayload(issueRef.id, machine, note, statusKey, subStatus, simTime));
    batch.set(doc(issueEventsCol(issueRef.id)), {
      type: 'issue_created', eventAt: serverTimestamp(), actor: currentActor(), schemaVersion: 2,
      payload: { machineCode: machine, note, initialStatusKey: statusKey, initialSubStatusKey: subStatus, urgent: false }
    });
    batch.set(doc(issueEventsCol(issueRef.id)), {
      type: 'status_changed', eventAt: serverTimestamp(), actor: currentActor(), schemaVersion: 2,
      payload: { fromStatusKey: null, fromSubStatusKey: null, toStatusKey: statusKey, toSubStatusKey: subStatus, note: '' }
    });
    await batch.commit();
    return { issueId: issueRef.id, machine, statusKey };
  });
}

async function demoChangeStatus(agent, issueId, currentStatusObj, note) {
  const validNext = STATUS_FLOW[currentStatusObj.status || 'open'] || ['resolved'];
  const preferredRanked = validNext.filter(s => agent.preferredStatuses.includes(s));
  const nextStatus = preferredRanked.length > 0 ? _demoPick(preferredRanked) : _demoPick(validNext);
  return _demoRunAs(agent, () => window.addStatusEntry(issueId, nextStatus, '', note || ''));
}

async function demoResolveIssue(agent, issueId, note) {
  return _demoRunAs(agent, () => window.addStatusEntry(issueId, 'resolved', '', note || 'Resolved - issue completed'));
}

async function demoReopenIssue(agent, issueId, note) {
  return _demoRunAs(agent, () => window.addStatusEntry(issueId, 'open', '', note || 'Reopened - issue resurfaced'));
}

const STATUS_FLOW = {
  open: ['alert','controlman','maintenance','materials','quality','processengineer','startup','tooldie'],
  alert: ['maintenance','controlman','tooldie'],
  maintenance: ['quality','startup','resolved'],
  materials: ['startup','resolved'],
  quality: ['resolved'],
  processengineer: ['maintenance','tooldie','resolved'],
  controlman: ['maintenance','resolved'],
  startup: ['quality','resolved'],
  tooldie: ['maintenance','quality','resolved'],
  resolved: ['open']
};

// ── Simulation engine ──

const DEMO_SHIFT_SECONDS = 6 * 3600;
let _demoSim = null;

function startDemoEngine() {
  if (_demoSim) return;
  _demoSim = {
    simTime: 0,
    speed: 60,
    running: true,
    actions: [],
    createdIssues: [],
    tickCount: 0,
    paused: false
  };
  _generateDemoActions();
  _demoSim.interval = setInterval(_demoTick, 500);
}

function stopDemoEngine() {
  if (!_demoSim) return;
  _demoSim.running = false;
  clearInterval(_demoSim.interval);
  _demoSim = null;
}

function _generateDemoActions() {
  const actions = [];
  for (let i = 0; i < 55; i++) {
    const t = Math.round(300 + Math.random() * (DEMO_SHIFT_SECONDS - 600));
    const agent = _demoPickAgent('createWeight');
    actions.push({ type: 'create', t, agent: { ...agent } });
  }
  actions.sort((a, b) => a.t - b.t);
  _demoSim.actions = actions;
}

function _demoTick() {
  if (!_demoSim || _demoSim.paused) return;
  _demoSim.tickCount++;
  _demoSim.simTime += _demoSim.speed * 0.5;
  const sim = _demoSim;

  while (sim.actions.length > 0 && sim.actions[0].t <= sim.simTime) {
    const action = sim.actions.shift();
    _demoExecuteAction(action).catch(e => console.warn('Demo action failed:', e));
  }

  if (sim.simTime >= DEMO_SHIFT_SECONDS) {
    _demoSimComplete();
    return;
  }

  if (sim.tickCount % 8 === 0 && sim.createdIssues.length > 0 && Math.random() < 0.3) {
    const openIssues = [];
    for (const ci of sim.createdIssues) {
      const issue = issuesById.get(ci.issueId);
      if (issue && !issue.lifecycle?.isResolved) {
        const cs = currentStatus(issue);
        if (cs && cs.status !== 'resolved') openIssues.push(ci);
      }
    }
    if (openIssues.length > 0) {
      const target = _demoPick(openIssues);
      const followTime = sim.simTime + 60 + Math.random() * 600;
      const agent = _demoPickAgent('statusWeight');
      sim.actions.push({ type: 'status', t: followTime, agent: { ...agent }, issueId: target.issueId, issueMachine: target.machine });
      sim.actions.sort((a, b) => a.t - b.t);
    }
  }

  if (sim.simTime > DEMO_SHIFT_SECONDS * 0.5 && sim.tickCount % 12 === 0) {
    const resolvable = [];
    for (const ci of sim.createdIssues) {
      const issue = issuesById.get(ci.issueId);
      if (issue && !issue.lifecycle?.isResolved) resolvable.push(ci);
    }
    if (resolvable.length > 0 && Math.random() < 0.25) {
      const target = _demoPick(resolvable);
      const followTime = sim.simTime + 30 + Math.random() * 300;
      const agent = _demoPickAgent('statusWeight');
      sim.actions.push({ type: 'resolve', t: followTime, agent: { ...agent }, issueId: target.issueId, issueMachine: target.machine });
      sim.actions.sort((a, b) => a.t - b.t);
    }
  }

  if (sim.simTime > DEMO_SHIFT_SECONDS * 0.3 && sim.tickCount % 30 === 0 && Math.random() < 0.1) {
    const resolved = [];
    for (const ci of sim.createdIssues) {
      const issue = issuesById.get(ci.issueId);
      if (issue && issue.lifecycle?.isResolved) resolved.push(ci);
    }
    if (resolved.length > 0) {
      const target = _demoPick(resolved);
      const followTime = sim.simTime + 30;
      const agent = _demoPickAgent('createWeight');
      sim.actions.push({ type: 'reopen', t: followTime, agent: { ...agent }, issueId: target.issueId, issueMachine: target.machine });
      sim.actions.sort((a, b) => a.t - b.t);
    }
  }

  _demoUpdateUI();
}

async function _demoExecuteAction(action) {
  const agent = DEMO_AGENTS.find(a => a.uid === action.agent.uid) || DEMO_AGENTS[0];
  const issue = action.issueId ? issuesById.get(action.issueId) : null;

  switch (action.type) {
    case 'create': {
      const result = await demoCreateIssue(agent, action.t);
      if (result) _demoSim.createdIssues.push(result);
      _demoLog(`${agent.displayName} logged issue on Press ${result.machine}`);
      break;
    }
    case 'status': {
      if (!issue) return;
      const cs = currentStatus(issue);
      const note = _demoRandomNote(action.issueMachine || issue.machine || '');
      await demoChangeStatus(agent, action.issueId, cs, note);
      _demoLog(`${agent.displayName} updated Press ${issue.machine || action.issueMachine}`);
      break;
    }
    case 'resolve': {
      if (!issue) return;
      await demoResolveIssue(agent, action.issueId);
      _demoLog(`${agent.displayName} resolved Press ${issue.machine || action.issueMachine}`);
      break;
    }
    case 'reopen': {
      if (!issue) return;
      await demoReopenIssue(agent, action.issueId);
      _demoLog(`${agent.displayName} reopened Press ${issue.machine || action.issueMachine}`);
      break;
    }
  }
}

function _demoSimComplete() {
  stopDemoEngine();
  _demoLog('✅ Shift complete! Demo simulation finished.');
  const btn = document.getElementById('demo-play-btn');
  if (btn) btn.textContent = '✅';
}

function _demoLog(msg) {
  const feed = document.getElementById('demo-feed');
  if (!feed) return;
  const t = _demoSim ? _demoFormatTime(_demoSim.simTime) : '--:--';
  const el = document.createElement('div');
  el.className = 'demo-feed-item';
  el.textContent = `[${t}] ${msg}`;
  feed.insertBefore(el, feed.firstChild);
  while (feed.children.length > 50) feed.removeChild(feed.lastChild);
}

function _demoFormatTime(s) {
  const h = Math.floor(s / 3600) + 6;
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function _demoUpdateUI() {
  if (!_demoSim) return;
  const timeEl = document.getElementById('demo-time');
  const barEl = document.getElementById('demo-progress');
  const speedEl = document.getElementById('demo-speed-label');
  if (timeEl) timeEl.textContent = _demoFormatTime(_demoSim.simTime);
  if (barEl) barEl.style.width = Math.min(100, (_demoSim.simTime / DEMO_SHIFT_SECONDS) * 100) + '%';
  if (speedEl) speedEl.textContent = _demoSim.speed + '\u00d7';
}

// ── Demo controls UI ──

function buildDemoControls() {
  const existing = document.getElementById('demo-controls');
  if (existing) existing.remove();

  const style = document.createElement('style');
  style.textContent = `
    #demo-controls { position:fixed; bottom:12px; left:50%; transform:translateX(-50%); z-index:9999; background:rgba(0,0,0,0.88); backdrop-filter:blur(8px); border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:10px 16px; display:flex; align-items:center; gap:12px; font-family:Nunito,sans-serif; font-size:12px; color:#fff; box-shadow:0 4px 24px rgba(0,0,0,0.5); user-select:none; min-width:480px; justify-content:center; flex-wrap:wrap; }
    #demo-controls .demo-btn { background:rgba(255,255,255,0.1); border:none; color:#fff; width:32px; height:32px; border-radius:8px; cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center; transition:background 0.15s; }
    #demo-controls .demo-btn:hover { background:rgba(255,255,255,0.2); }
    #demo-controls .demo-btn:disabled { opacity:0.3; cursor:default; }
    #demo-controls .demo-label { color:rgba(255,255,255,0.6); font-size:11px; }
    #demo-controls .demo-value { color:#fff; font-weight:600; }
    #demo-controls .demo-time-display { font-family:Share Tech Mono,monospace; font-size:14px; color:#4ade80; min-width:60px; text-align:center; }
    #demo-controls .demo-progress-track { width:100px; height:4px; background:rgba(255,255,255,0.15); border-radius:2px; overflow:hidden; }
    #demo-controls .demo-progress-fill { height:100%; background:#4ade80; border-radius:2px; transition:width 0.3s; width:0%; }
    #demo-controls .demo-speed-slider { width:80px; accent-color:#4ade80; cursor:pointer; }
    #demo-controls .demo-sep { width:1px; height:24px; background:rgba(255,255,255,0.12); }
    #demo-feed { position:fixed; bottom:68px; left:50%; transform:translateX(-50%); z-index:9998; max-height:160px; width:520px; overflow-y:auto; background:rgba(0,0,0,0.75); backdrop-filter:blur(4px); border-radius:10px; padding:8px 12px; font-family:Nunito,sans-serif; font-size:11px; color:rgba(255,255,255,0.8); pointer-events:none; }
    #demo-feed .demo-feed-item { padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.05); }
    #demo-controls .demo-created-count { font-size:11px; color:rgba(255,255,255,0.5); }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'demo-controls';

  const playBtn = document.createElement('button');
  playBtn.id = 'demo-play-btn';
  playBtn.className = 'demo-btn';
  playBtn.textContent = '\u23f8';
  playBtn.title = 'Pause simulation';
  playBtn.addEventListener('click', () => {
    if (!_demoSim) return;
    _demoSim.paused = !_demoSim.paused;
    playBtn.textContent = _demoSim.paused ? '\u25b6' : '\u23f8';
    playBtn.title = _demoSim.paused ? 'Resume simulation' : 'Pause simulation';
  });
  panel.appendChild(playBtn);

  const resetBtn = document.createElement('button');
  resetBtn.className = 'demo-btn';
  resetBtn.textContent = '\u27f3';
  resetBtn.title = 'Reset demo';
  resetBtn.addEventListener('click', resetDemo);
  panel.appendChild(resetBtn);

  const sep1 = document.createElement('div');
  sep1.className = 'demo-sep';
  panel.appendChild(sep1);

  const timeLabel = document.createElement('span');
  timeLabel.className = 'demo-label';
  timeLabel.textContent = 'Shift: ';
  panel.appendChild(timeLabel);
  const timeVal = document.createElement('span');
  timeVal.id = 'demo-time';
  timeVal.className = 'demo-time-display';
  timeVal.textContent = '06:00';
  panel.appendChild(timeVal);

  const sep2 = document.createElement('div');
  sep2.className = 'demo-sep';
  panel.appendChild(sep2);

  const progressTrack = document.createElement('div');
  progressTrack.className = 'demo-progress-track';
  const progressFill = document.createElement('div');
  progressFill.id = 'demo-progress';
  progressFill.className = 'demo-progress-fill';
  progressTrack.appendChild(progressFill);
  panel.appendChild(progressTrack);

  const sep3 = document.createElement('div');
  sep3.className = 'demo-sep';
  panel.appendChild(sep3);

  const speedLabel = document.createElement('span');
  speedLabel.className = 'demo-label';
  speedLabel.textContent = 'Speed: ';
  panel.appendChild(speedLabel);
  const speedVal = document.createElement('span');
  speedVal.id = 'demo-speed-label';
  speedVal.className = 'demo-value';
  speedVal.textContent = '60\u00d7';
  panel.appendChild(speedVal);
  const speedSlider = document.createElement('input');
  speedSlider.type = 'range';
  speedSlider.className = 'demo-speed-slider';
  speedSlider.min = '10';
  speedSlider.max = '200';
  speedSlider.value = '60';
  speedSlider.step = '10';
  speedSlider.addEventListener('input', () => {
    if (_demoSim) _demoSim.speed = parseInt(speedSlider.value);
    speedVal.textContent = speedSlider.value + '\u00d7';
  });
  panel.appendChild(speedSlider);

  const sep4 = document.createElement('div');
  sep4.className = 'demo-sep';
  panel.appendChild(sep4);
  const countSpan = document.createElement('span');
  countSpan.id = 'demo-count';
  countSpan.className = 'demo-created-count';
  countSpan.textContent = '0 issues';
  panel.appendChild(countSpan);

  document.body.appendChild(panel);

  const feed = document.createElement('div');
  feed.id = 'demo-feed';
  feed.innerHTML = '<div class="demo-feed-item" style="color:rgba(255,255,255,0.4);">Demo simulation ready. Starting shift\u2026</div>';
  document.body.appendChild(feed);

  setInterval(() => {
    const el = document.getElementById('demo-count');
    if (el && _demoSim) el.textContent = _demoSim.createdIssues.length + ' issues';
  }, 1000);
}

async function resetDemo() {
  stopDemoEngine();
  try {
    const issuesSnap = await getDocs(collection(db, 'plants', DEMO_PLANT_ID, 'issues'));
    const issueRefs = issuesSnap.docs.map(d => doc(db, 'plants', DEMO_PLANT_ID, 'issues', d.id));
    for (const ref of issueRefs) {
      const eventsSnap = await getDocs(collection(ref, 'events'));
      const batch = writeBatch(db);
      eventsSnap.docs.forEach(evt => batch.delete(evt.ref));
      batch.delete(ref);
      await batch.commit();
    }
  } catch (e) { console.warn('Demo reset cleanup error:', e); }
  window.location.reload();
}
