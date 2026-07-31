#!/usr/bin/env node

import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import {
  buildD1UpsertStatement,
  executeD1File,
  hasFlag,
  resolveD1DatabaseName,
  resolveD1ExecutionMode
} from './d1-cli.mjs';
import { normalizeScheduleShift } from '../../js/schedule-shifts.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const plantId = String((() => {
  const idx = process.argv.indexOf('--plant');
  return idx >= 0 ? process.argv[idx + 1] : '';
})() || '').trim();
const shouldCommit = hasFlag('--commit');
const isDryRun = !shouldCommit;
const databaseName = resolveD1DatabaseName();
const d1Mode = resolveD1ExecutionMode();

if (!plantId) {
  console.error('Missing required argument: --plant <plantId>');
  process.exit(1);
}

if (shouldCommit && !databaseName) {
  console.error('Missing D1 database name. Pass --database <name> or set APTRACKER_D1_DATABASE_NAME.');
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
  const fallbackKeyPath = path.join(repoRoot, 'serviceAccountKey.json');
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

function dateOrNow(value) {
  return toDate(value) || new Date();
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
    workflow_state_by_entry_history_json: jsonOrNull(issue.workflowStateByEntryHistory),
    workflow_state_by_status_json: jsonOrNull(issue.workflowStateByStatus),
    workflow_state_by_status_history_json: jsonOrNull(issue.workflowStateByStatusHistory),
    workflow_state_history_json: jsonOrNull(issue.workflowStateHistory),
    legacy_status_history_json: jsonOrNull(issue.statusHistory),
    latest_note_preview: notePreviewFromIssue(issue, currentStatus),
    tags_json: jsonOrNull(Array.isArray(issue.tags) ? issue.tags : []),
    photo_count: intOrZero(issue.photoCount || issue.photos?.length),
    created_by_uid: stringOrNull(issue.createdBy?.uid || issue.userId),
    created_by_name: stringOrNull(issue.createdBy?.name || issue.userName),
    updated_by_uid: stringOrNull(issue.updatedBy?.uid),
    updated_by_name: stringOrNull(issue.updatedBy?.name || issue.editedBy),
    created_at: createdAt || new Date(),
    updated_at: updatedAt || createdAt || new Date(),
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
      event_at: dateOrNow(issue.dateTime || issue.createdAt || issue.timestamp),
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
      created_at: dateOrNow(issue.createdAt || issue.timestamp || issue.dateTime)
    }];
  }

  return history.map((entry, index) => ({
    event_id: `legacy_${issueId}_${String(index).padStart(3, '0')}`,
    issue_id: issueId,
    plant_id: plantIdValue,
    event_type: 'status_changed',
    event_at: dateOrNow(entry.dateTime || issue.dateTime || issue.createdAt || issue.timestamp),
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
    created_at: dateOrNow(entry.dateTime || issue.createdAt || issue.timestamp)
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
        uploaded_at: dateOrNow(photo.uploadedAt || photo.createdAt || issue.updatedAt || issue.createdAt),
        size_bytes: intOrNull(photo.sizeBytes),
        schema_version: intOrZero(issue.schemaVersion || 1)
      };
    })
    .filter(Boolean);
}

function noteAttachmentRowId(noteId, attachmentId) {
  return `${noteId}:${attachmentId}`;
}

function wikiPageRowId(scope, pressId, pageId) {
  return `${scope}:${pressId || 'shared'}:${pageId}`;
}

function wikiRevisionRowId(scope, pressId, pageId, revisionId) {
  return `${wikiPageRowId(scope, pressId, pageId)}:${revisionId}`;
}

function wikiAttachmentRowId(scope, pressId, pageId, attachmentId) {
  return `${wikiPageRowId(scope, pressId, pageId)}:${attachmentId}`;
}

function leaderboardRowId(plantIdValue, boardId) {
  return `${plantIdValue}:${boardId}`;
}

function missionRowId(plantIdValue, missionId) {
  return `${plantIdValue}:${missionId}`;
}

function missionProgressRowId(plantIdValue, missionId, subjectId) {
  return `${plantIdValue}:${missionId}:${subjectId}`;
}

function dailyScheduleRowId(plantIdValue, scheduleDate, shift) {
  return `${plantIdValue}:${scheduleDate}:shift${shift}`;
}

function dailyScheduleItemRowId(plantIdValue, scheduleDate, shift, sectionKey, rowId) {
  return `${dailyScheduleRowId(plantIdValue, scheduleDate, shift)}:${sectionKey}:${rowId}`;
}

function dateMs(value) {
  const dt = toDate(value);
  return dt ? dt.getTime() : 0;
}

function dedupeRowsByKey(rows, keyFn, sortValueFn = () => 0) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || sortValueFn(row) >= sortValueFn(prev)) {
      map.set(key, row);
    }
  }
  return [...map.values()];
}

const TABLES = {
  users: {
    name: 'users',
    keys: ['uid'],
    columns: [
      ['uid'], ['email'], ['display_name'], ['full_name'], ['sso_number'], ['photo_url'],
      ['default_plant_id'], ['last_plant_id'], ['plant_ids_json'], ['requested_plant_ids_json'],
      ['profile_onboarding_json'], ['global_lifetime_xp'], ['created_at'], ['updated_at'], ['schema_version']
    ]
  },
  user_lookup: {
    name: 'user_lookup',
    keys: ['email_normalized'],
    columns: [['email_normalized'], ['uid'], ['display_name'], ['full_name'], ['sso_number'], ['photo_url'], ['updated_at']]
  },
  plants: {
    name: 'plants',
    keys: ['plant_id'],
    columns: [['plant_id'], ['name'], ['code'], ['location'], ['timezone'], ['is_active'], ['created_by_uid'], ['updated_by_uid'], ['created_at'], ['updated_at'], ['schema_version']]
  },
  plant_members: {
    name: 'plant_members',
    keys: ['plant_id', 'uid'],
    columns: [['plant_id'], ['uid'], ['role'], ['is_active'], ['display_name'], ['full_name'], ['sso_number'], ['email'], ['permissions_json'], ['alert_category_subscriptions_json'], ['job_role_keys_json'], ['job_feeds_json'], ['joined_at'], ['last_seen_at']]
  },
  access_requests: {
    name: 'access_requests',
    keys: ['plant_id', 'uid'],
    columns: [['plant_id'], ['uid'], ['status'], ['display_name'], ['full_name'], ['sso_number'], ['email'], ['photo_url'], ['requested_at'], ['updated_at']]
  },
  plant_status_config: {
    name: 'plant_status_config',
    keys: ['plant_id'],
    columns: [['plant_id'], ['statuses_json'], ['subcategory_routes_json'], ['updated_by_uid'], ['updated_at']]
  },
  plant_press_config: {
    name: 'plant_press_config',
    keys: ['plant_id'],
    columns: [['plant_id'], ['presses_json'], ['updated_by_uid'], ['updated_at']]
  },
  role_alert_routing_config: {
    name: 'role_alert_routing_config',
    keys: ['plant_id'],
    columns: [['plant_id'], ['rules_json'], ['updated_by_uid'], ['updated_at']]
  },
  presses: {
    name: 'presses',
    keys: ['plant_id', 'press_id'],
    columns: [['plant_id'], ['press_id'], ['machine_code'], ['display_name'], ['row_id'], ['order_in_row'], ['is_active'], ['metadata_json'], ['created_at'], ['updated_at']]
  },
  gamification_config: {
    name: 'gamification_config',
    keys: ['plant_id'],
    columns: [['plant_id'], ['config_json'], ['updated_at']]
  },
  plant_store_config: {
    name: 'plant_store_config',
    keys: ['plant_id'],
    columns: [['plant_id'], ['config_json'], ['updated_at']]
  },
  issues: {
    name: 'issues',
    keys: ['issue_id'],
    columns: [
      ['issue_id'], ['plant_id'], ['press_id'], ['machine_code'], ['row_id'], ['title'], ['note'],
      ['description'], ['issue_type'], ['priority'], ['severity'], ['high_priority'],
      ['current_status_key'], ['current_sub_status_key'], ['current_status_label'],
      ['current_sub_status_label'], ['current_status_color'], ['current_status_entered_at'],
      ['current_status_entered_by_uid'], ['current_status_entered_by_name'], ['is_open'],
      ['is_resolved'], ['opened_at'], ['resolved_at'], ['closed_at'], ['reopened_count'],
      ['assigned_team'], ['assigned_user_uid'], ['assigned_user_name'], ['serial_required'],
      ['serial_captured'], ['serial_value'], ['reporting_date_key'], ['reporting_week_key'],
      ['reporting_month_key'], ['reporting_shift_key'], ['workflow_state'],
      ['workflow_state_by_entry_json'], ['workflow_state_by_entry_history_json'],
      ['workflow_state_by_status_json'], ['workflow_state_by_status_history_json'],
      ['workflow_state_history_json'], ['legacy_status_history_json'],
      ['latest_note_preview'], ['tags_json'], ['photo_count'], ['created_by_uid'], ['created_by_name'],
      ['updated_by_uid'], ['updated_by_name'], ['created_at'], ['updated_at'], ['schema_version']
    ]
  },
  issue_events: {
    name: 'issue_events',
    keys: ['event_id'],
    columns: [['event_id'], ['issue_id'], ['plant_id'], ['event_type'], ['event_at'], ['actor_uid'], ['actor_name'], ['payload_json'], ['dedupe_key'], ['created_at']]
  },
  issue_attachments: {
    name: 'issue_attachments',
    keys: ['attachment_id'],
    columns: [['attachment_id'], ['issue_id'], ['plant_id'], ['type'], ['file_name'], ['content_type'], ['storage_bucket'], ['storage_path'], ['thumbnail_path'], ['download_url'], ['uploaded_by_uid'], ['uploaded_by_name'], ['taken_at'], ['uploaded_at'], ['size_bytes'], ['schema_version']]
  },
  press_notes: {
    name: 'press_notes',
    keys: ['press_note_id'],
    columns: [['press_note_id'], ['plant_id'], ['press_id'], ['machine_code'], ['text'], ['photo_count'], ['photos_json'], ['created_by_json'], ['created_at'], ['schema_version']]
  },
  notes: {
    name: 'notes',
    keys: ['note_id'],
    columns: [['note_id'], ['plant_id'], ['title'], ['body_html'], ['body_text'], ['checklist_items_json'], ['tags_json'], ['press_id'], ['machine_code'], ['issue_id'], ['is_pinned'], ['is_archived'], ['photo_count'], ['search_text'], ['created_by_uid'], ['updated_by_uid'], ['created_at'], ['updated_at']]
  },
  note_attachments: {
    name: 'note_attachments',
    keys: ['note_attachment_id'],
    columns: [['note_attachment_id'], ['note_id'], ['plant_id'], ['attachment_id'], ['storage_path'], ['storage_bucket'], ['file_name'], ['content_type'], ['size_bytes'], ['url'], ['uploaded_by_json'], ['uploaded_at'], ['schema_version']]
  },
  todos: {
    name: 'todos',
    keys: ['todo_id'],
    columns: [['todo_id'], ['scope'], ['plant_id'], ['owner_uid'], ['title'], ['notes'], ['list_name'], ['due_date'], ['priority'], ['is_completed'], ['completed_at'], ['press_id'], ['machine_code'], ['issue_id'], ['search_text'], ['created_by_json'], ['updated_by_json'], ['created_at'], ['updated_at']]
  },
  conversations: {
    name: 'conversations',
    keys: ['conversation_id'],
    columns: [['conversation_id'], ['plant_id'], ['type'], ['title'], ['member_ids_json'], ['last_message_text'], ['last_message_at'], ['created_by_uid'], ['created_at'], ['press_id'], ['member_count'], ['created_by_name'], ['last_message_json'], ['is_archived']]
  },
  conversation_members: {
    name: 'conversation_members',
    keys: ['conversation_id', 'uid'],
    columns: [['conversation_id'], ['uid'], ['last_read_at'], ['muted'], ['role'], ['joined_at'], ['last_read_message_id'], ['unread_count']]
  },
  conversation_messages: {
    name: 'conversation_messages',
    keys: ['message_id'],
    columns: [['message_id'], ['conversation_id'], ['plant_id'], ['sender_uid'], ['sender_name'], ['body'], ['created_at'], ['type'], ['mentions_json'], ['attachments_json'], ['edited_at'], ['deleted_at']]
  },
  user_game_stats: {
    name: 'user_game_stats',
    keys: ['plant_id', 'uid'],
    columns: [['plant_id'], ['uid'], ['totals_json'], ['updated_at'], ['user_id'], ['display_name'], ['streaks_json'], ['last_event_at'], ['schema_version']]
  },
  game_events: {
    name: 'game_events',
    keys: ['game_event_id'],
    columns: [['game_event_id'], ['plant_id'], ['uid'], ['type'], ['xp_delta'], ['dedupe_key'], ['payload_json'], ['created_at']]
  },
  user_badges: {
    name: 'user_badges',
    keys: ['plant_id', 'uid'],
    columns: [['plant_id'], ['uid'], ['earned_badges_json'], ['updated_at']]
  },
  game_leaderboards: {
    name: 'game_leaderboards',
    keys: ['leaderboard_row_id'],
    columns: [['leaderboard_row_id'], ['plant_id'], ['board_id'], ['entries_json'], ['entries_by_uid_json'], ['updated_at'], ['schema_version']]
  },
  game_missions: {
    name: 'game_missions',
    keys: ['mission_row_id'],
    columns: [['mission_row_id'], ['plant_id'], ['mission_id'], ['name'], ['description'], ['objective_json'], ['rewards_json'], ['is_active'], ['starts_at'], ['ends_at'], ['updated_at'], ['raw_json']]
  },
  game_mission_progress: {
    name: 'game_mission_progress',
    keys: ['mission_progress_row_id'],
    columns: [['mission_progress_row_id'], ['plant_id'], ['mission_id'], ['subject_id'], ['subject_type'], ['current_value'], ['target_value'], ['percent'], ['completed'], ['updated_at'], ['raw_json']]
  },
  role_feed_alerts: {
    name: 'role_feed_alerts',
    keys: ['alert_id'],
    columns: [['alert_id'], ['plant_id'], ['issue_id'], ['status_key'], ['subcategory_key'], ['title'], ['body'], ['is_resolved'], ['created_at'], ['updated_at'], ['category_key'], ['category_keys_json'], ['workflow_id'], ['feed_key'], ['feed_label'], ['recipient_user_ids_json'], ['required_job_role_keys_json'], ['created_by_json'], ['raw_json']]
  },
  wiki_pages: {
    name: 'wiki_pages',
    keys: ['wiki_page_row_id'],
    columns: [['wiki_page_row_id'], ['plant_id'], ['scope'], ['press_id'], ['page_id'], ['title'], ['slug'], ['summary'], ['tags_json'], ['parent_page_id'], ['sort_order'], ['is_pinned'], ['is_locked'], ['visibility'], ['current_revision_id'], ['photo_count'], ['search_text'], ['created_by_json'], ['updated_by_json'], ['created_at'], ['updated_at'], ['last_activity_at'], ['last_verified_at'], ['last_verified_by'], ['schema_version']]
  },
  wiki_revisions: {
    name: 'wiki_revisions',
    keys: ['wiki_revision_row_id'],
    columns: [['wiki_revision_row_id'], ['wiki_page_row_id'], ['plant_id'], ['scope'], ['press_id'], ['page_id'], ['revision_id'], ['body'], ['change_note'], ['prev_revision_id'], ['edited_by_json'], ['edited_at']]
  },
  wiki_attachments: {
    name: 'wiki_attachments',
    keys: ['wiki_attachment_row_id'],
    columns: [['wiki_attachment_row_id'], ['wiki_page_row_id'], ['plant_id'], ['scope'], ['press_id'], ['page_id'], ['attachment_id'], ['storage_path'], ['content_type'], ['caption'], ['linked_revision_id'], ['uploaded_by_json'], ['uploaded_at'], ['width'], ['height'], ['url'], ['schema_version']]
  },
  daily_schedules: {
    name: 'daily_schedules',
    keys: ['daily_schedule_row_id'],
    columns: [['daily_schedule_row_id'], ['plant_id'], ['schedule_date'], ['shift'], ['line_speed'], ['total_planned_pcs'], ['source_file_name'], ['source_file_type'], ['status'], ['notes'], ['page1_count'], ['page2_count'], ['north_bay_changes_count'], ['south_bay_changes_count'], ['raw_json'], ['created_at'], ['updated_at']]
  },
  parts: {
    name: 'parts',
    keys: ['part_number'],
    columns: [['part_number'], ['description'], ['created_at'], ['updated_at']]
  },
  daily_schedule_rows: {
    name: 'daily_schedule_rows',
    keys: ['daily_schedule_item_row_id'],
    columns: [['daily_schedule_item_row_id'], ['daily_schedule_row_id'], ['plant_id'], ['schedule_date'], ['section_key'], ['row_id'], ['press'], ['part_number'], ['cavity'], ['doh'], ['labels_per_shift'], ['mc'], ['notes'], ['shift'], ['part_storage_location_json'], ['raw_json'], ['created_at'], ['updated_at']]
  }
};

async function loadPlantSnapshot(targetPlantId) {
  const plantRef = db.collection('plants').doc(targetPlantId);
  const [
    plantSnap,
    membersSnap,
    accessRequestsSnap,
    statusesSnap,
    roleAlertRoutingSnap,
    storeConfigSnap,
    pressesConfigSnap,
    gameConfigSnap,
    issuesSnap,
    notesSnap,
    plantTodosSnap,
    conversationsSnap,
    leaderboardsSnap,
    missionsSnap,
    userGameStatsSnap,
    userBadgesSnap,
    gameEventsSnap,
    sharedWikiPagesSnap,
    pressDocsSnap,
    dailySchedulesSnap,
    roleFeedAlertsSnap,
    pressNotesSnap
  ] = await Promise.all([
    plantRef.get(),
    plantRef.collection('members').get(),
    plantRef.collection('accessRequests').get(),
    plantRef.collection('config').doc('statuses').get(),
    plantRef.collection('config').doc('roleAlertRouting').get(),
    plantRef.collection('config').doc('store').get(),
    plantRef.collection('config').doc('presses').get(),
    plantRef.collection('gamificationConfig').doc('main').get(),
    plantRef.collection('issues').get(),
    plantRef.collection('notes').get(),
    plantRef.collection('todos').get(),
    plantRef.collection('conversations').get(),
    plantRef.collection('leaderboards').get(),
    plantRef.collection('missions').get(),
    plantRef.collection('userGameStats').get(),
    plantRef.collection('userBadges').get(),
    plantRef.collection('gameEvents').get(),
    plantRef.collection('wikiPages').get(),
    plantRef.collection('presses').get(),
    plantRef.collection('dailySchedules').get(),
    plantRef.collection('roleFeedAlerts').get(),
    plantRef.collection('pressNotes').get()
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

  const notes = await Promise.all(notesSnap.docs.map(async noteSnap => {
    const attachmentsSnap = await noteSnap.ref.collection('attachments').get();
    return {
      id: noteSnap.id,
      data: noteSnap.data() || {},
      attachments: attachmentsSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} }))
    };
  }));

  const conversations = await Promise.all(conversationsSnap.docs.map(async conversationSnap => {
    const [membersSubSnap, messagesSubSnap] = await Promise.all([
      conversationSnap.ref.collection('members').get(),
      conversationSnap.ref.collection('messages').get()
    ]);
    return {
      id: conversationSnap.id,
      data: conversationSnap.data() || {},
      members: membersSubSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} })),
      messages: messagesSubSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} }))
    };
  }));

  const missions = await Promise.all(missionsSnap.docs.map(async missionSnap => {
    const progressSnap = await missionSnap.ref.collection('progress').get();
    return {
      id: missionSnap.id,
      data: missionSnap.data() || {},
      progress: progressSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} }))
    };
  }));

  const sharedWikiPages = await Promise.all(sharedWikiPagesSnap.docs.map(async pageSnap => {
    const [revisionsSnap, attachmentsSnap] = await Promise.all([
      pageSnap.ref.collection('revisions').get(),
      pageSnap.ref.collection('attachments').get()
    ]);
    return {
      scope: 'shared',
      pressId: null,
      id: pageSnap.id,
      data: pageSnap.data() || {},
      revisions: revisionsSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} })),
      attachments: attachmentsSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} }))
    };
  }));

  const pressWikiPages = [];
  for (const pressSnap of pressDocsSnap.docs) {
    const wikiPagesSnap = await pressSnap.ref.collection('wikiPages').get();
    const pages = await Promise.all(wikiPagesSnap.docs.map(async pageSnap => {
      const [revisionsSnap, attachmentsSnap] = await Promise.all([
        pageSnap.ref.collection('revisions').get(),
        pageSnap.ref.collection('attachments').get()
      ]);
      return {
        scope: 'press',
        pressId: pressSnap.id,
        id: pageSnap.id,
        data: pageSnap.data() || {},
        revisions: revisionsSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} })),
        attachments: attachmentsSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} }))
      };
    }));
    pressWikiPages.push(...pages);
  }

  const dailySchedules = await Promise.all(dailySchedulesSnap.docs.map(async scheduleSnap => {
    const sectionNames = ['page1', 'page2', 'northBayChanges', 'southBayChanges'];
    const sectionEntries = await Promise.all(sectionNames.map(async sectionName => {
      const rowsSnap = await scheduleSnap.ref.collection(sectionName).get();
      return [
        sectionName,
        rowsSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} }))
      ];
    }));
    return {
      id: scheduleSnap.id,
      data: scheduleSnap.data() || {},
      sections: Object.fromEntries(sectionEntries)
    };
  }));

  return {
    plant: { id: plantSnap.id, data: plantSnap.data() || {} },
    members: membersSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} })),
    accessRequests: accessRequestsSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} })),
    statusConfig: statusesSnap.exists ? (statusesSnap.data() || {}) : null,
    roleAlertRoutingConfig: roleAlertRoutingSnap.exists ? (roleAlertRoutingSnap.data() || {}) : null,
    storeConfig: storeConfigSnap.exists ? (storeConfigSnap.data() || {}) : null,
    pressConfig: pressesConfigSnap.exists ? (pressesConfigSnap.data() || {}) : null,
    gamificationConfig: gameConfigSnap.exists ? (gameConfigSnap.data() || {}) : null,
    issues,
    notes,
    plantTodos: plantTodosSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} })),
    conversations,
    leaderboards: leaderboardsSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} })),
    missions,
    userGameStats: userGameStatsSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} })),
    userBadges: userBadgesSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} })),
    gameEvents: gameEventsSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} })),
    sharedWikiPages,
    pressWikiPages,
    dailySchedules,
    roleFeedAlerts: roleFeedAlertsSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} })),
    pressNotes: pressNotesSnap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} }))
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
  snapshot.notes.forEach(noteRecord => {
    const note = noteRecord.data || {};
    [note.createdBy?.uid, note.updatedBy?.uid].forEach(uid => uid && userIds.add(uid));
    noteRecord.attachments.forEach(attachmentRecord => {
      const attachment = attachmentRecord.data || {};
      if (attachment.uploadedBy?.uid) userIds.add(attachment.uploadedBy.uid);
    });
  });
  snapshot.plantTodos.forEach(todoRecord => {
    const todo = todoRecord.data || {};
    [todo.ownerUid, todo.createdBy?.uid, todo.updatedBy?.uid].forEach(uid => uid && userIds.add(uid));
  });
  snapshot.conversations.forEach(conversationRecord => {
    const conversation = conversationRecord.data || {};
    (Array.isArray(conversation.memberIds) ? conversation.memberIds : []).forEach(uid => uid && userIds.add(uid));
    [conversation.createdBy?.uid].forEach(uid => uid && userIds.add(uid));
    conversationRecord.members.forEach(memberRecord => {
      if (memberRecord.id) userIds.add(memberRecord.id);
    });
    conversationRecord.messages.forEach(messageRecord => {
      const message = messageRecord.data || {};
      if (message.sender?.uid) userIds.add(message.sender.uid);
    });
  });
  snapshot.userGameStats.forEach(statRecord => { if (statRecord.id) userIds.add(statRecord.id); });
  snapshot.userBadges.forEach(badgeRecord => { if (badgeRecord.id) userIds.add(badgeRecord.id); });
  snapshot.gameEvents.forEach(eventRecord => {
    const event = eventRecord.data || {};
    [event.actor?.uid, event.userId].forEach(uid => uid && userIds.add(uid));
  });
  snapshot.roleFeedAlerts.forEach(alertRecord => {
    const alert = alertRecord.data || {};
    [alert.createdBy?.uid].forEach(uid => uid && userIds.add(uid));
    (Array.isArray(alert.recipientUserIds) ? alert.recipientUserIds : []).forEach(uid => uid && userIds.add(uid));
  });
  snapshot.pressNotes.forEach(noteRecord => {
    const note = noteRecord.data || {};
    [note.createdBy?.uid].forEach(uid => uid && userIds.add(uid));
  });
  snapshot.leaderboards.forEach(boardRecord => {
    const board = boardRecord.data || {};
    Object.keys(board.entriesByUid || {}).forEach(uid => uid && userIds.add(uid));
    (Array.isArray(board.entries) ? board.entries : []).forEach(entry => entry?.uid && userIds.add(entry.uid));
  });
  [...snapshot.sharedWikiPages, ...snapshot.pressWikiPages].forEach(pageRecord => {
    const page = pageRecord.data || {};
    [page.createdBy?.uid, page.updatedBy?.uid, page.lastVerifiedBy].forEach(uid => uid && userIds.add(uid));
    pageRecord.revisions.forEach(revisionRecord => {
      const revision = revisionRecord.data || {};
      if (revision.editedBy?.uid) userIds.add(revision.editedBy.uid);
      else if (revision.editedBy) userIds.add(revision.editedBy);
    });
    pageRecord.attachments.forEach(attachmentRecord => {
      const attachment = attachmentRecord.data || {};
      if (attachment.uploadedBy?.uid) userIds.add(attachment.uploadedBy.uid);
      else if (attachment.uploadedBy) userIds.add(attachment.uploadedBy);
    });
  });

  const users = [];
  await Promise.all([...userIds].map(async uid => {
    const snap = await db.collection('users').doc(uid).get();
    users.push({ id: uid, data: snap.exists ? (snap.data() || {}) : {} });
  }));
  return users;
}

async function loadUserTodosForUsers(targetPlantId, users) {
  const todoRows = [];
  await Promise.all(users.map(async user => {
    const todosSnap = await db.collection('users').doc(user.id).collection('todos').get();
    todosSnap.docs.forEach(docSnap => {
      const data = docSnap.data() || {};
      if (String(data.plantId || '') !== String(targetPlantId || '')) return;
      todoRows.push({
        ownerUid: user.id,
        id: docSnap.id,
        data
      });
    });
  }));
  return todoRows;
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
    created_at: dateOrNow(user.data.createdAt),
    updated_at: dateOrNow(user.data.updatedAt || user.data.lastSeen || user.data.createdAt),
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
    created_at: dateOrNow(plantData.createdAt),
    updated_at: dateOrNow(plantData.updatedAt || plantData.createdAt),
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
      alert_category_subscriptions_json: jsonOrNull(data.alertCategorySubscriptions || null),
      job_role_keys_json: jsonOrNull(data.jobRoleKeys || null),
      job_feeds_json: jsonOrNull(data.jobFeeds || null),
      joined_at: dateOrNow(data.addedAt || data.joinedAt || data.createdAt),
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
      requested_at: dateOrNow(data.requestedAt || data.createdAt),
      updated_at: dateOrNow(data.updatedAt || data.reviewedAt || data.requestedAt || data.createdAt)
    };
  });

  const statusConfigRows = snapshot.statusConfig ? [{
    plant_id: snapshot.plant.id,
    statuses_json: jsonOrNull(snapshot.statusConfig.statuses || {}),
    subcategory_routes_json: jsonOrNull(snapshot.statusConfig.subcategoryRoutes || null),
    updated_by_uid: stringOrNull(snapshot.statusConfig.updatedBy?.uid || snapshot.statusConfig.updatedByUid),
    updated_at: dateOrNow(snapshot.statusConfig.updatedAt)
  }] : [];

  const pressConfigRows = snapshot.pressConfig ? [{
    plant_id: snapshot.plant.id,
    presses_json: jsonOrNull(snapshot.pressConfig.presses || {}),
    updated_by_uid: stringOrNull(snapshot.pressConfig.updatedBy?.uid || snapshot.pressConfig.updatedByUid),
    updated_at: dateOrNow(snapshot.pressConfig.updatedAt)
  }] : [];

  const roleAlertRoutingRows = snapshot.roleAlertRoutingConfig ? [{
    plant_id: snapshot.plant.id,
    rules_json: jsonOrNull(snapshot.roleAlertRoutingConfig.rules || []),
    updated_by_uid: stringOrNull(snapshot.roleAlertRoutingConfig.updatedBy?.uid || snapshot.roleAlertRoutingConfig.updatedByUid),
    updated_at: dateOrNow(snapshot.roleAlertRoutingConfig.updatedAt)
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
        created_at: dateOrNow(snapshot.plant.data?.createdAt),
        updated_at: dateOrNow(snapshot.pressConfig?.updatedAt || snapshot.plant.data?.updatedAt || snapshot.plant.data?.createdAt)
      });
    });
  });

  const gameConfigRows = snapshot.gamificationConfig ? [{
    plant_id: snapshot.plant.id,
    config_json: jsonOrNull(snapshot.gamificationConfig),
    updated_at: dateOrNow(snapshot.gamificationConfig.updatedAt)
  }] : [];

  const storeConfigRows = snapshot.storeConfig ? [{
    plant_id: snapshot.plant.id,
    config_json: jsonOrNull(snapshot.storeConfig),
    updated_at: dateOrNow(snapshot.storeConfig.updatedAt)
  }] : [];

  const issueRows = [];
  const eventRows = [];
  const attachmentRows = [];
  const noteRows = [];
  const noteAttachmentRows = [];
  const todoRows = [];
  const conversationRows = [];
  const conversationMemberRows = [];
  const conversationMessageRows = [];
  const userGameStatsRows = [];
  const gameEventRows = [];
  const userBadgeRows = [];
  const leaderboardRows = [];
  const missionRows = [];
  const missionProgressRows = [];
  const roleFeedAlertRows = [];
  const pressNoteRows = [];
  const wikiPageRows = [];
  const wikiRevisionRows = [];
  const wikiAttachmentRows = [];
  const dailyScheduleRows = [];
  const dailyScheduleItemRows = [];
  const partRowsByNumber = new Map();

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
        taken_at: toDate(attachment.takenAt || attachment.timestamp)?.toISOString() || null,
        uploaded_at: dateOrNow(attachment.uploadedAt || attachment.createdAt),
        size_bytes: intOrNull(attachment.sizeBytes),
        schema_version: intOrZero(attachment.schemaVersion || 1)
      };
    });
    attachmentRows.push(...(nativeAttachments.length ? nativeAttachments : buildSyntheticAttachmentRows(issueRecord.id, snapshot.plant.id, issueRecord.data)));
  });

  snapshot.notes.forEach(noteRecord => {
    const note = noteRecord.data || {};
    noteRows.push({
      note_id: noteRecord.id,
      plant_id: snapshot.plant.id,
      title: stringOrNull(note.title),
      body_html: stringOrNull(note.bodyHtml),
      body_text: stringOrNull(note.bodyText),
      checklist_items_json: jsonOrNull(note.checklistItems || []),
      tags_json: jsonOrNull(note.tags || []),
      press_id: stringOrNull(note.pressId),
      machine_code: stringOrNull(note.machineCode),
      issue_id: stringOrNull(note.issueId),
      is_pinned: toBool(note.isPinned),
      is_archived: toBool(note.isArchived),
      photo_count: intOrZero(note.photoCount),
      search_text: stringOrNull(note.searchText),
      created_by_uid: stringOrNull(note.createdBy?.uid || note.createdBy),
      updated_by_uid: stringOrNull(note.updatedBy?.uid || note.updatedBy),
      created_at: dateOrNow(note.createdAt),
      updated_at: dateOrNow(note.updatedAt || note.createdAt)
    });
    noteRecord.attachments.forEach(attachmentRecord => {
      const attachment = attachmentRecord.data || {};
      noteAttachmentRows.push({
        note_attachment_id: noteAttachmentRowId(noteRecord.id, attachmentRecord.id),
        note_id: noteRecord.id,
        plant_id: snapshot.plant.id,
        attachment_id: attachmentRecord.id,
        storage_path: stringOrNull(attachment.storagePath) || `plants/${snapshot.plant.id}/notes/${noteRecord.id}/attachments/${attachmentRecord.id}`,
        storage_bucket: stringOrNull(attachment.storageBucket),
        file_name: stringOrNull(attachment.fileName),
        content_type: stringOrNull(attachment.contentType),
        size_bytes: intOrNull(attachment.sizeBytes),
        url: stringOrNull(attachment.url || attachment.downloadURL),
        uploaded_by_json: jsonOrNull(attachment.uploadedBy || null),
        uploaded_at: dateOrNow(attachment.uploadedAt || attachment.createdAt),
        schema_version: intOrZero(attachment.schemaVersion || 1)
      });
    });
  });

  snapshot.plantTodos.forEach(todoRecord => {
    const todo = todoRecord.data || {};
    todoRows.push({
      todo_id: `shared:${todoRecord.id}`,
      scope: 'shared',
      plant_id: stringOrNull(todo.plantId) || snapshot.plant.id,
      owner_uid: stringOrNull(todo.ownerUid || todo.createdBy?.uid),
      title: stringOrNull(todo.title) || 'Untitled Todo',
      notes: stringOrNull(todo.notes),
      list_name: stringOrNull(todo.listName) || 'Inbox',
      due_date: stringOrNull(todo.dueDate),
      priority: stringOrNull(todo.priority),
      is_completed: toBool(todo.isCompleted),
      completed_at: toDate(todo.completedAt),
      press_id: stringOrNull(todo.pressId),
      machine_code: stringOrNull(todo.machineCode),
      issue_id: stringOrNull(todo.issueId),
      search_text: stringOrNull(todo.searchText),
      created_by_json: jsonOrNull(todo.createdBy || null),
      updated_by_json: jsonOrNull(todo.updatedBy || null),
      created_at: dateOrNow(todo.createdAt),
      updated_at: dateOrNow(todo.updatedAt || todo.createdAt)
    });
  });

  (snapshot.userTodos || []).forEach(todoRecord => {
    const todo = todoRecord.data || {};
    todoRows.push({
      todo_id: `personal:${todoRecord.ownerUid}:${todoRecord.id}`,
      scope: 'personal',
      plant_id: stringOrNull(todo.plantId) || snapshot.plant.id,
      owner_uid: stringOrNull(todo.ownerUid || todoRecord.ownerUid),
      title: stringOrNull(todo.title) || 'Untitled Todo',
      notes: stringOrNull(todo.notes),
      list_name: stringOrNull(todo.listName) || 'Inbox',
      due_date: stringOrNull(todo.dueDate),
      priority: stringOrNull(todo.priority),
      is_completed: toBool(todo.isCompleted),
      completed_at: toDate(todo.completedAt),
      press_id: stringOrNull(todo.pressId),
      machine_code: stringOrNull(todo.machineCode),
      issue_id: stringOrNull(todo.issueId),
      search_text: stringOrNull(todo.searchText),
      created_by_json: jsonOrNull(todo.createdBy || null),
      updated_by_json: jsonOrNull(todo.updatedBy || null),
      created_at: dateOrNow(todo.createdAt),
      updated_at: dateOrNow(todo.updatedAt || todo.createdAt)
    });
  });

  snapshot.conversations.forEach(conversationRecord => {
    const conversation = conversationRecord.data || {};
    conversationRows.push({
      conversation_id: conversationRecord.id,
      plant_id: snapshot.plant.id,
      type: stringOrNull(conversation.type) || 'group',
      title: stringOrNull(conversation.title),
      member_ids_json: jsonOrNull(conversation.memberIds || []),
      last_message_text: stringOrNull(conversation.lastMessage?.textPreview),
      last_message_at: dateOrNow(conversation.lastMessageAt || conversation.lastMessage?.at || conversation.createdAt),
      created_by_uid: stringOrNull(conversation.createdBy?.uid),
      created_at: dateOrNow(conversation.createdAt),
      press_id: stringOrNull(conversation.pressId),
      member_count: intOrZero(conversation.memberCount || conversation.memberIds?.length),
      created_by_name: stringOrNull(conversation.createdBy?.name),
      last_message_json: jsonOrNull(conversation.lastMessage || null),
      is_archived: toBool(conversation.isArchived)
    });
    if (conversationRecord.members.length) {
      conversationRecord.members.forEach(memberRecord => {
        const member = memberRecord.data || {};
        conversationMemberRows.push({
          conversation_id: conversationRecord.id,
          uid: memberRecord.id,
          last_read_at: toDate(member.lastReadAt),
          muted: toBool(member.muted),
          role: stringOrNull(member.role),
          joined_at: toDate(member.joinedAt),
          last_read_message_id: stringOrNull(member.lastReadMessageId),
          unread_count: intOrZero(member.unreadCount)
        });
      });
    } else {
      (Array.isArray(conversation.memberIds) ? conversation.memberIds : []).forEach(uid => {
        conversationMemberRows.push({
          conversation_id: conversationRecord.id,
          uid,
          last_read_at: dateOrNow(conversation.createdAt),
          muted: false,
          role: uid === conversation.createdBy?.uid ? 'owner' : 'member',
          joined_at: dateOrNow(conversation.createdAt),
          last_read_message_id: null,
          unread_count: 0
        });
      });
    }
    conversationRecord.messages.forEach(messageRecord => {
      const message = messageRecord.data || {};
      conversationMessageRows.push({
        message_id: messageRecord.id,
        conversation_id: conversationRecord.id,
        plant_id: snapshot.plant.id,
        sender_uid: stringOrNull(message.sender?.uid),
        sender_name: stringOrNull(message.sender?.name),
        body: stringOrNull(message.text) || '',
        created_at: dateOrNow(message.createdAt),
        type: stringOrNull(message.type) || 'text',
        mentions_json: jsonOrNull(message.mentions || []),
        attachments_json: jsonOrNull(message.attachments || []),
        edited_at: toDate(message.editedAt),
        deleted_at: toDate(message.deletedAt)
      });
    });
  });

  snapshot.userGameStats.forEach(statRecord => {
    const stat = statRecord.data || {};
    userGameStatsRows.push({
      plant_id: snapshot.plant.id,
      uid: statRecord.id,
      totals_json: jsonOrNull(stat.totals || stat),
      updated_at: dateOrNow(stat.updatedAt || stat.lastEventAt),
      user_id: stringOrNull(stat.userId) || statRecord.id,
      display_name: stringOrNull(stat.displayName),
      streaks_json: jsonOrNull(stat.streaks || null),
      last_event_at: toDate(stat.lastEventAt),
      schema_version: intOrZero(stat.schemaVersion || 1)
    });
  });

  snapshot.gameEvents.forEach(eventRecord => {
    const event = eventRecord.data || {};
    gameEventRows.push({
      game_event_id: eventRecord.id,
      plant_id: snapshot.plant.id,
      uid: stringOrNull(event.actor?.uid || event.userId),
      type: stringOrNull(event.type) || 'xp_awarded',
      xp_delta: intOrZero(event.delta?.xp),
      dedupe_key: stringOrNull(event.dedupeKey),
      payload_json: jsonOrNull(event),
      created_at: dateOrNow(event.createdAt || event.eventAt)
    });
  });

  const dedupedGameEventRows = dedupeRowsByKey(
    gameEventRows,
    row => row.dedupe_key
      ? `dedupe:${row.plant_id}:${row.dedupe_key}`
      : `id:${row.game_event_id}`,
    row => dateMs(row.created_at)
  );

  snapshot.roleFeedAlerts.forEach(alertRecord => {
    const alert = alertRecord.data || {};
    roleFeedAlertRows.push({
      alert_id: alertRecord.id,
      plant_id: snapshot.plant.id,
      issue_id: stringOrNull(alert.issueId),
      status_key: stringOrNull(alert.statusKey),
      subcategory_key: stringOrNull(alert.subcategoryKey),
      title: stringOrNull(alert.title || alert.feedLabel),
      body: stringOrNull(alert.body || alert.note),
      is_resolved: toBool(alert.isResolved),
      created_at: dateOrNow(alert.createdAt),
      updated_at: dateOrNow(alert.updatedAt || alert.createdAt),
      category_key: stringOrNull(alert.categoryKey),
      category_keys_json: jsonOrNull(alert.categoryKeys || null),
      workflow_id: stringOrNull(alert.workflowId),
      feed_key: stringOrNull(alert.feedKey),
      feed_label: stringOrNull(alert.feedLabel),
      recipient_user_ids_json: jsonOrNull(alert.recipientUserIds || []),
      required_job_role_keys_json: jsonOrNull(alert.requiredJobRoleKeys || null),
      created_by_json: jsonOrNull(alert.createdBy || null),
      raw_json: jsonOrNull(alert)
    });
  });

  snapshot.pressNotes.forEach(noteRecord => {
    const note = noteRecord.data || {};
    pressNoteRows.push({
      press_note_id: noteRecord.id,
      plant_id: snapshot.plant.id,
      press_id: stringOrNull(note.pressId),
      machine_code: stringOrNull(note.machineCode),
      text: stringOrNull(note.text),
      photo_count: intOrZero(note.photoCount || note.photos?.length),
      photos_json: jsonOrNull(note.photos || []),
      created_by_json: jsonOrNull(note.createdBy || null),
      created_at: dateOrNow(note.createdAt),
      schema_version: intOrZero(note.schemaVersion || 1)
    });
  });

  snapshot.userBadges.forEach(badgeRecord => {
    const badge = badgeRecord.data || {};
    userBadgeRows.push({
      plant_id: snapshot.plant.id,
      uid: badgeRecord.id,
      earned_badges_json: jsonOrNull(badge.earnedBadges || {}),
      updated_at: dateOrNow(badge.updatedAt)
    });
  });

  snapshot.leaderboards.forEach(boardRecord => {
    const board = boardRecord.data || {};
    leaderboardRows.push({
      leaderboard_row_id: leaderboardRowId(snapshot.plant.id, boardRecord.id),
      plant_id: snapshot.plant.id,
      board_id: boardRecord.id,
      entries_json: jsonOrNull(board.entries || null),
      entries_by_uid_json: jsonOrNull(board.entriesByUid || null),
      updated_at: dateOrNow(board.updatedAt),
      schema_version: intOrZero(board.schemaVersion || 1)
    });
  });

  snapshot.missions.forEach(missionRecord => {
    const mission = missionRecord.data || {};
    missionRows.push({
      mission_row_id: missionRowId(snapshot.plant.id, missionRecord.id),
      plant_id: snapshot.plant.id,
      mission_id: missionRecord.id,
      name: stringOrNull(mission.name),
      description: stringOrNull(mission.description),
      objective_json: jsonOrNull(mission.objective || null),
      rewards_json: jsonOrNull(mission.rewards || null),
      is_active: mission.isActive !== false,
      starts_at: toDate(mission.startsAt),
      ends_at: toDate(mission.endsAt),
      updated_at: dateOrNow(mission.updatedAt || mission.startsAt),
      raw_json: jsonOrNull(mission)
    });
    missionRecord.progress.forEach(progressRecord => {
      const progress = progressRecord.data || {};
      missionProgressRows.push({
        mission_progress_row_id: missionProgressRowId(snapshot.plant.id, missionRecord.id, progressRecord.id),
        plant_id: snapshot.plant.id,
        mission_id: missionRecord.id,
        subject_id: progressRecord.id,
        subject_type: stringOrNull(progress.subjectType),
        current_value: intOrZero(progress.current),
        target_value: intOrZero(progress.target),
        percent: intOrZero(progress.percent),
        completed: toBool(progress.completed),
        updated_at: dateOrNow(progress.updatedAt),
        raw_json: jsonOrNull(progress)
      });
    });
  });

  [...snapshot.sharedWikiPages, ...snapshot.pressWikiPages].forEach(pageRecord => {
    const page = pageRecord.data || {};
    const scope = pageRecord.scope || 'shared';
    const pressId = pageRecord.pressId || null;
    const pageRowId = wikiPageRowId(scope, pressId, pageRecord.id);
    wikiPageRows.push({
      wiki_page_row_id: pageRowId,
      plant_id: snapshot.plant.id,
      scope,
      press_id: pressId,
      page_id: pageRecord.id,
      title: stringOrNull(page.title),
      slug: stringOrNull(page.slug),
      summary: stringOrNull(page.summary),
      tags_json: jsonOrNull(page.tags || []),
      parent_page_id: stringOrNull(page.parentPageId),
      sort_order: intOrNull(page.sortOrder),
      is_pinned: toBool(page.isPinned),
      is_locked: toBool(page.isLocked),
      visibility: stringOrNull(page.visibility),
      current_revision_id: stringOrNull(page.currentRevisionId),
      photo_count: intOrZero(page.photoCount),
      search_text: stringOrNull(page.searchText),
      created_by_json: jsonOrNull(page.createdBy || null),
      updated_by_json: jsonOrNull(page.updatedBy || null),
      created_at: dateOrNow(page.createdAt),
      updated_at: dateOrNow(page.updatedAt || page.createdAt),
      last_activity_at: dateOrNow(page.lastActivityAt || page.updatedAt || page.createdAt),
      last_verified_at: toDate(page.lastVerifiedAt),
      last_verified_by: stringOrNull(page.lastVerifiedBy?.uid || page.lastVerifiedBy),
      schema_version: intOrZero(page.schemaVersion || 1)
    });
    pageRecord.revisions.forEach(revisionRecord => {
      const revision = revisionRecord.data || {};
      wikiRevisionRows.push({
        wiki_revision_row_id: wikiRevisionRowId(scope, pressId, pageRecord.id, revisionRecord.id),
        wiki_page_row_id: pageRowId,
        plant_id: snapshot.plant.id,
        scope,
        press_id: pressId,
        page_id: pageRecord.id,
        revision_id: revisionRecord.id,
        body: stringOrNull(revision.body),
        change_note: stringOrNull(revision.changeNote),
        prev_revision_id: stringOrNull(revision.prevRevisionId),
        edited_by_json: jsonOrNull(revision.editedBy || null),
        edited_at: dateOrNow(revision.editedAt)
      });
    });
    pageRecord.attachments.forEach(attachmentRecord => {
      const attachment = attachmentRecord.data || {};
      wikiAttachmentRows.push({
        wiki_attachment_row_id: wikiAttachmentRowId(scope, pressId, pageRecord.id, attachmentRecord.id),
        wiki_page_row_id: pageRowId,
        plant_id: snapshot.plant.id,
        scope,
        press_id: pressId,
        page_id: pageRecord.id,
        attachment_id: attachmentRecord.id,
        storage_path: stringOrNull(attachment.storagePath) || `plants/${snapshot.plant.id}/${scope === 'shared' ? 'wikiPages' : `presses/${pressId}/wikiPages`}/${pageRecord.id}/attachments/${attachmentRecord.id}`,
        content_type: stringOrNull(attachment.contentType),
        caption: stringOrNull(attachment.caption),
        linked_revision_id: stringOrNull(attachment.linkedRevisionId),
        uploaded_by_json: jsonOrNull(attachment.uploadedBy || null),
        uploaded_at: dateOrNow(attachment.uploadedAt),
        width: intOrNull(attachment.width),
        height: intOrNull(attachment.height),
        url: stringOrNull(attachment.url || attachment.downloadURL),
        schema_version: intOrZero(attachment.schemaVersion || 1)
      });
    });
  });

  snapshot.dailySchedules.forEach(scheduleRecord => {
    const schedule = scheduleRecord.data || {};
    const scheduleDate = stringOrNull(schedule.scheduleDate) || scheduleRecord.id;
    const scheduleShift = normalizeScheduleShift(schedule.shift) || '1';
    const scheduleRowId = dailyScheduleRowId(snapshot.plant.id, scheduleDate, scheduleShift);
    dailyScheduleRows.push({
      daily_schedule_row_id: scheduleRowId,
      plant_id: snapshot.plant.id,
      schedule_date: scheduleDate,
      shift: scheduleShift,
      line_speed: stringOrNull(schedule.lineSpeed),
      total_planned_pcs: stringOrNull(schedule.totalPlannedPcs),
      source_file_name: stringOrNull(schedule.sourceFileName),
      source_file_type: stringOrNull(schedule.sourceFileType),
      status: stringOrNull(schedule.status),
      notes: stringOrNull(schedule.notes),
      page1_count: intOrZero(schedule.page1Count),
      page2_count: intOrZero(schedule.page2Count),
      north_bay_changes_count: intOrZero(schedule.northBayChangesCount),
      south_bay_changes_count: intOrZero(schedule.southBayChangesCount),
      raw_json: jsonOrNull(schedule),
      created_at: dateOrNow(schedule.createdAt),
      updated_at: dateOrNow(schedule.updatedAt || schedule.createdAt)
    });

    Object.entries(scheduleRecord.sections || {}).forEach(([sectionKey, rows]) => {
      (Array.isArray(rows) ? rows : []).forEach(rowRecord => {
        const row = rowRecord.data || {};
        const rowId = stringOrNull(row.rowId) || rowRecord.id;
        const partNumber = stringOrNull(row.partNumber);
        if (partNumber) {
          const existingPart = partRowsByNumber.get(partNumber);
          const createdAt = dateOrNow(row.createdAt || schedule.createdAt);
          const updatedAt = dateOrNow(row.updatedAt || row.createdAt || schedule.updatedAt || schedule.createdAt);
          if (!existingPart || dateMs(updatedAt) >= dateMs(existingPart.updated_at)) {
            partRowsByNumber.set(partNumber, {
              part_number: partNumber,
              description: stringOrNull(row.description),
              created_at: existingPart?.created_at || createdAt,
              updated_at: updatedAt
            });
          }
        }
        dailyScheduleItemRows.push({
          daily_schedule_item_row_id: dailyScheduleItemRowId(snapshot.plant.id, scheduleDate, scheduleShift, sectionKey, rowId),
          daily_schedule_row_id: scheduleRowId,
          plant_id: snapshot.plant.id,
          schedule_date: scheduleDate,
          section_key: sectionKey,
          row_id: rowId,
          press: stringOrNull(row.press),
          part_number: partNumber,
          cavity: stringOrNull(row.cavity),
          doh: stringOrNull(row.doh),
          labels_per_shift: stringOrNull(row.labelsPerShift),
          mc: stringOrNull(row.mc),
          notes: stringOrNull(row.notes),
          shift: scheduleShift,
          part_storage_location_json: jsonOrNull(
            Array.isArray(row.partStorageLocation)
              ? row.partStorageLocation
              : (row.partStorageLocation == null ? [] : [row.partStorageLocation])
          ),
          raw_json: jsonOrNull(row),
          created_at: dateOrNow(row.createdAt || schedule.createdAt),
          updated_at: dateOrNow(row.updatedAt || row.createdAt || schedule.updatedAt || schedule.createdAt)
        });
      });
    });
  });

  return {
    users: userRows,
    user_lookup: userLookupRows,
    plants: plantRows,
    plant_members: memberRows,
    access_requests: accessRequestRows,
    plant_status_config: statusConfigRows,
    plant_press_config: pressConfigRows,
    role_alert_routing_config: roleAlertRoutingRows,
    presses: pressRows,
    gamification_config: gameConfigRows,
    plant_store_config: storeConfigRows,
    issues: issueRows,
    issue_events: eventRows,
    issue_attachments: attachmentRows,
    press_notes: pressNoteRows,
    notes: noteRows,
    note_attachments: noteAttachmentRows,
    todos: todoRows,
    conversations: conversationRows,
    conversation_members: conversationMemberRows,
    conversation_messages: conversationMessageRows,
    user_game_stats: userGameStatsRows,
    game_events: dedupedGameEventRows,
    user_badges: userBadgeRows,
    game_leaderboards: leaderboardRows,
    game_missions: missionRows,
    game_mission_progress: missionProgressRows,
    role_feed_alerts: roleFeedAlertRows,
    wiki_pages: wikiPageRows,
    wiki_revisions: wikiRevisionRows,
    wiki_attachments: wikiAttachmentRows,
    daily_schedules: dailyScheduleRows,
    parts: [...partRowsByNumber.values()],
    daily_schedule_rows: dailyScheduleItemRows
  };
}

function buildImportSql(rowsByTable) {
  const order = [
    'users',
    'user_lookup',
    'plants',
    'plant_members',
    'access_requests',
    'plant_status_config',
    'plant_press_config',
    'role_alert_routing_config',
    'presses',
    'gamification_config',
    'plant_store_config',
    'user_game_stats',
    'user_badges',
    'game_leaderboards',
    'game_missions',
    'game_mission_progress',
    'game_events',
    'role_feed_alerts',
    'issues',
    'issue_events',
    'issue_attachments',
    'press_notes',
    'notes',
    'note_attachments',
    'todos',
    'conversations',
    'conversation_members',
    'conversation_messages',
    'wiki_pages',
    'wiki_revisions',
    'wiki_attachments',
    'daily_schedules',
    'parts',
    'daily_schedule_rows'
  ];

  const statements = ['PRAGMA foreign_keys = ON;'];
  for (const tableName of order) {
    const tableSpec = TABLES[tableName];
    for (const row of rowsByTable[tableName]) {
      statements.push(buildD1UpsertStatement(tableSpec, row));
    }
  }
  return `${statements.join('\n\n')}\n`;
}

async function main() {
  const snapshot = await loadPlantSnapshot(plantId);
  const users = await loadUsersForPlant(snapshot);
  snapshot.userTodos = await loadUserTodosForUsers(plantId, users);
  const rowsByTable = buildRows(snapshot, users);

  const summary = Object.fromEntries(
    Object.entries(rowsByTable).map(([tableName, rows]) => [tableName, rows.length])
  );

  if (isDryRun) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      plantId,
      d1Mode,
      databaseName: databaseName || null,
      summary
    }, null, 2));
    return;
  }

  const sqlText = buildImportSql(rowsByTable);
  await executeD1File(databaseName, sqlText, {
    mode: d1Mode,
    workdir: repoRoot
  });

  console.log(JSON.stringify({
    mode: 'commit',
    plantId,
    d1Mode,
    databaseName,
    summary
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
