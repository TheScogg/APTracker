import {
  serializeGamificationConfig,
  serializeGameLeaderboard,
  serializeGameMission,
  serializeGameMissionProgress,
  serializeIssue,
  serializeIssueAttachment,
  serializeIssueEvent,
  serializePlant,
  serializePlantMember,
  serializePressConfig,
  serializeRoleFeedAlert,
  serializeStatusConfig,
  serializeUserBadges,
  serializeUserGameStats,
  serializeUserContextRows
} from './api/src/serializers.js';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
}

function errorResponse(error) {
  const status = error?.status || 500;
  return jsonResponse({
    error: status === 500 ? 'Internal server error' : (error?.message || 'Unknown error')
  }, { status });
}

function getDb(env) {
  const db = env.APTRACKER_DB || env.DB;
  if (!db) {
    throw Object.assign(new Error('D1 binding not configured. Add APTRACKER_DB or DB to wrangler.jsonc.'), { status: 500 });
  }
  return db;
}

function decodePathSegment(value) {
  return decodeURIComponent(String(value || ''));
}

function normalizeAuthUser(user) {
  if (!user?.localId) {
    throw Object.assign(new Error('Invalid Firebase user context.'), { status: 401 });
  }
  return {
    uid: user.localId,
    email: user.email || '',
    name: user.displayName || user.email || user.localId,
    picture: user.photoUrl || ''
  };
}

function parsePermissions(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function nowIso() {
  return new Date().toISOString();
}

function asIso(value, fallback = null) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function asBoolInt(value) {
  return value ? 1 : 0;
}

function jsonString(value, fallback = null) {
  if (value == null) return fallback;
  return JSON.stringify(value);
}

function jsonOrNull(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

function stringOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

const DEFAULT_BADGE_DEFS = [
  { id: 'badge_first_resolve', name: 'First Responder', icon: '✅', description: 'Resolve your first issue', triggerType: 'issues_resolved', threshold: 1, xpReward: 25, isEnabled: true },
  { id: 'badge_streak_3', name: 'On a Roll', icon: '🔥', description: 'Maintain a 3-day streak', triggerType: 'streak_days', threshold: 3, xpReward: 30, isEnabled: true },
  { id: 'badge_streak_10', name: 'Committed', icon: '💪', description: '10-day streak', triggerType: 'streak_days', threshold: 10, xpReward: 100, isEnabled: true },
  { id: 'badge_photo_pro', name: 'Photo Pro', icon: '📸', description: 'Attach 50 photos', triggerType: 'photos_attached', threshold: 50, xpReward: 75, isEnabled: true },
  { id: 'badge_level_5', name: 'Veteran', icon: '⭐', description: 'Reach Level 5', triggerType: 'level_reached', threshold: 5, xpReward: 150, isEnabled: true },
  { id: 'badge_xp_500', name: 'XP Hunter', icon: '⚡', description: 'Earn 500 total XP', triggerType: 'xp_milestone', threshold: 500, xpReward: 50, isEnabled: true },
  { id: 'badge_resolver_10', name: 'Problem Solver', icon: '🏆', description: 'Resolve 10 issues', triggerType: 'issues_resolved', threshold: 10, xpReward: 100, isEnabled: true }
];

function gameLevelFromXp(xp) {
  const safeXp = Math.max(0, Number(xp || 0));
  return Math.max(1, Math.floor(Math.sqrt(safeXp / 100)) + 1);
}

function checkBadgeTrigger(badge, stats) {
  const threshold = Number(badge?.threshold || 1);
  switch (badge?.triggerType) {
    case 'xp_milestone': return Number(stats?.totals?.xp || 0) >= threshold;
    case 'level_reached': return Number(stats?.totals?.level || 1) >= threshold;
    case 'streak_days': return Number(stats?.streaks?.current || 0) >= threshold;
    case 'issues_resolved': return Number(stats?.totals?.issuesResolved || 0) >= threshold;
    case 'photos_attached': return Number(stats?.totals?.photosAttached || 0) >= threshold;
    case 'issues_created': return Number(stats?.totals?.issuesCreated || 0) >= threshold;
    case 'missions_completed': return Number(stats?.totals?.missionsCompleted || 0) >= threshold;
    default: return false;
  }
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

function buildCurrentStatusFromIssue(issue = {}) {
  if (issue.currentStatus?.statusKey) return issue.currentStatus;
  const history = Array.isArray(issue.statusHistory) ? issue.statusHistory : [];
  const last = history[history.length - 1] || {};
  const statusKey = last.status || issue.status || (issue.lifecycle?.isResolved || issue.resolved ? 'resolved' : 'open');
  const subStatusKey = last.subStatus || issue.subStatus || '';
  const enteredDateTime = last.dateTime || issue.dateTime || issue.createdAt || nowIso();
  return {
    statusKey,
    subStatusKey,
    label: statusKey,
    subLabel: subStatusKey,
    color: '',
    enteredAt: enteredDateTime,
    enteredDateTime,
    enteredBy: {
      uid: issue.userId || issue.createdBy?.uid || '',
      name: issue.userName || issue.createdBy?.name || ''
    },
    notePreview: stringOrNull(last.note || issue.note) || ''
  };
}

function buildIssueRowFromClient(plantId, issueId, issue = {}) {
  const currentStatus = buildCurrentStatusFromIssue(issue);
  const lifecycle = issue.lifecycle || {};
  const createdAt = asIso(issue.createdAt || issue.openedAt || currentStatus.enteredAt || issue.dateTime, nowIso());
  const updatedAt = asIso(issue.updatedAt || issue.editedAt || issue.reopenDateTime || issue.resolveDateTime || currentStatus.enteredAt, createdAt);

  return {
    issue_id: issueId,
    plant_id: plantId,
    press_id: stringOrNull(issue.pressId),
    machine_code: stringOrNull(issue.machineCode || issue.machine),
    row_id: stringOrNull(issue.rowId),
    title: stringOrNull(issue.title),
    note: stringOrNull(issue.note),
    description: stringOrNull(issue.description),
    issue_type: stringOrNull(issue.issueType || issue.category),
    priority: stringOrNull(issue.priority),
    severity: stringOrNull(issue.severity),
    high_priority: asBoolInt(issue.highPriority),
    current_status_key: stringOrNull(currentStatus.statusKey) || 'open',
    current_sub_status_key: stringOrNull(currentStatus.subStatusKey),
    current_status_label: stringOrNull(currentStatus.label || currentStatus.statusKey) || 'open',
    current_sub_status_label: stringOrNull(currentStatus.subLabel || currentStatus.subStatusKey),
    current_status_color: stringOrNull(currentStatus.color),
    current_status_entered_at: asIso(currentStatus.enteredAt || currentStatus.enteredDateTime, updatedAt),
    current_status_entered_by_uid: stringOrNull(currentStatus.enteredBy?.uid),
    current_status_entered_by_name: stringOrNull(currentStatus.enteredBy?.name),
    is_open: asBoolInt(issue.lifecycle?.isOpen ?? !(issue.lifecycle?.isResolved || issue.resolved || currentStatus.statusKey === 'resolved')),
    is_resolved: asBoolInt(issue.lifecycle?.isResolved ?? issue.resolved ?? (currentStatus.statusKey === 'resolved')),
    opened_at: asIso(lifecycle.openedAt || issue.createdAt || createdAt, createdAt),
    resolved_at: asIso(lifecycle.resolvedAt || issue.resolveDateTime),
    closed_at: asIso(lifecycle.closedAt || issue.resolveDateTime),
    reopened_count: numberOrZero(lifecycle.reopenedCount),
    assigned_team: stringOrNull(issue.assignedTeam),
    assigned_user_uid: stringOrNull(issue.assignedUserUid || issue.assignedUser?.uid),
    assigned_user_name: stringOrNull(issue.assignedUserName || issue.assignedUser?.name),
    serial_required: asBoolInt(issue.serialRequired),
    serial_captured: asBoolInt(issue.serialCaptured),
    serial_value: stringOrNull(issue.serialValue),
    reporting_date_key: stringOrNull(issue.reportingDateKey || issue.dateKey),
    reporting_week_key: stringOrNull(issue.reportingWeekKey),
    reporting_month_key: stringOrNull(issue.reportingMonthKey),
    reporting_shift_key: stringOrNull(issue.reportingShiftKey || issue.shift),
    workflow_state: stringOrNull(issue.workflowState),
    workflow_state_by_entry_json: jsonString(issue.workflowStateByEntry || null),
    workflow_state_history_json: jsonString(issue.workflowStateHistory || null),
    legacy_status_history_json: jsonString(Array.isArray(issue.statusHistory) ? issue.statusHistory : []),
    latest_note_preview: stringOrNull(currentStatus.notePreview || issue.note),
    tags_json: jsonString(Array.isArray(issue.tags) ? issue.tags : []),
    photo_count: numberOrZero(issue.photoCount || issue.photos?.length),
    created_by_uid: stringOrNull(issue.createdBy?.uid || issue.userId),
    created_by_name: stringOrNull(issue.createdBy?.name || issue.userName),
    updated_by_uid: stringOrNull(issue.updatedBy?.uid),
    updated_by_name: stringOrNull(issue.updatedBy?.name || issue.editedBy),
    created_at: createdAt,
    updated_at: updatedAt,
    schema_version: numberOrZero(issue.schemaVersion || 2)
  };
}

function buildAttachmentRowFromClient(plantId, issueId, attachment = {}, index = 0) {
  const attachmentId = stringOrNull(attachment.attachmentId)
    || stringOrNull(attachment.id)
    || `photo_${String(index).padStart(3, '0')}`;
  return {
    attachment_id: attachmentId,
    issue_id: issueId,
    plant_id: plantId,
    type: stringOrNull(attachment.type) || 'photo',
    file_name: stringOrNull(attachment.fileName || attachment.name),
    content_type: stringOrNull(attachment.contentType),
    storage_bucket: stringOrNull(attachment.storageBucket),
    storage_path: stringOrNull(attachment.storagePath),
    thumbnail_path: stringOrNull(attachment.thumbnailPath),
    download_url: stringOrNull(attachment.downloadUrl || attachment.downloadURL || attachment.dataUrl || attachment.url),
    uploaded_by_uid: stringOrNull(attachment.uploadedBy?.uid || attachment.uploadedByUid),
    uploaded_by_name: stringOrNull(attachment.uploadedBy?.name || attachment.uploadedByName),
    uploaded_at: asIso(attachment.uploadedAt, nowIso()),
    size_bytes: numberOrNull(attachment.sizeBytes),
    schema_version: numberOrZero(attachment.schemaVersion || 2)
  };
}

function buildEventRowFromClient(plantId, issueId, event = {}, index = 0) {
  const eventAt = asIso(event.eventAt || event.createdAt, nowIso());
  const payload = event.payload || {};
  return {
    event_id: stringOrNull(event.eventId) || stringOrNull(event.id) || `evt_${Date.now().toString(36)}_${index}`,
    issue_id: issueId,
    plant_id: plantId,
    event_type: stringOrNull(event.eventType || event.type) || 'status_changed',
    event_at: eventAt,
    actor_uid: stringOrNull(event.actor?.uid || event.actorUid),
    actor_name: stringOrNull(event.actor?.name || event.actorName),
    payload_json: jsonString(payload || null),
    dedupe_key: stringOrNull(event.dedupeKey),
    created_at: asIso(event.createdAt || eventAt, eventAt)
  };
}

async function run(db, sql, ...params) {
  return db.prepare(sql).bind(...params).run();
}

function issueUpsertStatement() {
  return `
    INSERT INTO issues (
      issue_id, plant_id, press_id, machine_code, row_id, title, note, description, issue_type, priority, severity,
      high_priority, current_status_key, current_sub_status_key, current_status_label, current_sub_status_label,
      current_status_color, current_status_entered_at, current_status_entered_by_uid, current_status_entered_by_name,
      is_open, is_resolved, opened_at, resolved_at, closed_at, reopened_count, assigned_team, assigned_user_uid,
      assigned_user_name, serial_required, serial_captured, serial_value, reporting_date_key, reporting_week_key,
      reporting_month_key, reporting_shift_key, workflow_state, workflow_state_by_entry_json, workflow_state_history_json,
      legacy_status_history_json, latest_note_preview, tags_json, photo_count, created_by_uid, created_by_name,
      updated_by_uid, updated_by_name, created_at, updated_at, schema_version
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )
    ON CONFLICT(issue_id) DO UPDATE SET
      press_id = excluded.press_id,
      machine_code = excluded.machine_code,
      row_id = excluded.row_id,
      title = excluded.title,
      note = excluded.note,
      description = excluded.description,
      issue_type = excluded.issue_type,
      priority = excluded.priority,
      severity = excluded.severity,
      high_priority = excluded.high_priority,
      current_status_key = excluded.current_status_key,
      current_sub_status_key = excluded.current_sub_status_key,
      current_status_label = excluded.current_status_label,
      current_sub_status_label = excluded.current_sub_status_label,
      current_status_color = excluded.current_status_color,
      current_status_entered_at = excluded.current_status_entered_at,
      current_status_entered_by_uid = excluded.current_status_entered_by_uid,
      current_status_entered_by_name = excluded.current_status_entered_by_name,
      is_open = excluded.is_open,
      is_resolved = excluded.is_resolved,
      opened_at = excluded.opened_at,
      resolved_at = excluded.resolved_at,
      closed_at = excluded.closed_at,
      reopened_count = excluded.reopened_count,
      assigned_team = excluded.assigned_team,
      assigned_user_uid = excluded.assigned_user_uid,
      assigned_user_name = excluded.assigned_user_name,
      serial_required = excluded.serial_required,
      serial_captured = excluded.serial_captured,
      serial_value = excluded.serial_value,
      reporting_date_key = excluded.reporting_date_key,
      reporting_week_key = excluded.reporting_week_key,
      reporting_month_key = excluded.reporting_month_key,
      reporting_shift_key = excluded.reporting_shift_key,
      workflow_state = excluded.workflow_state,
      workflow_state_by_entry_json = excluded.workflow_state_by_entry_json,
      workflow_state_history_json = excluded.workflow_state_history_json,
      legacy_status_history_json = excluded.legacy_status_history_json,
      latest_note_preview = excluded.latest_note_preview,
      tags_json = excluded.tags_json,
      photo_count = excluded.photo_count,
      created_by_uid = excluded.created_by_uid,
      created_by_name = excluded.created_by_name,
      updated_by_uid = excluded.updated_by_uid,
      updated_by_name = excluded.updated_by_name,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      schema_version = excluded.schema_version
  `;
}

function issueUpsertParams(row) {
  return [
    row.issue_id, row.plant_id, row.press_id, row.machine_code, row.row_id, row.title, row.note, row.description, row.issue_type, row.priority, row.severity,
    row.high_priority, row.current_status_key, row.current_sub_status_key, row.current_status_label, row.current_sub_status_label,
    row.current_status_color, row.current_status_entered_at, row.current_status_entered_by_uid, row.current_status_entered_by_name,
    row.is_open, row.is_resolved, row.opened_at, row.resolved_at, row.closed_at, row.reopened_count, row.assigned_team, row.assigned_user_uid,
    row.assigned_user_name, row.serial_required, row.serial_captured, row.serial_value, row.reporting_date_key, row.reporting_week_key,
    row.reporting_month_key, row.reporting_shift_key, row.workflow_state, row.workflow_state_by_entry_json, row.workflow_state_history_json,
    row.legacy_status_history_json, row.latest_note_preview, row.tags_json, row.photo_count, row.created_by_uid, row.created_by_name,
    row.updated_by_uid, row.updated_by_name, row.created_at, row.updated_at, row.schema_version
  ];
}

async function upsertIssueWriteBundle(db, plantId, body, user) {
  const issueId = stringOrNull(body.issueId) || stringOrNull(body.issue?.issueId) || stringOrNull(body.issue?.id);
  if (!issueId) {
    throw Object.assign(new Error('Missing issueId.'), { status: 400 });
  }
  if (!body.issue || typeof body.issue !== 'object') {
    throw Object.assign(new Error('Missing issue payload.'), { status: 400 });
  }

  const issueRow = buildIssueRowFromClient(plantId, issueId, body.issue);
  const attachmentRows = Array.isArray(body.attachments)
    ? body.attachments.map((attachment, index) => buildAttachmentRowFromClient(plantId, issueId, attachment, index)).filter(row => row.storage_path)
    : [];
  const eventRows = Array.isArray(body.events)
    ? body.events.map((event, index) => buildEventRowFromClient(plantId, issueId, event, index))
    : [];

  await requirePlantPermission(db, plantId, user, body.permissionName || 'canEditIssue');

  const statements = [
    db.prepare(issueUpsertStatement()).bind(...issueUpsertParams(issueRow))
  ];

  if (body.replaceAttachments) {
    statements.push(db.prepare('DELETE FROM issue_attachments WHERE plant_id = ? AND issue_id = ?').bind(plantId, issueId));
  }

  attachmentRows.forEach(row => {
    statements.push(
      db.prepare(`
        INSERT INTO issue_attachments (
          attachment_id, issue_id, plant_id, type, file_name, content_type, storage_bucket, storage_path, thumbnail_path,
          download_url, uploaded_by_uid, uploaded_by_name, uploaded_at, size_bytes, schema_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attachment_id) DO UPDATE SET
          type = excluded.type,
          file_name = excluded.file_name,
          content_type = excluded.content_type,
          storage_bucket = excluded.storage_bucket,
          storage_path = excluded.storage_path,
          thumbnail_path = excluded.thumbnail_path,
          download_url = excluded.download_url,
          uploaded_by_uid = excluded.uploaded_by_uid,
          uploaded_by_name = excluded.uploaded_by_name,
          uploaded_at = excluded.uploaded_at,
          size_bytes = excluded.size_bytes,
          schema_version = excluded.schema_version
      `).bind(
        row.attachment_id, row.issue_id, row.plant_id, row.type, row.file_name, row.content_type, row.storage_bucket, row.storage_path, row.thumbnail_path,
        row.download_url, row.uploaded_by_uid, row.uploaded_by_name, row.uploaded_at, row.size_bytes, row.schema_version
      )
    );
  });

  eventRows.forEach(row => {
    statements.push(
      db.prepare(`
        INSERT INTO issue_events (
          event_id, issue_id, plant_id, event_type, event_at, actor_uid, actor_name, payload_json, dedupe_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
          event_type = excluded.event_type,
          event_at = excluded.event_at,
          actor_uid = excluded.actor_uid,
          actor_name = excluded.actor_name,
          payload_json = excluded.payload_json,
          dedupe_key = excluded.dedupe_key,
          created_at = excluded.created_at
      `).bind(
        row.event_id, row.issue_id, row.plant_id, row.event_type, row.event_at, row.actor_uid, row.actor_name, row.payload_json, row.dedupe_key, row.created_at
      )
    );
  });

  await db.batch(statements);

  const saved = await first(db, 'SELECT * FROM issues WHERE plant_id = ? AND issue_id = ? LIMIT 1', plantId, issueId);
  return jsonResponse({
    issue: serializeIssue(saved),
    attachmentCount: attachmentRows.length,
    eventCount: eventRows.length
  });
}

async function deleteIssue(db, plantId, issueId, user) {
  await requirePlantPermission(db, plantId, user, 'canEditIssue');
  await db.batch([
    db.prepare('DELETE FROM role_feed_alert_recipients WHERE alert_id IN (SELECT alert_id FROM role_feed_alerts WHERE plant_id = ? AND issue_id = ?)').bind(plantId, issueId),
    db.prepare('DELETE FROM role_feed_alerts WHERE plant_id = ? AND issue_id = ?').bind(plantId, issueId),
    db.prepare('DELETE FROM issue_attachments WHERE plant_id = ? AND issue_id = ?').bind(plantId, issueId),
    db.prepare('DELETE FROM issue_events WHERE plant_id = ? AND issue_id = ?').bind(plantId, issueId),
    db.prepare('DELETE FROM issues WHERE plant_id = ? AND issue_id = ?').bind(plantId, issueId)
  ]);
  return jsonResponse({ ok: true, issueId });
}

async function all(db, sql, ...params) {
  const result = await db.prepare(sql).bind(...params).all();
  return result.results || [];
}

async function first(db, sql, ...params) {
  return db.prepare(sql).bind(...params).first();
}

async function requirePlantPermission(db, plantId, user, permissionName) {
  const member = await first(
    db,
    `
      SELECT role, is_active, permissions_json
      FROM plant_members
      WHERE plant_id = ? AND uid = ?
      LIMIT 1
    `,
    plantId,
    user.uid
  );
  if (!member || !Number(member.is_active)) {
    throw Object.assign(new Error('Plant access denied'), { status: 403 });
  }
  if (permissionName) {
    const permissions = parsePermissions(member.permissions_json);
    if (permissions[permissionName] !== true) {
      throw Object.assign(new Error('Permission denied'), { status: 403 });
    }
  }
  return member;
}

async function upsertAuthUserRow(db, user) {
  await run(
    db,
    `
      INSERT INTO users (
        uid, email, display_name, photo_url, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET
        email = COALESCE(excluded.email, users.email),
        display_name = COALESCE(excluded.display_name, users.display_name),
        photo_url = COALESCE(excluded.photo_url, users.photo_url),
        updated_at = excluded.updated_at
    `,
    user.uid,
    stringOrNull(user.email),
    stringOrNull(user.name),
    stringOrNull(user.picture),
    nowIso()
  );
}

async function getCurrentUserContext(db, user) {
  await upsertAuthUserRow(db, user);
  const rows = await all(
    db,
    `
      SELECT
        u.uid,
        u.email,
        u.display_name,
        u.full_name,
        u.sso_number,
        u.photo_url,
        u.last_plant_id,
        u.requested_plant_ids_json,
        u.profile_onboarding_json,
        u.global_lifetime_xp,
        pm.plant_id,
        pm.role,
        pm.is_active,
        pm.permissions_json,
        p.name AS plant_name
      FROM users u
      LEFT JOIN plant_members pm ON pm.uid = u.uid AND pm.is_active = 1
      LEFT JOIN plants p ON p.plant_id = pm.plant_id
      WHERE u.uid = ?
      ORDER BY p.name COLLATE NOCASE
    `,
    user.uid
  );
  return jsonResponse({
    auth: user,
    ...serializeUserContextRows(rows)
  });
}

async function updateCurrentUserContext(db, user, patch = {}) {
  await upsertAuthUserRow(db, user);
  const updates = [];
  const values = [];

  if (Object.prototype.hasOwnProperty.call(patch, 'lastPlantId')) {
    updates.push('last_plant_id = ?');
    values.push(stringOrNull(patch.lastPlantId));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'displayName')) {
    updates.push('display_name = ?');
    values.push(stringOrNull(patch.displayName));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'fullName')) {
    updates.push('full_name = ?');
    values.push(stringOrNull(patch.fullName));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'ssoNumber')) {
    updates.push('sso_number = ?');
    values.push(stringOrNull(patch.ssoNumber));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'requestedPlantIds')) {
    updates.push('requested_plant_ids_json = ?');
    values.push(jsonOrNull(Array.isArray(patch.requestedPlantIds) ? patch.requestedPlantIds : []));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'profileOnboarding')) {
    updates.push('profile_onboarding_json = ?');
    values.push(jsonOrNull(patch.profileOnboarding || null));
  }

  if (updates.length) {
    updates.push('updated_at = ?');
    values.push(nowIso());
    values.push(user.uid);
    await run(db, `UPDATE users SET ${updates.join(', ')} WHERE uid = ?`, ...values);
  }

  return getCurrentUserContext(db, user);
}

async function listPlants(db, user, request) {
  await upsertAuthUserRow(db, user);
  const url = new URL(request.url);
  const activeOnly = url.searchParams.get('active') !== 'false';
  const plants = await all(
    db,
    `
      SELECT *
      FROM plants
      ${activeOnly ? 'WHERE is_active = 1' : ''}
      ORDER BY name COLLATE NOCASE
    `
  );
  return jsonResponse({ plants: plants.map(serializePlant) });
}

async function listPlantMembers(db, request, plantId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const url = new URL(request.url);
  const activeOnly = url.searchParams.get('active') !== 'false';
  const rows = await all(
    db,
    `
      SELECT plant_id, uid, role, is_active, display_name, full_name, sso_number, email,
             permissions_json, alert_category_subscriptions_json, job_role_keys_json, job_feeds_json,
             joined_at, last_seen_at
      FROM plant_members
      WHERE plant_id = ?
      ${activeOnly ? 'AND is_active = 1' : ''}
      ORDER BY COALESCE(full_name, display_name, email, uid) COLLATE NOCASE
    `,
    plantId
  );
  return jsonResponse({
    members: rows.map(row => ({
      uid: row.uid,
      displayName: row.display_name,
      fullName: row.full_name,
      ssoNumber: row.sso_number,
      email: row.email,
      ...serializePlantMember(row)
    }))
  });
}

async function updatePlantMember(db, plantId, uid, body, user) {
  const currentMember = await requirePlantPermission(db, plantId, user, null);
  if (user.uid !== uid) {
    const permissions = parsePermissions(currentMember.permissions_json);
    if (permissions.canManageMembers !== true && currentMember.role !== 'admin') {
      throw Object.assign(new Error('Permission denied'), { status: 403 });
    }
  }
  const updates = [];
  const values = [];
  if (Object.prototype.hasOwnProperty.call(body, 'alertCategorySubscriptions')) {
    updates.push('alert_category_subscriptions_json = ?');
    values.push(jsonOrNull(Array.isArray(body.alertCategorySubscriptions) ? body.alertCategorySubscriptions : []));
  }
  if (Object.prototype.hasOwnProperty.call(body, 'jobRoleKeys')) {
    updates.push('job_role_keys_json = ?');
    values.push(jsonOrNull(Array.isArray(body.jobRoleKeys) ? body.jobRoleKeys : []));
  }
  if (Object.prototype.hasOwnProperty.call(body, 'jobFeeds')) {
    updates.push('job_feeds_json = ?');
    values.push(jsonOrNull(Array.isArray(body.jobFeeds) ? body.jobFeeds : []));
  }
  if (!updates.length) {
    const row = await first(
      db,
      `
        SELECT plant_id, uid, role, is_active, display_name, full_name, sso_number, email,
               permissions_json, alert_category_subscriptions_json, job_role_keys_json, job_feeds_json,
               joined_at, last_seen_at
        FROM plant_members
        WHERE plant_id = ? AND uid = ?
        LIMIT 1
      `,
      plantId,
      uid
    );
    return jsonResponse({
      member: row ? {
        uid: row.uid,
        displayName: row.display_name,
        fullName: row.full_name,
        ssoNumber: row.sso_number,
        email: row.email,
        ...serializePlantMember(row)
      } : null
    });
  }
  values.push(plantId, uid);
  await run(db, `UPDATE plant_members SET ${updates.join(', ')} WHERE plant_id = ? AND uid = ?`, ...values);
  const saved = await first(
    db,
    `
      SELECT plant_id, uid, role, is_active, display_name, full_name, sso_number, email,
             permissions_json, alert_category_subscriptions_json, job_role_keys_json, job_feeds_json,
             joined_at, last_seen_at
      FROM plant_members
      WHERE plant_id = ? AND uid = ?
      LIMIT 1
    `,
    plantId,
    uid
  );
  return jsonResponse({
    member: saved ? {
      uid: saved.uid,
      displayName: saved.display_name,
      fullName: saved.full_name,
      ssoNumber: saved.sso_number,
      email: saved.email,
      ...serializePlantMember(saved)
    } : null
  });
}

async function listRoleAlerts(db, request, plantId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 80));
  const includeDismissed = url.searchParams.get('includeDismissed') === 'true';
  const alerts = await all(
    db,
    `
      SELECT *
      FROM role_feed_alerts
      WHERE plant_id = ?
        AND EXISTS (
          SELECT 1
          FROM json_each(COALESCE(recipient_user_ids_json, '[]'))
          WHERE value = ?
        )
        ${includeDismissed ? '' : 'AND is_resolved = 0'}
      ORDER BY created_at DESC
      LIMIT ?
    `,
    plantId,
    user.uid,
    limit
  );
  return jsonResponse({ alerts: alerts.map(serializeRoleFeedAlert) });
}

async function createRoleAlert(db, plantId, body, user) {
  await requirePlantPermission(db, plantId, user, body.permissionName || 'canEditIssue');
  const alertId = stringOrNull(body.alertId) || `alert_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = asIso(body.createdAt, nowIso());
  const updatedAt = asIso(body.updatedAt, createdAt);
  const recipientUserIds = Array.from(new Set((Array.isArray(body.recipientUserIds) ? body.recipientUserIds : []).map(v => String(v || '').trim()).filter(Boolean)));
  await run(
    db,
    `
      INSERT INTO role_feed_alerts (
        alert_id, plant_id, issue_id, status_key, subcategory_key, title, body, is_resolved,
        created_at, updated_at, category_key, category_keys_json, workflow_id, feed_key, feed_label,
        recipient_user_ids_json, required_job_role_keys_json, created_by_json, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(alert_id) DO UPDATE SET
        issue_id = excluded.issue_id,
        status_key = excluded.status_key,
        subcategory_key = excluded.subcategory_key,
        title = excluded.title,
        body = excluded.body,
        is_resolved = excluded.is_resolved,
        updated_at = excluded.updated_at,
        category_key = excluded.category_key,
        category_keys_json = excluded.category_keys_json,
        workflow_id = excluded.workflow_id,
        feed_key = excluded.feed_key,
        feed_label = excluded.feed_label,
        recipient_user_ids_json = excluded.recipient_user_ids_json,
        required_job_role_keys_json = excluded.required_job_role_keys_json,
        created_by_json = excluded.created_by_json,
        raw_json = excluded.raw_json
    `,
    alertId,
    plantId,
    stringOrNull(body.issueId),
    stringOrNull(body.statusKey),
    stringOrNull(body.subcategoryKey || body.subStatus),
    stringOrNull(body.title || body.feedLabel),
    stringOrNull(body.body || body.note),
    body.isResolved ? 1 : 0,
    createdAt,
    updatedAt,
    stringOrNull(body.categoryKey),
    jsonOrNull(body.categoryKeys || null),
    stringOrNull(body.workflowId),
    stringOrNull(body.feedKey),
    stringOrNull(body.feedLabel),
    jsonOrNull(recipientUserIds),
    jsonOrNull(body.requiredJobRoleKeys || null),
    jsonOrNull(body.createdBy || null),
    jsonOrNull(body.raw || body || null)
  );
  const alert = await first(db, 'SELECT * FROM role_feed_alerts WHERE plant_id = ? AND alert_id = ? LIMIT 1', plantId, alertId);
  return jsonResponse({ alert: serializeRoleFeedAlert(alert) });
}

async function updateRoleAlert(db, plantId, alertId, body, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const alert = await first(db, 'SELECT * FROM role_feed_alerts WHERE plant_id = ? AND alert_id = ? LIMIT 1', plantId, alertId);
  if (!alert) {
    return jsonResponse({ error: 'Role alert not found' }, { status: 404 });
  }
  const nextRecipients = Object.prototype.hasOwnProperty.call(body, 'recipientUserIds')
    ? Array.from(new Set((Array.isArray(body.recipientUserIds) ? body.recipientUserIds : []).map(v => String(v || '').trim()).filter(Boolean)))
    : JSON.parse(alert.recipient_user_ids_json || '[]');
  await run(
    db,
    `
      UPDATE role_feed_alerts
      SET recipient_user_ids_json = ?,
          is_resolved = ?,
          updated_at = ?
      WHERE plant_id = ? AND alert_id = ?
    `,
    jsonOrNull(nextRecipients),
    body.isResolved ? 1 : Number(alert.is_resolved || 0),
    nowIso(),
    plantId,
    alertId
  );
  const saved = await first(db, 'SELECT * FROM role_feed_alerts WHERE plant_id = ? AND alert_id = ? LIMIT 1', plantId, alertId);
  return jsonResponse({ alert: serializeRoleFeedAlert(saved) });
}

async function getGamificationState(db, plantId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const [configRow, statsRow, badgesRow, leaderboardRow, missionRows, progressRows, userRow] = await Promise.all([
    first(db, 'SELECT * FROM gamification_config WHERE plant_id = ? LIMIT 1', plantId),
    first(db, 'SELECT * FROM user_game_stats WHERE plant_id = ? AND uid = ? LIMIT 1', plantId, user.uid),
    first(db, 'SELECT * FROM user_badges WHERE plant_id = ? AND uid = ? LIMIT 1', plantId, user.uid),
    first(db, 'SELECT * FROM game_leaderboards WHERE plant_id = ? AND board_id = ? LIMIT 1', plantId, 'weekly'),
    all(db, 'SELECT * FROM game_missions WHERE plant_id = ? AND is_active = 1 ORDER BY starts_at DESC LIMIT 6', plantId),
    all(db, 'SELECT * FROM game_mission_progress WHERE plant_id = ? AND subject_id = ?', plantId, user.uid),
    first(db, 'SELECT global_lifetime_xp FROM users WHERE uid = ? LIMIT 1', user.uid)
  ]);
  const progressByMissionId = new Map(progressRows.map(row => [row.mission_id, serializeGameMissionProgress(row)]));
  return jsonResponse({
    config: serializeGamificationConfig(configRow),
    stats: serializeUserGameStats(statsRow),
    badges: serializeUserBadges(badgesRow),
    leaderboard: serializeGameLeaderboard(leaderboardRow),
    user: {
      uid: user.uid,
      globalLifetimeXp: Number(userRow?.global_lifetime_xp || 0)
    },
    missions: missionRows.map(row => ({
      ...serializeGameMission(row),
      progress: progressByMissionId.get(row.mission_id) || null
    }))
  });
}

async function awardGamification(db, plantId, body, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const reason = stringOrNull(body.reason);
  if (!reason) throw Object.assign(new Error('Missing gamification reason.'), { status: 400 });
  const context = body.context && typeof body.context === 'object' ? body.context : {};
  const configRow = await first(db, 'SELECT * FROM gamification_config WHERE plant_id = ? LIMIT 1', plantId);
  const gameConfig = serializeGamificationConfig(configRow)?.config || {};
  if (gameConfig.enabled === false) {
    return jsonResponse({ awarded: false, reason: 'disabled' });
  }
  const weights = gameConfig.weights || {};
  const penalties = gameConfig.penalties || {};
  const base = Number(weights[reason] || penalties[reason] || 0);
  const tags = Array.isArray(context.tags) ? context.tags.map(v => String(v || '').trim()).filter(Boolean) : [];
  const customRules = Array.isArray(gameConfig.customRules) ? gameConfig.customRules : [];
  const matchingCustomRules = customRules.filter(rule => {
    if (rule?.isEnabled === false) return false;
    const trigger = String(rule?.triggerKey || '').trim();
    if (!trigger) return false;
    return trigger === reason || tags.includes(trigger);
  });
  const customDelta = matchingCustomRules.reduce((sum, rule) => sum + Number(rule?.points || 0), 0);
  const totalDelta = base + customDelta;
  if (!totalDelta) {
    return jsonResponse({ awarded: false, reason: 'no_delta' });
  }
  const issueId = stringOrNull(context.issueId) || 'none';
  const dedupeKey = `${user.uid}:${issueId}:${reason}:${String(context.dedupeSuffix || '')}`;
  const existingEvent = await first(db, 'SELECT game_event_id FROM game_events WHERE plant_id = ? AND dedupe_key = ? LIMIT 1', plantId, dedupeKey);
  if (existingEvent) {
    const currentResponse = await getGamificationState(db, plantId, user);
    const currentPayload = await currentResponse.json();
    return jsonResponse({
      ...currentPayload,
      awardSummary: { awarded: false, reason: 'deduped', totalDelta: 0, badges: [], missionsCompleted: [] }
    });
  }

  const now = nowIso();
  const eventId = `ge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const [statsRow, badgesRow, missionRows, progressRows, leaderboardExisting] = await Promise.all([
    first(db, 'SELECT * FROM user_game_stats WHERE plant_id = ? AND uid = ? LIMIT 1', plantId, user.uid),
    first(db, 'SELECT * FROM user_badges WHERE plant_id = ? AND uid = ? LIMIT 1', plantId, user.uid),
    all(db, 'SELECT * FROM game_missions WHERE plant_id = ? AND is_active = 1 ORDER BY starts_at DESC LIMIT 6', plantId),
    all(db, 'SELECT * FROM game_mission_progress WHERE plant_id = ? AND subject_id = ?', plantId, user.uid),
    first(db, 'SELECT * FROM game_leaderboards WHERE plant_id = ? AND board_id = ? LIMIT 1', plantId, 'weekly')
  ]);
  const currentTotals = statsRow ? JSON.parse(statsRow.totals_json || '{}') : {};
  const currentStreaks = statsRow ? JSON.parse(statsRow.streaks_json || '{}') : {};
  const earnedBadges = badgesRow ? JSON.parse(badgesRow.earned_badges_json || '{}') : {};
  const nextTotals = { ...currentTotals, xp: Number(currentTotals.xp || 0) + totalDelta };
  if (reason === 'issue_resolved') nextTotals.issuesResolved = Number(currentTotals.issuesResolved || 0) + 1;
  if (reason === 'issue_created_complete') nextTotals.issuesCreated = Number(currentTotals.issuesCreated || 0) + 1;
  if (reason === 'photo_attached') nextTotals.photosAttached = Number(currentTotals.photosAttached || 0) + 1;
  if (reason === 'serial_captured_when_required') nextTotals.serialsCaptured = Number(currentTotals.serialsCaptured || 0) + 1;
  const nextStreaks = { ...currentStreaks, current: Number(currentStreaks.current || 0) + (totalDelta > 0 ? 1 : 0) };
  nextTotals.level = gameLevelFromXp(nextTotals.xp);

  const progressByMissionId = new Map(progressRows.map(row => [row.mission_id, row]));
  const missionProgressUpserts = [];
  const completedMissionIds = [];
  for (const missionRow of missionRows) {
    const mission = serializeGameMission(missionRow);
    if (!missionReasonMatches(mission, reason)) continue;
    const threshold = Math.max(1, Number(mission?.objective?.threshold || 1));
    const prev = progressByMissionId.get(missionRow.mission_id);
    const current = Number(prev?.current_value || 0);
    const next = Math.min(threshold, current + 1);
    const completed = next >= threshold;
    const percent = Math.round((next / threshold) * 100);
    if (completed && !Number(prev?.completed || 0)) {
      completedMissionIds.push(missionRow.mission_id);
      nextTotals.missionsCompleted = Number(nextTotals.missionsCompleted || 0) + 1;
    }
    missionProgressUpserts.push({
      missionProgressRowId: prev?.mission_progress_row_id || `${plantId}:${missionRow.mission_id}:${user.uid}`,
      missionId: missionRow.mission_id,
      currentValue: next,
      targetValue: threshold,
      percent,
      completed,
      rawJson: {
        subjectId: user.uid,
        subjectType: prev?.subject_type || 'user',
        current: next,
        target: threshold,
        percent,
        completed
      }
    });
  }

  const workingStats = {
    totals: { ...nextTotals },
    streaks: { ...nextStreaks }
  };
  const badgeDefs = Array.isArray(gameConfig.badges) && gameConfig.badges.length ? gameConfig.badges : DEFAULT_BADGE_DEFS;
  const newlyEarnedBadges = [];
  for (const badge of badgeDefs.filter(entry => entry?.isEnabled !== false)) {
    if (!badge?.id || earnedBadges[badge.id]) continue;
    if (!checkBadgeTrigger(badge, workingStats)) continue;
    earnedBadges[badge.id] = {
      earnedAt: now,
      badgeName: badge.name || badge.id,
      icon: badge.icon || '🏅'
    };
    newlyEarnedBadges.push({
      id: badge.id,
      name: badge.name || badge.id,
      icon: badge.icon || '🏅',
      description: badge.description || '',
      xpReward: Number(badge.xpReward || 0)
    });
    if (Number(badge.xpReward || 0) > 0) {
      workingStats.totals.xp = Number(workingStats.totals.xp || 0) + Number(badge.xpReward || 0);
    }
  }
  workingStats.totals.level = gameLevelFromXp(workingStats.totals.xp);
  const bonusXp = newlyEarnedBadges.reduce((sum, badge) => sum + Number(badge.xpReward || 0), 0);

  const leaderboardRowId = `${plantId}:weekly`;
  const entriesByUid = leaderboardExisting ? JSON.parse(leaderboardExisting.entries_by_uid_json || '{}') : {};
  entriesByUid[user.uid] = {
    uid: user.uid,
    displayName: user.name,
    xp: Number(workingStats.totals.xp || 0),
    updatedAt: now
  };
  const entries = Object.values(entriesByUid).sort((a, b) => Number(b?.xp || 0) - Number(a?.xp || 0));

  const statements = [
    db.prepare(`
      INSERT INTO game_events (game_event_id, plant_id, uid, type, xp_delta, dedupe_key, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(eventId, plantId, user.uid, 'xp_awarded', totalDelta, dedupeKey, jsonOrNull({
      reason,
      issueId,
      tags,
      delta: { xp: totalDelta, baseXp: base, customXp: customDelta },
      appliedRules: matchingCustomRules.map(rule => ({ id: rule?.id || '', label: rule?.label || '', triggerKey: rule?.triggerKey || '', points: Number(rule?.points || 0) })),
      badges: newlyEarnedBadges.map(badge => badge.id),
      missionsCompleted: completedMissionIds
    }), now),
    db.prepare(`
      INSERT INTO user_game_stats (plant_id, uid, totals_json, updated_at, user_id, display_name, streaks_json, last_event_at, schema_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plant_id, uid) DO UPDATE SET
        totals_json = excluded.totals_json,
        updated_at = excluded.updated_at,
        user_id = excluded.user_id,
        display_name = excluded.display_name,
        streaks_json = excluded.streaks_json,
        last_event_at = excluded.last_event_at,
        schema_version = excluded.schema_version
    `).bind(plantId, user.uid, jsonOrNull(workingStats.totals), now, user.uid, user.name, jsonOrNull(workingStats.streaks), now, 1),
    db.prepare(`
      INSERT INTO user_badges (plant_id, uid, earned_badges_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(plant_id, uid) DO UPDATE SET
        earned_badges_json = excluded.earned_badges_json,
        updated_at = excluded.updated_at
    `).bind(plantId, user.uid, jsonOrNull(earnedBadges), now),
    db.prepare(`
      UPDATE users
      SET global_lifetime_xp = COALESCE(global_lifetime_xp, 0) + ?,
          updated_at = ?
      WHERE uid = ?
    `).bind(totalDelta + bonusXp, now, user.uid),
    db.prepare(`
      INSERT INTO game_leaderboards (leaderboard_row_id, plant_id, board_id, entries_json, entries_by_uid_json, updated_at, schema_version)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plant_id, board_id) DO UPDATE SET
        entries_json = excluded.entries_json,
        entries_by_uid_json = excluded.entries_by_uid_json,
        updated_at = excluded.updated_at,
        schema_version = excluded.schema_version
    `).bind(leaderboardRowId, plantId, 'weekly', jsonOrNull(entries), jsonOrNull(entriesByUid), now, 1),
    ...missionProgressUpserts.map(progress => db.prepare(`
      INSERT INTO game_mission_progress (
        mission_progress_row_id, plant_id, mission_id, subject_id, subject_type,
        current_value, target_value, percent, completed, updated_at, raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plant_id, mission_id, subject_id) DO UPDATE SET
        current_value = excluded.current_value,
        target_value = excluded.target_value,
        percent = excluded.percent,
        completed = excluded.completed,
        updated_at = excluded.updated_at,
        raw_json = excluded.raw_json
    `).bind(
      progress.missionProgressRowId,
      plantId,
      progress.missionId,
      user.uid,
      'user',
      progress.currentValue,
      progress.targetValue,
      progress.percent,
      progress.completed ? 1 : 0,
      now,
      jsonOrNull(progress.rawJson)
    ))
  ];
  await db.batch(statements);
  const response = await getGamificationState(db, plantId, user);
  const payload = await response.json();
  return jsonResponse({
    ...payload,
    awardSummary: {
      awarded: true,
      reason,
      totalDelta,
      badges: newlyEarnedBadges,
      missionsCompleted: completedMissionIds
    }
  });
}

async function getPlantBootstrap(db, plantId, user) {
  const member = await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const [plant, statuses, presses, game] = await Promise.all([
    first(db, 'SELECT * FROM plants WHERE plant_id = ? LIMIT 1', plantId),
    first(db, 'SELECT * FROM plant_status_config WHERE plant_id = ? LIMIT 1', plantId),
    first(db, 'SELECT * FROM plant_press_config WHERE plant_id = ? LIMIT 1', plantId),
    first(db, 'SELECT * FROM gamification_config WHERE plant_id = ? LIMIT 1', plantId)
  ]);
  return jsonResponse({
    plant: serializePlant(plant),
    member: serializePlantMember(member),
    statusConfig: serializeStatusConfig(statuses),
    pressConfig: serializePressConfig(presses),
    gamificationConfig: serializeGamificationConfig(game)
  });
}

async function listIssues(db, request, plantId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 250));
  const issues = await all(
    db,
    `
      SELECT *
      FROM issues
      WHERE plant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    plantId,
    limit
  );
  return jsonResponse({ issues: issues.map(serializeIssue) });
}

async function getIssue(db, plantId, issueId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const issue = await first(
    db,
    `
      SELECT *
      FROM issues
      WHERE plant_id = ? AND issue_id = ?
      LIMIT 1
    `,
    plantId,
    issueId
  );
  if (!issue) {
    return jsonResponse({ error: 'Issue not found' }, { status: 404 });
  }
  return jsonResponse({ issue: serializeIssue(issue) });
}

async function listIssueEvents(db, plantId, issueId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const events = await all(
    db,
    `
      SELECT *
      FROM issue_events
      WHERE plant_id = ? AND issue_id = ?
      ORDER BY event_at ASC, created_at ASC
    `,
    plantId,
    issueId
  );
  return jsonResponse({ events: events.map(serializeIssueEvent) });
}

async function listIssueAttachments(db, plantId, issueId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const attachments = await all(
    db,
    `
      SELECT *
      FROM issue_attachments
      WHERE plant_id = ? AND issue_id = ?
      ORDER BY uploaded_at DESC
    `,
    plantId,
    issueId
  );
  return jsonResponse({ attachments: attachments.map(serializeIssueAttachment) });
}

export async function handleD1ApiRequest(request, env, { authenticateRequest } = {}) {
  const url = new URL(request.url);
  const db = getDb(env);

  try {
    const meMatch = request.method === 'GET' && url.pathname === '/api/me';
    const meUpdateMatch = request.method === 'PATCH' && url.pathname === '/api/me';
    const plantsListMatch = request.method === 'GET' && url.pathname === '/api/plants';
    const bootstrapMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/bootstrap$/);
    const plantMembersMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/members$/);
    const plantMemberUpdateMatch = request.method === 'PATCH' && url.pathname.match(/^\/api\/plants\/([^/]+)\/members\/([^/]+)$/);
    const gamificationMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/gamification$/);
    const gamificationAwardMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/gamification\/award$/);
    const roleAlertsMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/role-alerts$/);
    const roleAlertCreateMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/role-alerts$/);
    const roleAlertUpdateMatch = request.method === 'PATCH' && url.pathname.match(/^\/api\/plants\/([^/]+)\/role-alerts\/([^/]+)$/);
    const issuesMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues$/);
    const issueCreateMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues$/);
    const issueMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)$/);
    const issueUpdateMatch = request.method === 'PATCH' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)$/);
    const issueDeleteMatch = request.method === 'DELETE' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)$/);
    const eventsMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)\/events$/);
    const attachmentsMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)\/attachments$/);

    if (!meMatch && !meUpdateMatch && !plantsListMatch && !bootstrapMatch && !plantMembersMatch && !plantMemberUpdateMatch && !gamificationMatch && !gamificationAwardMatch && !roleAlertsMatch && !roleAlertCreateMatch && !roleAlertUpdateMatch && !issuesMatch && !issueCreateMatch && !issueMatch && !issueUpdateMatch && !issueDeleteMatch && !eventsMatch && !attachmentsMatch) {
      return null;
    }

    if (typeof authenticateRequest !== 'function') {
      throw Object.assign(new Error('D1 API authentication handler is not configured.'), { status: 500 });
    }
    const user = normalizeAuthUser(await authenticateRequest(request, env));

    if (meMatch) {
      return getCurrentUserContext(db, user);
    }
    if (meUpdateMatch) {
      return updateCurrentUserContext(db, user, await request.json());
    }
    if (plantsListMatch) {
      return listPlants(db, user, request);
    }
    if (bootstrapMatch) {
      return getPlantBootstrap(db, decodePathSegment(bootstrapMatch[1]), user);
    }
    if (plantMembersMatch) {
      return listPlantMembers(db, request, decodePathSegment(plantMembersMatch[1]), user);
    }
    if (plantMemberUpdateMatch) {
      return updatePlantMember(db, decodePathSegment(plantMemberUpdateMatch[1]), decodePathSegment(plantMemberUpdateMatch[2]), await request.json(), user);
    }
    if (gamificationMatch) {
      return getGamificationState(db, decodePathSegment(gamificationMatch[1]), user);
    }
    if (gamificationAwardMatch) {
      return awardGamification(db, decodePathSegment(gamificationAwardMatch[1]), await request.json(), user);
    }
    if (roleAlertsMatch) {
      return listRoleAlerts(db, request, decodePathSegment(roleAlertsMatch[1]), user);
    }
    if (roleAlertCreateMatch) {
      return createRoleAlert(db, decodePathSegment(roleAlertCreateMatch[1]), await request.json(), user);
    }
    if (roleAlertUpdateMatch) {
      return updateRoleAlert(db, decodePathSegment(roleAlertUpdateMatch[1]), decodePathSegment(roleAlertUpdateMatch[2]), await request.json(), user);
    }
    if (issuesMatch) {
      return listIssues(db, request, decodePathSegment(issuesMatch[1]), user);
    }
    if (issueCreateMatch) {
      return upsertIssueWriteBundle(db, decodePathSegment(issueCreateMatch[1]), await request.json(), user);
    }
    if (issueMatch) {
      return getIssue(db, decodePathSegment(issueMatch[1]), decodePathSegment(issueMatch[2]), user);
    }
    if (issueUpdateMatch) {
      return upsertIssueWriteBundle(
        db,
        decodePathSegment(issueUpdateMatch[1]),
        {
          ...(await request.json()),
          issueId: decodePathSegment(issueUpdateMatch[2])
        },
        user
      );
    }
    if (issueDeleteMatch) {
      return deleteIssue(db, decodePathSegment(issueDeleteMatch[1]), decodePathSegment(issueDeleteMatch[2]), user);
    }
    if (eventsMatch) {
      return listIssueEvents(db, decodePathSegment(eventsMatch[1]), decodePathSegment(eventsMatch[2]), user);
    }
    if (attachmentsMatch) {
      return listIssueAttachments(db, decodePathSegment(attachmentsMatch[1]), decodePathSegment(attachmentsMatch[2]), user);
    }
    return null;
  } catch (error) {
    return errorResponse(error);
  }
}
