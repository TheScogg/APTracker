import {
  serializeGamificationConfig,
  serializeIssue,
  serializeIssueAttachment,
  serializeIssueEvent,
  serializePlant,
  serializePlantMember,
  serializePressConfig,
  serializeStatusConfig,
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

async function getCurrentUserContext(db, user) {
  const rows = await all(
    db,
    `
      SELECT
        u.uid,
        u.email,
        u.display_name,
        u.photo_url,
        u.last_plant_id,
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
    const bootstrapMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/bootstrap$/);
    const issuesMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues$/);
    const issueCreateMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues$/);
    const issueMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)$/);
    const issueUpdateMatch = request.method === 'PATCH' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)$/);
    const issueDeleteMatch = request.method === 'DELETE' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)$/);
    const eventsMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)\/events$/);
    const attachmentsMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)\/attachments$/);

    if (!meMatch && !bootstrapMatch && !issuesMatch && !issueCreateMatch && !issueMatch && !issueUpdateMatch && !issueDeleteMatch && !eventsMatch && !attachmentsMatch) {
      return null;
    }

    if (typeof authenticateRequest !== 'function') {
      throw Object.assign(new Error('D1 API authentication handler is not configured.'), { status: 500 });
    }
    const user = normalizeAuthUser(await authenticateRequest(request, env));

    if (meMatch) {
      return getCurrentUserContext(db, user);
    }
    if (bootstrapMatch) {
      return getPlantBootstrap(db, decodePathSegment(bootstrapMatch[1]), user);
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
