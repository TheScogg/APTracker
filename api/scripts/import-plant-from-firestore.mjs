#!/usr/bin/env node

import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import sql from 'mssql';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

const plantId = String(argValue('--plant') || '').trim();
const shouldCommit = hasFlag('--commit');
const isDryRun = !shouldCommit;

if (!plantId) {
  console.error('Missing required argument: --plant <plantId>');
  process.exit(1);
}

function parseServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  const googleCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (googleCredentialsPath && existsSync(googleCredentialsPath)) {
    return JSON.parse(readFileSync(googleCredentialsPath, 'utf8'));
  }
  const fallbackKeyPath = path.resolve(process.cwd(), '../serviceAccountKey.json');
  if (existsSync(fallbackKeyPath)) {
    return JSON.parse(readFileSync(fallbackKeyPath, 'utf8'));
  }
  return null;
}

function initFirebaseAdmin() {
  if (getApps().length) return getApps()[0];
  const serviceAccount = parseServiceAccount();
  if (serviceAccount) {
    return initializeApp({
      credential: cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id
    });
  }
  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
}

initFirebaseAdmin();
const db = getFirestore();

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value?.toDate === 'function') {
    try { return value.toDate(); } catch { return null; }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toBool(value) {
  return value === true || value === 1;
}

function jsonOrNull(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

function stringOrNull(value) {
  if (value == null) return null;
  const out = String(value).trim();
  return out ? out : null;
}

function intOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function intOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function toPressId(machineCode) {
  const normalized = String(machineCode || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized ? `press_${normalized}` : null;
}

function toRowId(rowName) {
  const match = String(rowName || '').match(/(\d+)/);
  if (match) return `row_${String(match[1]).padStart(2, '0')}`;
  const normalized = String(rowName || 'other')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized ? `row_${normalized}` : 'row_other';
}

function findRowNameForMachine(pressesMap, machineCode) {
  for (const [rowName, machines] of Object.entries(pressesMap || {})) {
    if (Array.isArray(machines) && machines.includes(machineCode)) return rowName;
  }
  return 'Other';
}

function currentStatusFromIssue(issue = {}) {
  if (issue.currentStatus?.statusKey) return issue.currentStatus;
  const history = Array.isArray(issue.statusHistory) ? issue.statusHistory : [];
  const last = history[history.length - 1] || {};
  const statusKey = last.status || issue.status || (issue.resolved ? 'resolved' : 'open');
  const subStatusKey = last.subStatus || issue.subStatus || '';
  const enteredDateTime = last.dateTime || issue.statusDateTime || issue.resolveDateTime || issue.dateTime || '';
  return {
    statusKey,
    subStatusKey,
    label: statusKey,
    subLabel: subStatusKey,
    color: '',
    enteredAt: toDate(enteredDateTime),
    enteredDateTime,
    enteredBy: {
      uid: stringOrNull(issue.userId || issue.createdBy?.uid),
      name: stringOrNull(issue.userName || issue.createdBy?.name || issue.editedBy) || 'Unknown'
    },
    notePreview: stringOrNull(last.note || issue.note) || ''
  };
}

function lifecycleFromIssue(issue = {}, currentStatus = {}) {
  const isResolved = currentStatus.statusKey === 'resolved' || issue.lifecycle?.isResolved === true || issue.resolved === true;
  const openedAt = toDate(issue.lifecycle?.openedAt || issue.createdAt || issue.timestamp || issue.dateTime);
  const resolvedAt = isResolved ? toDate(issue.lifecycle?.resolvedAt || issue.resolveDateTime || currentStatus.enteredAt || currentStatus.enteredDateTime) : null;
  return {
    isOpen: !isResolved,
    isResolved,
    openedAt,
    resolvedAt,
    closedAt: resolvedAt,
    reopenedCount: intOrZero(issue.lifecycle?.reopenedCount || issue.reopenedCount || issue.resolveHistory?.length)
  };
}

function notePreviewFromIssue(issue = {}, currentStatus = {}) {
  if (currentStatus.notePreview) return currentStatus.notePreview;
  if (stringOrNull(issue.note)) return stringOrNull(issue.note);
  const history = Array.isArray(issue.statusHistory) ? issue.statusHistory : [];
  return stringOrNull(history[history.length - 1]?.note);
}

function buildIssueRow(issueId, plantIdValue, issue = {}, pressesMap = {}) {
  const machineCode = stringOrNull(issue.machineCode || issue.machine);
  const rowName = machineCode ? findRowNameForMachine(pressesMap, machineCode) : '';
  const currentStatus = currentStatusFromIssue(issue);
  const lifecycle = lifecycleFromIssue(issue, currentStatus);
  const createdAt = toDate(issue.createdAt || issue.timestamp || issue.dateTime || currentStatus.enteredAt);
  const updatedAt = toDate(issue.updatedAt || issue.editedAt || currentStatus.enteredAt || createdAt);

  return {
    issue_id: issueId,
    plant_id: plantIdValue,
    press_id: stringOrNull(issue.pressId) || toPressId(machineCode),
    machine_code: machineCode,
    row_id: stringOrNull(issue.rowId) || toRowId(rowName),
    title: stringOrNull(issue.title),
    note: stringOrNull(issue.note),
    description: stringOrNull(issue.description),
    issue_type: stringOrNull(issue.issueType || issue.category),
    priority: stringOrNull(issue.priority),
    severity: stringOrNull(issue.severity),
    high_priority: toBool(issue.highPriority),
    current_status_key: stringOrNull(currentStatus.statusKey) || 'open',
    current_sub_status_key: stringOrNull(currentStatus.subStatusKey),
    current_status_label: stringOrNull(currentStatus.label || currentStatus.statusKey) || 'open',
    current_sub_status_label: stringOrNull(currentStatus.subLabel || currentStatus.subStatusKey),
    current_status_color: stringOrNull(currentStatus.color),
    current_status_entered_at: toDate(currentStatus.enteredAt || currentStatus.enteredDateTime),
    current_status_entered_by_uid: stringOrNull(currentStatus.enteredBy?.uid),
    current_status_entered_by_name: stringOrNull(currentStatus.enteredBy?.name),
    is_open: lifecycle.isOpen,
    is_resolved: lifecycle.isResolved,
    opened_at: lifecycle.openedAt,
    resolved_at: lifecycle.resolvedAt,
    closed_at: lifecycle.closedAt,
    reopened_count: lifecycle.reopenedCount,
    assigned_team: stringOrNull(issue.assignedTeam),
    assigned_user_uid: stringOrNull(issue.assignedUserUid || issue.assignedUser?.uid),
    assigned_user_name: stringOrNull(issue.assignedUserName || issue.assignedUser?.name),
    serial_required: toBool(issue.serialRequired),
    serial_captured: toBool(issue.serialCaptured),
    serial_value: stringOrNull(issue.serialValue),
    reporting_date_key: stringOrNull(issue.reportingDateKey),
    reporting_week_key: stringOrNull(issue.reportingWeekKey),
    reporting_month_key: stringOrNull(issue.reportingMonthKey),
    reporting_shift_key: stringOrNull(issue.reportingShiftKey || issue.shift),
    workflow_state: stringOrNull(issue.workflowState),
    workflow_state_by_entry_json: jsonOrNull(issue.workflowStateByEntry),
    workflow_state_history_json: jsonOrNull(issue.workflowStateHistory),
    legacy_status_history_json: jsonOrNull(issue.statusHistory),
    latest_note_preview: notePreviewFromIssue(issue, currentStatus),
    tags_json: jsonOrNull(Array.isArray(issue.tags) ? issue.tags : []),
    photo_count: intOrZero(issue.photoCount || issue.photos?.length),
    created_by_uid: stringOrNull(issue.createdBy?.uid || issue.userId),
    created_by_name: stringOrNull(issue.createdBy?.name || issue.userName),
    updated_by_uid: stringOrNull(issue.updatedBy?.uid),
    updated_by_name: stringOrNull(issue.updatedBy?.name || issue.editedBy),
    created_at: createdAt,
    updated_at: updatedAt,
    schema_version: intOrZero(issue.schemaVersion || 1)
  };
}

function buildSyntheticEventRows(issueId, plantIdValue, issue = {}) {
  const history = Array.isArray(issue.statusHistory) ? issue.statusHistory : [];
  if (!history.length) {
    const currentStatus = currentStatusFromIssue(issue);
    return [{
      event_id: `legacy_${issueId}_000`,
      issue_id: issueId,
      plant_id: plantIdValue,
      event_type: 'status_changed',
      event_at: toDate(issue.dateTime || issue.createdAt || issue.timestamp || new Date()),
      actor_uid: stringOrNull(issue.userId || issue.createdBy?.uid),
      actor_name: stringOrNull(issue.userName || issue.createdBy?.name) || 'Unknown',
      payload_json: jsonOrNull({
        fromStatusKey: null,
        fromSubStatusKey: null,
        toStatusKey: currentStatus.statusKey || 'open',
        toSubStatusKey: currentStatus.subStatusKey || '',
        note: ''
      }),
      dedupe_key: null,
      created_at: toDate(issue.createdAt || issue.timestamp || issue.dateTime || new Date())
    }];
  }

  return history.map((entry, index) => ({
    event_id: `legacy_${issueId}_${String(index).padStart(3, '0')}`,
    issue_id: issueId,
    plant_id: plantIdValue,
    event_type: 'status_changed',
    event_at: toDate(entry.dateTime || issue.dateTime || issue.createdAt || issue.timestamp || new Date()),
    actor_uid: stringOrNull(issue.userId || issue.createdBy?.uid),
    actor_name: stringOrNull(entry.by || issue.userName || issue.createdBy?.name) || 'Unknown',
    payload_json: jsonOrNull({
      fromStatusKey: index > 0 ? history[index - 1]?.status || null : null,
      fromSubStatusKey: index > 0 ? history[index - 1]?.subStatus || null : null,
      toStatusKey: entry.status || 'open',
      toSubStatusKey: entry.subStatus || '',
      note: entry.note || ''
    }),
    dedupe_key: null,
    created_at: toDate(entry.dateTime || issue.createdAt || issue.timestamp || new Date())
  }));
}

function buildSyntheticAttachmentRows(issueId, plantIdValue, issue = {}) {
  const photos = Array.isArray(issue.photos) ? issue.photos : [];
  return photos
    .map((photo, index) => {
      const storagePath = stringOrNull(photo.storagePath);
      const downloadUrl = stringOrNull(photo.downloadURL || photo.url);
      if (!storagePath && !downloadUrl) return null;
      return {
        attachment_id: `legacy_${issueId}_${String(index).padStart(3, '0')}`,
        issue_id: issueId,
        plant_id: plantIdValue,
        type: 'photo',
        file_name: stringOrNull(photo.name) || `photo_${index + 1}.jpg`,
        content_type: stringOrNull(photo.contentType),
        storage_bucket: stringOrNull(photo.storageBucket),
        storage_path: storagePath || `legacy/no-storage-path/${issueId}/${index}`,
        thumbnail_path: null,
        download_url: downloadUrl,
        uploaded_by_uid: stringOrNull(issue.userId || issue.createdBy?.uid),
        uploaded_by_name: stringOrNull(issue.userName || issue.createdBy?.name),
        uploaded_at: toDate(photo.uploadedAt || photo.createdAt || issue.updatedAt || issue.createdAt || new Date()),
        size_bytes: intOrNull(photo.sizeBytes),
        schema_version: intOrZero(issue.schemaVersion || 1)
      };
    })
    .filter(Boolean);
}

const TABLES = {
  users: {
    name: 'dbo.users',
    keys: ['uid'],
    columns: [
      ['uid', sql.NVarChar(128)],
      ['email', sql.NVarChar(320)],
      ['display_name', sql.NVarChar(200)],
      ['full_name', sql.NVarChar(200)],
      ['sso_number', sql.NVarChar(80)],
      ['photo_url', sql.NVarChar(1000)],
      ['default_plant_id', sql.NVarChar(80)],
      ['last_plant_id', sql.NVarChar(80)],
      ['plant_ids_json', sql.NVarChar(sql.MAX)],
      ['requested_plant_ids_json', sql.NVarChar(sql.MAX)],
      ['profile_onboarding_json', sql.NVarChar(sql.MAX)],
      ['global_lifetime_xp', sql.Int],
      ['created_at', sql.DateTime2],
      ['updated_at', sql.DateTime2],
      ['schema_version', sql.Int]
    ]
  },
  user_lookup: {
    name: 'dbo.user_lookup',
    keys: ['email_normalized'],
    columns: [
      ['email_normalized', sql.NVarChar(320)],
      ['uid', sql.NVarChar(128)],
      ['display_name', sql.NVarChar(200)],
      ['full_name', sql.NVarChar(200)],
      ['sso_number', sql.NVarChar(80)],
      ['photo_url', sql.NVarChar(1000)],
      ['updated_at', sql.DateTime2]
    ]
  },
  plants: {
    name: 'dbo.plants',
    keys: ['plant_id'],
    columns: [
      ['plant_id', sql.NVarChar(80)],
      ['name', sql.NVarChar(200)],
      ['code', sql.NVarChar(40)],
      ['location', sql.NVarChar(200)],
      ['timezone', sql.NVarChar(100)],
      ['is_active', sql.Bit],
      ['created_by_uid', sql.NVarChar(128)],
      ['updated_by_uid', sql.NVarChar(128)],
      ['created_at', sql.DateTime2],
      ['updated_at', sql.DateTime2],
      ['schema_version', sql.Int]
    ]
  },
  plant_members: {
    name: 'dbo.plant_members',
    keys: ['plant_id', 'uid'],
    columns: [
      ['plant_id', sql.NVarChar(80)],
      ['uid', sql.NVarChar(128)],
      ['role', sql.NVarChar(40)],
      ['is_active', sql.Bit],
      ['display_name', sql.NVarChar(200)],
      ['full_name', sql.NVarChar(200)],
      ['sso_number', sql.NVarChar(80)],
      ['email', sql.NVarChar(320)],
      ['permissions_json', sql.NVarChar(sql.MAX)],
      ['joined_at', sql.DateTime2],
      ['last_seen_at', sql.DateTime2]
    ]
  },
  access_requests: {
    name: 'dbo.access_requests',
    keys: ['plant_id', 'uid'],
    columns: [
      ['plant_id', sql.NVarChar(80)],
      ['uid', sql.NVarChar(128)],
      ['status', sql.NVarChar(40)],
      ['display_name', sql.NVarChar(200)],
      ['full_name', sql.NVarChar(200)],
      ['sso_number', sql.NVarChar(80)],
      ['email', sql.NVarChar(320)],
      ['photo_url', sql.NVarChar(1000)],
      ['requested_at', sql.DateTime2],
      ['updated_at', sql.DateTime2]
    ]
  },
  plant_status_config: {
    name: 'dbo.plant_status_config',
    keys: ['plant_id'],
    columns: [
      ['plant_id', sql.NVarChar(80)],
      ['statuses_json', sql.NVarChar(sql.MAX)],
      ['subcategory_routes_json', sql.NVarChar(sql.MAX)],
      ['updated_by_uid', sql.NVarChar(128)],
      ['updated_at', sql.DateTime2]
    ]
  },
  plant_press_config: {
    name: 'dbo.plant_press_config',
    keys: ['plant_id'],
    columns: [
      ['plant_id', sql.NVarChar(80)],
      ['presses_json', sql.NVarChar(sql.MAX)],
      ['updated_by_uid', sql.NVarChar(128)],
      ['updated_at', sql.DateTime2]
    ]
  },
  presses: {
    name: 'dbo.presses',
    keys: ['plant_id', 'press_id'],
    columns: [
      ['plant_id', sql.NVarChar(80)],
      ['press_id', sql.NVarChar(100)],
      ['machine_code', sql.NVarChar(80)],
      ['display_name', sql.NVarChar(200)],
      ['row_id', sql.NVarChar(80)],
      ['order_in_row', sql.Int],
      ['is_active', sql.Bit],
      ['metadata_json', sql.NVarChar(sql.MAX)],
      ['created_at', sql.DateTime2],
      ['updated_at', sql.DateTime2]
    ]
  },
  gamification_config: {
    name: 'dbo.gamification_config',
    keys: ['plant_id'],
    columns: [
      ['plant_id', sql.NVarChar(80)],
      ['config_json', sql.NVarChar(sql.MAX)],
      ['updated_at', sql.DateTime2]
    ]
  },
  issues: {
    name: 'dbo.issues',
    keys: ['issue_id'],
    columns: [
      ['issue_id', sql.NVarChar(128)],
      ['plant_id', sql.NVarChar(80)],
      ['press_id', sql.NVarChar(100)],
      ['machine_code', sql.NVarChar(80)],
      ['row_id', sql.NVarChar(80)],
      ['title', sql.NVarChar(300)],
      ['note', sql.NVarChar(sql.MAX)],
      ['description', sql.NVarChar(sql.MAX)],
      ['issue_type', sql.NVarChar(80)],
      ['priority', sql.NVarChar(40)],
      ['severity', sql.NVarChar(80)],
      ['high_priority', sql.Bit],
      ['current_status_key', sql.NVarChar(80)],
      ['current_sub_status_key', sql.NVarChar(160)],
      ['current_status_label', sql.NVarChar(160)],
      ['current_sub_status_label', sql.NVarChar(200)],
      ['current_status_color', sql.NVarChar(40)],
      ['current_status_entered_at', sql.DateTime2],
      ['current_status_entered_by_uid', sql.NVarChar(128)],
      ['current_status_entered_by_name', sql.NVarChar(200)],
      ['is_open', sql.Bit],
      ['is_resolved', sql.Bit],
      ['opened_at', sql.DateTime2],
      ['resolved_at', sql.DateTime2],
      ['closed_at', sql.DateTime2],
      ['reopened_count', sql.Int],
      ['assigned_team', sql.NVarChar(80)],
      ['assigned_user_uid', sql.NVarChar(128)],
      ['assigned_user_name', sql.NVarChar(200)],
      ['serial_required', sql.Bit],
      ['serial_captured', sql.Bit],
      ['serial_value', sql.NVarChar(200)],
      ['reporting_date_key', sql.Char(10)],
      ['reporting_week_key', sql.NVarChar(16)],
      ['reporting_month_key', sql.Char(7)],
      ['reporting_shift_key', sql.NVarChar(20)],
      ['workflow_state', sql.NVarChar(80)],
      ['workflow_state_by_entry_json', sql.NVarChar(sql.MAX)],
      ['workflow_state_history_json', sql.NVarChar(sql.MAX)],
      ['legacy_status_history_json', sql.NVarChar(sql.MAX)],
      ['latest_note_preview', sql.NVarChar(500)],
      ['tags_json', sql.NVarChar(sql.MAX)],
      ['photo_count', sql.Int],
      ['created_by_uid', sql.NVarChar(128)],
      ['created_by_name', sql.NVarChar(200)],
      ['updated_by_uid', sql.NVarChar(128)],
      ['updated_by_name', sql.NVarChar(200)],
      ['created_at', sql.DateTime2],
      ['updated_at', sql.DateTime2],
      ['schema_version', sql.Int]
    ]
  },
  issue_events: {
    name: 'dbo.issue_events',
    keys: ['event_id'],
    columns: [
      ['event_id', sql.NVarChar(128)],
      ['issue_id', sql.NVarChar(128)],
      ['plant_id', sql.NVarChar(80)],
      ['event_type', sql.NVarChar(80)],
      ['event_at', sql.DateTime2],
      ['actor_uid', sql.NVarChar(128)],
      ['actor_name', sql.NVarChar(200)],
      ['payload_json', sql.NVarChar(sql.MAX)],
      ['dedupe_key', sql.NVarChar(300)],
      ['created_at', sql.DateTime2]
    ]
  },
  issue_attachments: {
    name: 'dbo.issue_attachments',
    keys: ['attachment_id'],
    columns: [
      ['attachment_id', sql.NVarChar(128)],
      ['issue_id', sql.NVarChar(128)],
      ['plant_id', sql.NVarChar(80)],
      ['type', sql.NVarChar(40)],
      ['file_name', sql.NVarChar(300)],
      ['content_type', sql.NVarChar(100)],
      ['storage_bucket', sql.NVarChar(300)],
      ['storage_path', sql.NVarChar(1000)],
      ['thumbnail_path', sql.NVarChar(1000)],
      ['download_url', sql.NVarChar(2000)],
      ['uploaded_by_uid', sql.NVarChar(128)],
      ['uploaded_by_name', sql.NVarChar(200)],
      ['uploaded_at', sql.DateTime2],
      ['size_bytes', sql.BigInt],
      ['schema_version', sql.Int]
    ]
  }
};

async function upsertRow(pool, tableSpec, row) {
  const request = pool.request();
  tableSpec.columns.forEach(([column, type], index) => {
    request.input(`p${index}`, type, row[column] ?? null);
  });

  const keySet = new Set(tableSpec.keys);
  const keyPredicates = tableSpec.keys
    .map(column => `[${column}] = @p${tableSpec.columns.findIndex(([name]) => name === column)}`)
    .join(' AND ');
  const updateAssignments = tableSpec.columns
    .filter(([column]) => !keySet.has(column))
    .map(([column], index) => `[${column}] = @p${index}`)
    .join(', ');
  const columnList = tableSpec.columns.map(([column]) => `[${column}]`).join(', ');
  const valuesList = tableSpec.columns.map((_, index) => `@p${index}`).join(', ');

  const query = `
    IF EXISTS (SELECT 1 FROM ${tableSpec.name} WHERE ${keyPredicates})
      UPDATE ${tableSpec.name}
      SET ${updateAssignments}
      WHERE ${keyPredicates};
    ELSE
      INSERT INTO ${tableSpec.name} (${columnList})
      VALUES (${valuesList});
  `;

  await request.query(query);
}

async function upsertRows(pool, tableSpec, rows) {
  for (const row of rows) {
    await upsertRow(pool, tableSpec, row);
  }
}

async function loadPlantSnapshot(targetPlantId) {
  const plantRef = db.collection('plants').doc(targetPlantId);
  const [
    plantSnap,
    membersSnap,
    accessRequestsSnap,
    statusesSnap,
    pressesConfigSnap,
    gameConfigSnap,
    issuesSnap
  ] = await Promise.all([
    plantRef.get(),
    plantRef.collection('members').get(),
    plantRef.collection('accessRequests').get(),
    plantRef.collection('config').doc('statuses').get(),
    plantRef.collection('config').doc('presses').get(),
    plantRef.collection('gamificationConfig').doc('main').get(),
    plantRef.collection('issues').get()
  ]);

  if (!plantSnap.exists) {
    throw new Error(`Plant ${targetPlantId} was not found in Firestore.`);
  }

  const issues = await Promise.all(issuesSnap.docs.map(async issueSnap => {
    const [eventsSnap, attachmentsSnap] = await Promise.all([
      issueSnap.ref.collection('events').get(),
      issueSnap.ref.collection('attachments').get()
    ]);
    return {
      id: issueSnap.id,
      data: issueSnap.data() || {},
      events: eventsSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} })),
      attachments: attachmentsSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} }))
    };
  }));

  return {
    plant: { id: plantSnap.id, data: plantSnap.data() || {} },
    members: membersSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} })),
    accessRequests: accessRequestsSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} })),
    statusConfig: statusesSnap.exists ? (statusesSnap.data() || {}) : null,
    pressConfig: pressesConfigSnap.exists ? (pressesConfigSnap.data() || {}) : null,
    gamificationConfig: gameConfigSnap.exists ? (gameConfigSnap.data() || {}) : null,
    issues
  };
}

async function loadUsersForPlant(snapshot) {
  const userIds = new Set();

  snapshot.members.forEach(member => userIds.add(member.id));
  snapshot.accessRequests.forEach(req => userIds.add(req.id));
  snapshot.issues.forEach(issueRecord => {
    const issue = issueRecord.data || {};
    [
      issue.userId,
      issue.createdBy?.uid,
      issue.updatedBy?.uid,
      issue.assignedUser?.uid,
      issue.assignedUserUid,
      issue.currentStatus?.enteredBy?.uid
    ].forEach(uid => uid && userIds.add(uid));
    issueRecord.events.forEach(eventRecord => {
      const event = eventRecord.data || {};
      if (event.actor?.uid) userIds.add(event.actor.uid);
    });
    issueRecord.attachments.forEach(attachmentRecord => {
      const attachment = attachmentRecord.data || {};
      if (attachment.uploadedBy?.uid) userIds.add(attachment.uploadedBy.uid);
    });
  });

  const users = [];
  await Promise.all([...userIds].map(async uid => {
    const snap = await db.collection('users').doc(uid).get();
    users.push({ id: uid, data: snap.exists ? (snap.data() || {}) : {} });
  }));
  return users;
}

function buildRows(snapshot, users) {
  const pressesMap = snapshot.pressConfig?.presses || {};

  const userRows = users.map(user => ({
    uid: user.id,
    email: stringOrNull(user.data.email),
    display_name: stringOrNull(user.data.displayName),
    full_name: stringOrNull(user.data.fullName),
    sso_number: stringOrNull(user.data.ssoNumber),
    photo_url: stringOrNull(user.data.photoURL),
    default_plant_id: stringOrNull(user.data.defaultPlantId),
    last_plant_id: stringOrNull(user.data.lastPlant || user.data.lastPlantId),
    plant_ids_json: jsonOrNull(user.data.plantIds || []),
    requested_plant_ids_json: jsonOrNull(user.data.requestedPlantIds || []),
    profile_onboarding_json: jsonOrNull(user.data.profileOnboarding || null),
    global_lifetime_xp: intOrZero(user.data.globalLifetimeXp),
    created_at: toDate(user.data.createdAt),
    updated_at: toDate(user.data.updatedAt || user.data.lastSeen),
    schema_version: intOrZero(user.data.schemaVersion || 1)
  }));

  const userLookupRows = userRows
    .filter(user => user.email)
    .map(user => ({
      email_normalized: user.email.toLowerCase(),
      uid: user.uid,
      display_name: user.display_name,
      full_name: user.full_name,
      sso_number: user.sso_number,
      photo_url: user.photo_url,
      updated_at: user.updated_at || new Date()
    }));

  const plantData = snapshot.plant.data || {};
  const plantRows = [{
    plant_id: snapshot.plant.id,
    name: stringOrNull(plantData.name) || snapshot.plant.id,
    code: stringOrNull(plantData.code),
    location: stringOrNull(plantData.location),
    timezone: stringOrNull(plantData.timezone),
    is_active: plantData.isActive !== false,
    created_by_uid: stringOrNull(plantData.createdBy?.uid || plantData.createdByUid),
    updated_by_uid: stringOrNull(plantData.updatedBy?.uid || plantData.updatedByUid),
    created_at: toDate(plantData.createdAt),
    updated_at: toDate(plantData.updatedAt),
    schema_version: intOrZero(plantData.schemaVersion || 1)
  }];

  const memberRows = snapshot.members.map(member => {
    const data = member.data || {};
    return {
      plant_id: snapshot.plant.id,
      uid: member.id,
      role: stringOrNull(data.role) || 'editor',
      is_active: data.isActive !== false,
      display_name: stringOrNull(data.displayName),
      full_name: stringOrNull(data.fullName),
      sso_number: stringOrNull(data.ssoNumber),
      email: stringOrNull(data.email),
      permissions_json: jsonOrNull(data.permissions || {}),
      joined_at: toDate(data.addedAt || data.joinedAt || data.createdAt),
      last_seen_at: toDate(data.lastSeenAt || data.lastSeen)
    };
  });

  const accessRequestRows = snapshot.accessRequests.map(req => {
    const data = req.data || {};
    return {
      plant_id: snapshot.plant.id,
      uid: req.id,
      status: stringOrNull(data.status) || 'pending',
      display_name: stringOrNull(data.displayName),
      full_name: stringOrNull(data.fullName),
      sso_number: stringOrNull(data.ssoNumber),
      email: stringOrNull(data.email),
      photo_url: stringOrNull(data.photoURL),
      requested_at: toDate(data.requestedAt || data.createdAt),
      updated_at: toDate(data.updatedAt || data.reviewedAt)
    };
  });

  const statusConfigRows = snapshot.statusConfig ? [{
    plant_id: snapshot.plant.id,
    statuses_json: jsonOrNull(snapshot.statusConfig.statuses || {}),
    subcategory_routes_json: jsonOrNull(snapshot.statusConfig.subcategoryRoutes || null),
    updated_by_uid: stringOrNull(snapshot.statusConfig.updatedBy?.uid || snapshot.statusConfig.updatedByUid),
    updated_at: toDate(snapshot.statusConfig.updatedAt)
  }] : [];

  const pressConfigRows = snapshot.pressConfig ? [{
    plant_id: snapshot.plant.id,
    presses_json: jsonOrNull(snapshot.pressConfig.presses || {}),
    updated_by_uid: stringOrNull(snapshot.pressConfig.updatedBy?.uid || snapshot.pressConfig.updatedByUid),
    updated_at: toDate(snapshot.pressConfig.updatedAt)
  }] : [];

  const pressRows = [];
  Object.entries(pressesMap).forEach(([rowName, machines]) => {
    (Array.isArray(machines) ? machines : []).forEach((machineCode, index) => {
      const pressId = toPressId(machineCode);
      if (!pressId) return;
      pressRows.push({
        plant_id: snapshot.plant.id,
        press_id: pressId,
        machine_code: String(machineCode),
        display_name: String(machineCode),
        row_id: toRowId(rowName),
        order_in_row: index,
        is_active: true,
        metadata_json: jsonOrNull({ rowName }),
        created_at: toDate(snapshot.plant.data?.createdAt),
        updated_at: toDate(snapshot.pressConfig?.updatedAt || snapshot.plant.data?.updatedAt)
      });
    });
  });

  const gameConfigRows = snapshot.gamificationConfig ? [{
    plant_id: snapshot.plant.id,
    config_json: jsonOrNull(snapshot.gamificationConfig),
    updated_at: toDate(snapshot.gamificationConfig.updatedAt)
  }] : [];

  const issueRows = [];
  const eventRows = [];
  const attachmentRows = [];

  snapshot.issues.forEach(issueRecord => {
    issueRows.push(buildIssueRow(issueRecord.id, snapshot.plant.id, issueRecord.data, pressesMap));

    const nativeEvents = issueRecord.events.map(eventRecord => {
      const event = eventRecord.data || {};
      return {
        event_id: eventRecord.id,
        issue_id: issueRecord.id,
        plant_id: snapshot.plant.id,
        event_type: stringOrNull(event.type || event.eventType) || 'status_changed',
        event_at: toDate(event.eventAt || event.createdAt),
        actor_uid: stringOrNull(event.actor?.uid),
        actor_name: stringOrNull(event.actor?.name),
        payload_json: jsonOrNull(event.payload || null),
        dedupe_key: stringOrNull(event.dedupeKey),
        created_at: toDate(event.createdAt || event.eventAt)
      };
    });
    eventRows.push(...(nativeEvents.length ? nativeEvents : buildSyntheticEventRows(issueRecord.id, snapshot.plant.id, issueRecord.data)));

    const nativeAttachments = issueRecord.attachments.map(attachmentRecord => {
      const attachment = attachmentRecord.data || {};
      return {
        attachment_id: attachmentRecord.id,
        issue_id: issueRecord.id,
        plant_id: snapshot.plant.id,
        type: stringOrNull(attachment.type) || 'photo',
        file_name: stringOrNull(attachment.fileName),
        content_type: stringOrNull(attachment.contentType),
        storage_bucket: stringOrNull(attachment.storageBucket),
        storage_path: stringOrNull(attachment.storagePath) || `legacy/missing-storage-path/${issueRecord.id}/${attachmentRecord.id}`,
        thumbnail_path: stringOrNull(attachment.thumbnailPath),
        download_url: stringOrNull(attachment.downloadURL || attachment.url),
        uploaded_by_uid: stringOrNull(attachment.uploadedBy?.uid),
        uploaded_by_name: stringOrNull(attachment.uploadedBy?.name),
        uploaded_at: toDate(attachment.uploadedAt || attachment.createdAt),
        size_bytes: intOrNull(attachment.sizeBytes),
        schema_version: intOrZero(attachment.schemaVersion || 1)
      };
    });
    attachmentRows.push(...(nativeAttachments.length ? nativeAttachments : buildSyntheticAttachmentRows(issueRecord.id, snapshot.plant.id, issueRecord.data)));
  });

  return {
    users: userRows,
    user_lookup: userLookupRows,
    plants: plantRows,
    plant_members: memberRows,
    access_requests: accessRequestRows,
    plant_status_config: statusConfigRows,
    plant_press_config: pressConfigRows,
    presses: pressRows,
    gamification_config: gameConfigRows,
    issues: issueRows,
    issue_events: eventRows,
    issue_attachments: attachmentRows
  };
}

async function main() {
  const connectionString = process.env.SQL_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('SQL_CONNECTION_STRING must be set.');
  }

  const snapshot = await loadPlantSnapshot(plantId);
  const users = await loadUsersForPlant(snapshot);
  const rowsByTable = buildRows(snapshot, users);

  const summary = Object.fromEntries(
    Object.entries(rowsByTable).map(([tableName, rows]) => [tableName, rows.length])
  );

  if (isDryRun) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      plantId,
      summary
    }, null, 2));
    return;
  }

  const pool = await sql.connect(connectionString);
  try {
    const order = [
      'users',
      'user_lookup',
      'plants',
      'plant_members',
      'access_requests',
      'plant_status_config',
      'plant_press_config',
      'presses',
      'gamification_config',
      'issues',
      'issue_events',
      'issue_attachments'
    ];

    for (const tableName of order) {
      await upsertRows(pool, TABLES[tableName], rowsByTable[tableName]);
    }

    console.log(JSON.stringify({
      mode: 'commit',
      plantId,
      summary
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
