import {
  serializeConversation,
  serializeConversationMessage,
  serializeDailySchedule,
  serializeDailyScheduleRow,
  serializeGamificationConfig,
  serializeGameLeaderboard,
  serializeGameMission,
  serializeGameMissionProgress,
  serializeIssue,
  serializeIssueAttachment,
  serializeIssueEvent,
  serializeNote,
  serializeNoteAttachment,
  serializePlant,
  serializePlantMember,
  serializePressConfig,
  serializePlantStoreConfig,
  serializeRoleAlertRoutingConfig,
  serializeRoleFeedAlert,
  serializeStatusConfig,
  serializeUserBadges,
  serializeUserGameStats,
  serializeUserContextRows,
  serializeWikiAttachment,
  serializeWikiPage,
  serializeWikiRevision,
  serializeTodo
} from '../api/src/serializers.js';

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

function slugForId(value, fallback = 'item') {
  return String(value || '').trim().toLowerCase()
    .replace(/\./g, '_')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;
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

function scheduleIssueId(scheduleDate, section, rowId) {
  return `schedule_${slugForId(scheduleDate)}_${slugForId(section)}_${slugForId(rowId)}`;
}

function scheduleShiftStartTime(shift) {
  const normalized = String(shift || '').trim().toLowerCase();
  if (normalized === '2' || normalized === 'second') return '13:54:00';
  if (normalized === '3' || normalized === 'third') return '21:54:00';
  return '05:54:00';
}

function scheduleIssueDate(scheduleDate, shift) {
  // Schedule rows contain wall-clock shift times. Workers run in UTC, so parsing
  // a time without an offset made a 5:54 AM first-shift change display as
  // 1:54 AM in the Kentucky plant UI during daylight saving time.
  const timeZone = 'America/Kentucky/Louisville';
  const wallClockMillis = Date.parse(`${scheduleDate}T${scheduleShiftStartTime(shift)}Z`);
  if (!Number.isFinite(wallClockMillis)) return new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(wallClockMillis));
  const values = Object.fromEntries(parts
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
  const renderedMillis = Date.UTC(
    values.year, values.month - 1, values.day,
    values.hour, values.minute, values.second
  );
  const utcOffsetMillis = renderedMillis - wallClockMillis;
  return new Date(wallClockMillis - utcOffsetMillis);
}

function formatScheduleIssueDateTime(scheduleDate, shift) {
  const date = scheduleIssueDate(scheduleDate, shift);
  const options = { timeZone: 'America/Kentucky/Louisville' };
  return date.toLocaleDateString('en-US', { ...options, month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
    date.toLocaleTimeString('en-US', { ...options, hour: 'numeric', minute: '2-digit', hour12: true });
}

function classifyScheduleChange(row) {
  const text = [row?.description, row?.notes, row?.partNumber, row?.mc].map(value => String(value || '')).join(' ').toLowerCase();
  if (/\bc\s*\/\s*c\b|\bcolou?r\s+change\b/.test(text)) {
    return { statusKey: 'controlman', subStatus: 'Color Change' };
  }
  if (/\bm\s*\/\s*c\b|\bmold\s+change\b/.test(text)) {
    return { statusKey: 'controlman', subStatus: 'Mold Change' };
  }
  if (/\b(colou?r|purge|colorant|masterbatch)\b/.test(text)) {
    return { statusKey: 'startup', subStatus: 'Purging / Color Change' };
  }
  return { statusKey: 'controlman', subStatus: 'Mold Change' };
}

function buildScheduleImportIssue(plantId, scheduleDate, shift, row) {
  const actor = { uid: 'schedule-import', name: 'Schedule Import' };
  const machineCode = String(row?.press || '').trim();
  const { statusKey, subStatus } = classifyScheduleChange(row);
  const issueShift = row?.shift || shift || 1;
  const dateTime = formatScheduleIssueDateTime(scheduleDate, issueShift);
  const createdDate = scheduleIssueDate(scheduleDate, issueShift);
  const workflowId = `wf_schedule_${slugForId(scheduleDate)}_${slugForId(row?.section)}_${slugForId(row?.rowId)}`;
  const note = [
    `${subStatus} from schedule import.`,
    row?.partNumber ? `Part: ${row.partNumber}` : '',
    row?.description ? `Description: ${row.description}` : '',
    row?.cavity ? `Cavity: ${row.cavity}` : '',
    row?.notes ? `Notes: ${row.notes}` : '',
    row?.section ? `Section: ${row.section}` : ''
  ].filter(Boolean).join('\n');

  return {
    issueId: scheduleIssueId(scheduleDate, row?.section, row?.rowId),
    issue: {
      machine: machineCode,
      machineCode,
      plantId,
      pressId: machineCode ? `press_${slugForId(machineCode, 'unknown')}` : null,
      rowId: (() => {
        const match = machineCode.match(/^(\d+)/);
        return match ? `row_${String(match[1]).padStart(2, '0')}` : 'row_other';
      })(),
      note,
      dateTime,
      dateKey: scheduleDate,
      timestamp: createdDate.getTime(),
      shift: String(issueShift),
      timer: null,
      userId: actor.uid,
      userName: actor.name,
      photoCount: 0,
      statusHistory: [{
        status: statusKey,
        subStatus,
        note: '',
        dateTime,
        by: actor.name,
        workflowId
      }],
      workflowStateByEntry: { [workflowId]: null },
      schemaVersion: 2,
      currentStatus: {
        statusKey,
        subStatusKey: subStatus,
        label: statusKey === 'startup' ? 'Startup' : (statusKey === 'controlman' ? 'Controlman' : 'Open'),
        subLabel: subStatus,
        color: statusKey === 'startup' ? '#14b8a6' : (statusKey === 'controlman' ? '#38bdf8' : '#ef4444'),
        enteredAt: createdDate.toISOString(),
        enteredDateTime: dateTime,
        enteredBy: actor,
        notePreview: note
      },
      lifecycle: {
        isOpen: true,
        isResolved: false,
        openedAt: createdDate.toISOString(),
        resolvedAt: null,
        closedAt: null,
        reopenedCount: 0
      },
      scheduleImport: {
        date: scheduleDate,
        section: row?.section || '',
        rowId: row?.rowId || '',
        partNumber: row?.partNumber || '',
        description: row?.description || '',
        notes: row?.notes || '',
        isChange: true
      },
      source: {
        type: 'schedule_import',
        scheduleDate,
        scheduleSection: row?.section || '',
        scheduleRowId: row?.rowId || ''
      },
      createdAt: createdDate.toISOString(),
      createdBy: actor,
      updatedAt: createdDate.toISOString(),
      updatedBy: actor
    },
    events: [
      {
        eventId: `${scheduleIssueId(scheduleDate, row?.section, row?.rowId)}:created`,
        eventType: 'issue_created',
        eventAt: createdDate.toISOString(),
        actorUid: actor.uid,
        actorName: actor.name,
        payload: {
          machineCode,
          note,
          initialStatusKey: statusKey,
          initialSubStatusKey: subStatus,
          source: {
            type: 'schedule_import',
            scheduleDate,
            scheduleSection: row?.section || '',
            scheduleRowId: row?.rowId || ''
          }
        }
      },
      {
        eventId: `${scheduleIssueId(scheduleDate, row?.section, row?.rowId)}:status_changed`,
        eventType: 'status_changed',
        eventAt: createdDate.toISOString(),
        actorUid: actor.uid,
        actorName: actor.name,
        payload: {
          fromStatusKey: null,
          fromSubStatusKey: null,
          toStatusKey: statusKey,
          toSubStatusKey: subStatus,
          note: ''
        }
      }
    ]
  };
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
  const timer = issue.timer && typeof issue.timer === 'object' ? issue.timer : null;
  const timerNotificationDelivery = timer?.notificationDelivery && typeof timer.notificationDelivery === 'object'
    ? { ...timer.notificationDelivery }
    : {};
  if (timer) {
    timerNotificationDelivery.__pauseMeta = {
      paused: Boolean(timer.paused),
      pausedAtMs: timer.pausedAtMs == null ? null : Number(timer.pausedAtMs),
      pausedRemainingMs: timer.pausedRemainingMs == null ? null : Number(timer.pausedRemainingMs)
    };
  }
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
    workflow_state_by_entry_history_json: jsonString(issue.workflowStateByEntryHistory || null),
    workflow_state_by_status_json: jsonString(issue.workflowStateByStatus || null),
    workflow_state_by_status_history_json: jsonString(issue.workflowStateByStatusHistory || null),
    workflow_state_history_json: jsonString(issue.workflowStateHistory || null),
    legacy_status_history_json: jsonString(Array.isArray(issue.statusHistory) ? issue.statusHistory : []),
    quality_defect_json: jsonString(issue.qualityDefect || null),
    solution_current_json: jsonString(issue.solution || null),
    latest_note_preview: stringOrNull(currentStatus.notePreview || issue.note),
    tags_json: jsonString(Array.isArray(issue.tags) ? issue.tags : []),
    photo_count: numberOrZero(issue.photoCount || issue.photos?.length),
    created_by_uid: stringOrNull(issue.createdBy?.uid || issue.userId),
    created_by_name: stringOrNull(issue.createdBy?.name || issue.userName),
    updated_by_uid: stringOrNull(issue.updatedBy?.uid),
    updated_by_name: stringOrNull(issue.updatedBy?.name || issue.editedBy),
    timer_enabled: asBoolInt(timer?.enabled),
    timer_started_at: asIso(timer?.startedAt || timer?.startedAtMs),
    timer_due_at: asIso(timer?.dueAt || timer?.dueAtMs),
    timer_due_at_ms: numberOrNull(timer?.dueAtMs),
    timer_duration_minutes: numberOrNull(timer?.durationMinutes ?? timer?.minutes),
    timer_notification_status: stringOrNull(timer?.notificationStatus),
    timer_notification_owner_uid: stringOrNull(timer?.notificationOwnerUid),
    timer_notification_requested_by_json: jsonString(timer?.notificationRequestedBy || null),
    timer_notification_delivery_json: jsonString(timer ? timerNotificationDelivery : null),
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
    solution_revision_id: stringOrNull(attachment.solutionRevisionId),
    file_name: stringOrNull(attachment.fileName || attachment.name),
    content_type: stringOrNull(attachment.contentType),
    storage_bucket: stringOrNull(attachment.storageBucket),
    storage_path: stringOrNull(attachment.storagePath),
    thumbnail_path: stringOrNull(attachment.thumbnailPath),
    download_url: stringOrNull(attachment.downloadUrl || attachment.downloadURL || attachment.dataUrl || attachment.url),
    uploaded_by_uid: stringOrNull(attachment.uploadedBy?.uid || attachment.uploadedByUid),
    uploaded_by_name: stringOrNull(attachment.uploadedBy?.name || attachment.uploadedByName),
    taken_at: asIso(attachment.takenAt || attachment.timestamp, null),
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

export async function importDailyScheduleToD1(db, plantId, payload = {}) {
  const scheduleDate = stringOrNull(payload.scheduleDate);
  if (!scheduleDate) {
    throw Object.assign(new Error('Missing scheduleDate.'), { status: 400 });
  }

  const sectionKeys = ['page1', 'page2', 'northBayChanges', 'southBayChanges'];
  const sectionsInput = payload.sections && typeof payload.sections === 'object' ? payload.sections : {};
  const rowsBySection = Object.fromEntries(sectionKeys.map(key => [key, Array.isArray(sectionsInput[key]) ? sectionsInput[key] : []]));
  const now = nowIso();
  const statements = [
    db.prepare(`
      INSERT INTO daily_schedules (
        daily_schedule_row_id, plant_id, schedule_date, shift, line_speed, total_planned_pcs, source_file_name,
        source_file_type, status, notes, page1_count, page2_count, north_bay_changes_count, south_bay_changes_count,
        raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(daily_schedule_row_id) DO UPDATE SET
        shift = excluded.shift,
        line_speed = excluded.line_speed,
        total_planned_pcs = excluded.total_planned_pcs,
        source_file_name = excluded.source_file_name,
        source_file_type = excluded.source_file_type,
        status = excluded.status,
        notes = excluded.notes,
        page1_count = excluded.page1_count,
        page2_count = excluded.page2_count,
        north_bay_changes_count = excluded.north_bay_changes_count,
        south_bay_changes_count = excluded.south_bay_changes_count,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `).bind(
      `${plantId}:${scheduleDate}`,
      plantId,
      scheduleDate,
      stringOrNull(payload.shift),
      payload.lineSpeed == null ? null : String(payload.lineSpeed),
      payload.totalPlannedPcs == null ? null : String(payload.totalPlannedPcs),
      stringOrNull(payload.sourceFileName) || `batch-import-${scheduleDate}`,
      stringOrNull(payload.sourceFileType) || 'application/pdf',
      stringOrNull(payload.status) || 'imported',
      stringOrNull(payload.notes),
      rowsBySection.page1.length,
      rowsBySection.page2.length,
      rowsBySection.northBayChanges.length,
      rowsBySection.southBayChanges.length,
      jsonOrNull({
        scheduleDate,
        plantId,
        shift: payload.shift,
        lineSpeed: payload.lineSpeed,
        totalPlannedPcs: payload.totalPlannedPcs,
        sourceFileName: stringOrNull(payload.sourceFileName) || `batch-import-${scheduleDate}`,
        sourceFileType: stringOrNull(payload.sourceFileType) || 'application/pdf',
        status: stringOrNull(payload.status) || 'imported',
        notes: stringOrNull(payload.notes),
        page1Count: rowsBySection.page1.length,
        page2Count: rowsBySection.page2.length,
        northBayChangesCount: rowsBySection.northBayChanges.length,
        southBayChangesCount: rowsBySection.southBayChanges.length
      }),
      now,
      now
    ),
    db.prepare('DELETE FROM daily_schedule_rows WHERE plant_id = ? AND schedule_date = ?').bind(plantId, scheduleDate)
  ];

  sectionKeys.forEach(sectionKey => {
    rowsBySection[sectionKey].forEach((row, index) => {
      const rowId = stringOrNull(row.rowId) || `${sectionKey}_${index + 1}`;
      const normalizedRow = {
        rowId,
        scheduleDate,
        shift: row.shift ?? payload.shift ?? 1,
        section: row.section || sectionKey,
        press: String(row.press || ''),
        partStorageLocation: Array.isArray(row.partStorageLocation) ? row.partStorageLocation : [],
        partNumber: String(row.partNumber || ''),
        description: String(row.description || ''),
        cavity: String(row.cavity || ''),
        doh: row.doh == null ? null : Number(row.doh),
        labelsPerShift: row.labelsPerShift == null ? null : Number(row.labelsPerShift),
        mc: String(row.mc || ''),
        notes: String(row.notes || ''),
        displayOrder: Number(row.displayOrder || index + 1),
        isChange: Boolean(row.isChange)
      };

      if (normalizedRow.partNumber) {
        statements.push(
          db.prepare(`
            INSERT INTO parts (part_number, description, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(part_number) DO UPDATE SET
              description = COALESCE(excluded.description, description),
              updated_at = excluded.updated_at
          `).bind(
            normalizedRow.partNumber,
            stringOrNull(normalizedRow.description),
            now
          )
        );
      }

      statements.push(
        db.prepare(`
          INSERT INTO daily_schedule_rows (
            daily_schedule_item_row_id, daily_schedule_row_id, plant_id, schedule_date, section_key, row_id, press, part_number,
            cavity, doh, labels_per_shift, mc, notes, shift, part_storage_location_json, raw_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(daily_schedule_item_row_id) DO UPDATE SET
            press = excluded.press,
            part_number = excluded.part_number,
            cavity = excluded.cavity,
            doh = excluded.doh,
            labels_per_shift = excluded.labels_per_shift,
            mc = excluded.mc,
            notes = excluded.notes,
            shift = excluded.shift,
            part_storage_location_json = excluded.part_storage_location_json,
            raw_json = excluded.raw_json,
            updated_at = excluded.updated_at
        `).bind(
          `${plantId}:${scheduleDate}:${sectionKey}:${rowId}`,
          `${plantId}:${scheduleDate}`,
          plantId,
          scheduleDate,
          sectionKey,
          rowId,
          stringOrNull(normalizedRow.press),
          stringOrNull(normalizedRow.partNumber),
          stringOrNull(normalizedRow.cavity),
          normalizedRow.doh == null ? null : String(normalizedRow.doh),
          normalizedRow.labelsPerShift == null ? null : String(normalizedRow.labelsPerShift),
          stringOrNull(normalizedRow.mc),
          stringOrNull(normalizedRow.notes),
          stringOrNull(normalizedRow.shift),
          jsonOrNull(normalizedRow.partStorageLocation),
          jsonOrNull(normalizedRow),
          now,
          now
        )
      );
    });
  });

  const scheduleChangeRows = [...rowsBySection.northBayChanges, ...rowsBySection.southBayChanges]
    .filter(row => String(row?.press || '').trim());
  let createdScheduleIssueCount = 0;

  for (const row of scheduleChangeRows) {
    const bundle = buildScheduleImportIssue(plantId, scheduleDate, payload.shift, row);
    const existing = await first(db, 'SELECT issue_id FROM issues WHERE plant_id = ? AND issue_id = ? LIMIT 1', plantId, bundle.issueId);
    if (existing) continue;

    const issueRow = buildIssueRowFromClient(plantId, bundle.issueId, bundle.issue);
    statements.push(db.prepare(issueUpsertStatement()).bind(...issueUpsertParams(issueRow)));
    createdScheduleIssueCount += 1;

    bundle.events
      .map((event, index) => buildEventRowFromClient(plantId, bundle.issueId, event, index))
      .forEach(eventRow => {
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
            eventRow.event_id,
            eventRow.issue_id,
            eventRow.plant_id,
            eventRow.event_type,
            eventRow.event_at,
            eventRow.actor_uid,
            eventRow.actor_name,
            eventRow.payload_json,
            eventRow.dedupe_key,
            eventRow.created_at
          )
        );
      });
  }

  await db.batch(statements);

  return {
    schedule: serializeDailySchedule(await first(db, 'SELECT * FROM daily_schedules WHERE plant_id = ? AND schedule_date = ? LIMIT 1', plantId, scheduleDate)),
    rowCount: Object.values(rowsBySection).reduce((sum, rows) => sum + rows.length, 0),
    scheduleIssueCount: createdScheduleIssueCount
  };
}

function issueUpsertStatement({ updateCreatedAt = false } = {}) {
  return `
    INSERT INTO issues (
      issue_id, plant_id, press_id, machine_code, row_id, title, note, description, issue_type, priority, severity,
      high_priority, current_status_key, current_sub_status_key, current_status_label, current_sub_status_label,
      current_status_color, current_status_entered_at, current_status_entered_by_uid, current_status_entered_by_name,
      is_open, is_resolved, opened_at, resolved_at, closed_at, reopened_count, assigned_team, assigned_user_uid,
      assigned_user_name, serial_required, serial_captured, serial_value, reporting_date_key, reporting_week_key,
      reporting_month_key, reporting_shift_key, workflow_state, workflow_state_by_entry_json,
      workflow_state_by_entry_history_json, workflow_state_by_status_json, workflow_state_by_status_history_json,
      workflow_state_history_json, legacy_status_history_json, quality_defect_json, latest_note_preview, tags_json, photo_count, created_by_uid, created_by_name,
      updated_by_uid, updated_by_name, timer_enabled, timer_started_at, timer_due_at, timer_due_at_ms,
      timer_duration_minutes, timer_notification_status, timer_notification_owner_uid, timer_notification_requested_by_json,
      timer_notification_delivery_json, solution_current_json, created_at, updated_at, schema_version
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
      workflow_state_by_entry_history_json = excluded.workflow_state_by_entry_history_json,
      workflow_state_by_status_json = excluded.workflow_state_by_status_json,
      workflow_state_by_status_history_json = excluded.workflow_state_by_status_history_json,
      workflow_state_history_json = excluded.workflow_state_history_json,
      legacy_status_history_json = excluded.legacy_status_history_json,
      quality_defect_json = excluded.quality_defect_json,
      latest_note_preview = excluded.latest_note_preview,
      tags_json = excluded.tags_json,
      photo_count = excluded.photo_count,
      created_by_uid = excluded.created_by_uid,
      created_by_name = excluded.created_by_name,
      updated_by_uid = excluded.updated_by_uid,
      updated_by_name = excluded.updated_by_name,
      timer_enabled = excluded.timer_enabled,
      timer_started_at = excluded.timer_started_at,
      timer_due_at = excluded.timer_due_at,
      timer_due_at_ms = excluded.timer_due_at_ms,
      timer_duration_minutes = excluded.timer_duration_minutes,
      timer_notification_status = excluded.timer_notification_status,
      timer_notification_owner_uid = excluded.timer_notification_owner_uid,
      timer_notification_requested_by_json = excluded.timer_notification_requested_by_json,
      timer_notification_delivery_json = excluded.timer_notification_delivery_json,
      solution_current_json = excluded.solution_current_json,
      created_at = ${updateCreatedAt ? 'excluded.created_at' : 'issues.created_at'},
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
    row.reporting_month_key, row.reporting_shift_key, row.workflow_state, row.workflow_state_by_entry_json,
    row.workflow_state_by_entry_history_json, row.workflow_state_by_status_json, row.workflow_state_by_status_history_json,
    row.workflow_state_history_json, row.legacy_status_history_json, row.quality_defect_json, row.latest_note_preview, row.tags_json, row.photo_count, row.created_by_uid, row.created_by_name,
    row.updated_by_uid, row.updated_by_name, row.timer_enabled, row.timer_started_at, row.timer_due_at, row.timer_due_at_ms,
    row.timer_duration_minutes, row.timer_notification_status, row.timer_notification_owner_uid, row.timer_notification_requested_by_json,
    row.timer_notification_delivery_json, row.solution_current_json, row.created_at, row.updated_at, row.schema_version
  ];
}

async function upsertIssueWriteBundle(db, plantId, body, user, { updateCreatedAt = false } = {}) {
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
    // Creation time is immutable during routine issue updates. Workflow/category
    // changes send a complete issue payload, whose timestamp may have crossed the
    // client boundary as an unparseable object; allowing the upsert to replace
    // created_at would then silently reset it to now.
    db.prepare(issueUpsertStatement({ updateCreatedAt })).bind(...issueUpsertParams(issueRow))
  ];

  if (body.replaceAttachments) {
    statements.push(db.prepare('DELETE FROM issue_attachments WHERE plant_id = ? AND issue_id = ?').bind(plantId, issueId));
  }

  attachmentRows.forEach(row => {
    statements.push(
      db.prepare(`
        INSERT INTO issue_attachments (
          attachment_id, issue_id, plant_id, type, solution_revision_id, file_name, content_type, storage_bucket, storage_path, thumbnail_path,
          download_url, uploaded_by_uid, uploaded_by_name, taken_at, uploaded_at, size_bytes, schema_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attachment_id) DO UPDATE SET
          type = excluded.type,
          solution_revision_id = excluded.solution_revision_id,
          file_name = excluded.file_name,
          content_type = excluded.content_type,
          storage_bucket = excluded.storage_bucket,
          storage_path = excluded.storage_path,
          thumbnail_path = excluded.thumbnail_path,
          download_url = excluded.download_url,
          uploaded_by_uid = excluded.uploaded_by_uid,
          uploaded_by_name = excluded.uploaded_by_name,
          taken_at = excluded.taken_at,
          uploaded_at = excluded.uploaded_at,
          size_bytes = excluded.size_bytes,
          schema_version = excluded.schema_version
      `).bind(
        row.attachment_id, row.issue_id, row.plant_id, row.type, row.solution_revision_id, row.file_name, row.content_type, row.storage_bucket, row.storage_path, row.thumbnail_path,
        row.download_url, row.uploaded_by_uid, row.uploaded_by_name, row.taken_at, row.uploaded_at, row.size_bytes, row.schema_version
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
  if (user.email) {
    await run(
      db,
      `
        INSERT INTO user_lookup (
          email_normalized, uid, display_name, full_name, sso_number, photo_url, updated_at
        )
        SELECT LOWER(?), uid, COALESCE(display_name, ?), full_name, sso_number, COALESCE(photo_url, ?), ?
        FROM users
        WHERE uid = ?
        ON CONFLICT(email_normalized) DO UPDATE SET
          uid = excluded.uid,
          display_name = COALESCE(excluded.display_name, user_lookup.display_name),
          full_name = COALESCE(excluded.full_name, user_lookup.full_name),
          sso_number = COALESCE(excluded.sso_number, user_lookup.sso_number),
          photo_url = COALESCE(excluded.photo_url, user_lookup.photo_url),
          updated_at = excluded.updated_at
      `,
      user.email,
      stringOrNull(user.name),
      stringOrNull(user.picture),
      nowIso(),
      user.uid
    );
  }
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
        u.theme_prefs_json,
        u.requested_plant_ids_json,
        u.profile_onboarding_json,
        u.global_lifetime_xp,
        u.global_xp_spent,
        u.inventory_json,
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
  if (Object.prototype.hasOwnProperty.call(patch, 'themePrefs')) {
    updates.push('theme_prefs_json = ?');
    values.push(jsonOrNull(patch.themePrefs && typeof patch.themePrefs === 'object' ? patch.themePrefs : null));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'profileOnboarding')) {
    updates.push('profile_onboarding_json = ?');
    values.push(jsonOrNull(patch.profileOnboarding || null));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'globalXpSpent')) {
    updates.push('global_xp_spent = ?');
    values.push(numberOrZero(patch.globalXpSpent));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'inventory')) {
    updates.push('inventory_json = ?');
    values.push(jsonOrNull(patch.inventory && typeof patch.inventory === 'object' ? patch.inventory : null));
  }

  if (updates.length) {
    updates.push('updated_at = ?');
    values.push(nowIso());
    values.push(user.uid);
    await run(db, `UPDATE users SET ${updates.join(', ')} WHERE uid = ?`, ...values);
  }

  const refreshed = await first(db, 'SELECT * FROM users WHERE uid = ? LIMIT 1', user.uid);

  await run(
    db,
    `
      UPDATE plant_members
      SET
        display_name = COALESCE(?, display_name),
        full_name = COALESCE(?, full_name),
        sso_number = COALESCE(?, sso_number),
        email = COALESCE(?, email)
      WHERE uid = ?
    `,
    stringOrNull(refreshed?.display_name),
    stringOrNull(refreshed?.full_name),
    stringOrNull(refreshed?.sso_number),
    stringOrNull(refreshed?.email),
    user.uid
  );

  if (user.email) {
    await run(
      db,
      `
        INSERT INTO user_lookup (
          email_normalized, uid, display_name, full_name, sso_number, photo_url, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email_normalized) DO UPDATE SET
          uid = excluded.uid,
          display_name = excluded.display_name,
          full_name = excluded.full_name,
          sso_number = excluded.sso_number,
          photo_url = excluded.photo_url,
          updated_at = excluded.updated_at
      `,
      String(user.email || '').toLowerCase(),
      user.uid,
      stringOrNull(refreshed?.display_name),
      stringOrNull(refreshed?.full_name),
      stringOrNull(refreshed?.sso_number),
      stringOrNull(refreshed?.photo_url),
      nowIso()
    );
  }

  return getCurrentUserContext(db, user);
}

async function createAccessRequests(db, user, body = {}) {
  await upsertAuthUserRow(db, user);
  const plantIds = Array.from(new Set((Array.isArray(body.plantIds) ? body.plantIds : []).map(v => String(v || '').trim()).filter(Boolean)));
  if (!plantIds.length) throw Object.assign(new Error('Choose at least one plant.'), { status: 400 });
  const fullName = stringOrNull(body.fullName);
  const ssoNumber = stringOrNull(body.ssoNumber);
  const displayName = stringOrNull(body.displayName) || fullName || stringOrNull(user.name) || stringOrNull(user.email);
  const completedAt = asIso(body.profileOnboarding?.completedAt, nowIso());
  await updateCurrentUserContext(db, user, {
    displayName,
    fullName,
    ssoNumber,
    requestedPlantIds: plantIds,
    profileOnboarding: body.profileOnboarding || {
      completed: true,
      completedAt,
      version: 1
    }
  });
  const now = nowIso();
  const statements = plantIds.map(plantId => db.prepare(
    `
      INSERT INTO access_requests (
        plant_id, uid, status, display_name, full_name, sso_number, email, photo_url, requested_at, updated_at
      ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plant_id, uid) DO UPDATE SET
        display_name = excluded.display_name,
        full_name = excluded.full_name,
        sso_number = excluded.sso_number,
        email = excluded.email,
        photo_url = excluded.photo_url,
        updated_at = excluded.updated_at,
        status = CASE WHEN access_requests.status = 'approved' THEN access_requests.status ELSE 'pending' END
    `
  ).bind(
    plantId,
    user.uid,
    displayName,
    fullName,
    ssoNumber,
    stringOrNull(user.email),
    stringOrNull(user.picture),
    now,
    now
  ));
  await db.batch(statements);
  return jsonResponse({ ok: true, plantIds });
}

async function purchaseStoreItem(db, user, body = {}) {
  await upsertAuthUserRow(db, user);
  const itemId = stringOrNull(body.itemId);
  const price = Math.max(0, numberOrZero(body.price));
  if (!itemId) throw Object.assign(new Error('Missing itemId.'), { status: 400 });
  if (!(price > 0)) throw Object.assign(new Error('Missing or invalid price.'), { status: 400 });

  const row = await first(
    db,
    `
      SELECT global_lifetime_xp, global_xp_spent, inventory_json
      FROM users
      WHERE uid = ?
      LIMIT 1
    `,
    user.uid
  );
  const lifetimeXp = Number(row?.global_lifetime_xp || 0);
  const xpSpent = Number(row?.global_xp_spent || 0);
  const inventory = row?.inventory_json ? (JSON.parse(row.inventory_json) || {}) : {};
  const unlockedItems = Array.isArray(inventory?.unlockedItems) ? inventory.unlockedItems.map(v => String(v || '')).filter(Boolean) : [];
  if (unlockedItems.includes(itemId)) {
    return jsonResponse({
      ok: true,
      alreadyOwned: true,
      user: {
        uid: user.uid,
        globalLifetimeXp: lifetimeXp,
        globalXpSpent: xpSpent,
        inventory: {
          unlockedItems,
          activeMascot: inventory?.activeMascot || null
        }
      }
    });
  }
  if ((lifetimeXp - xpSpent) < price) {
    throw Object.assign(new Error('insufficient_xp'), { status: 409 });
  }
  const nextInventory = {
    ...inventory,
    unlockedItems: [...new Set([...unlockedItems, itemId])]
  };
  const now = nowIso();
  const result = await run(
    db,
    `
      UPDATE users
      SET
        global_xp_spent = ?,
        inventory_json = ?,
        updated_at = ?
      WHERE uid = ?
        AND COALESCE(global_xp_spent, 0) = ?
        AND (COALESCE(global_lifetime_xp, 0) - COALESCE(global_xp_spent, 0)) >= ?
    `,
    xpSpent + price,
    jsonOrNull(nextInventory),
    now,
    user.uid,
    xpSpent,
    price
  );
  if (!Number(result?.meta?.changes || 0)) {
    throw Object.assign(new Error('insufficient_xp'), { status: 409 });
  }
  return jsonResponse({
    ok: true,
    alreadyOwned: false,
    itemId,
    user: {
      uid: user.uid,
      globalLifetimeXp: lifetimeXp,
      globalXpSpent: xpSpent + price,
      inventory: {
        unlockedItems: nextInventory.unlockedItems,
        activeMascot: nextInventory?.activeMascot || null
      }
    }
  });
}

async function registerPushToken(db, user, body = {}) {
  await upsertAuthUserRow(db, user);
  const token = stringOrNull(body.token);
  const tokenId = stringOrNull(body.tokenId);
  if (!token || !tokenId) throw Object.assign(new Error('token and tokenId are required.'), { status: 400 });
  const now = nowIso();
  await run(
    db,
    `
      INSERT INTO user_push_tokens (
        uid, token_id, token, provider, platform, user_agent, notification_permission,
        plant_ids_json, current_plant_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uid, token_id) DO UPDATE SET
        token = excluded.token,
        provider = excluded.provider,
        platform = excluded.platform,
        user_agent = excluded.user_agent,
        notification_permission = excluded.notification_permission,
        plant_ids_json = excluded.plant_ids_json,
        current_plant_id = excluded.current_plant_id,
        updated_at = excluded.updated_at
    `,
    user.uid,
    tokenId,
    token,
    stringOrNull(body.provider) || 'fcm',
    stringOrNull(body.platform) || 'web',
    stringOrNull(body.userAgent),
    stringOrNull(body.notificationPermission),
    jsonOrNull(Array.isArray(body.plantIds) ? body.plantIds : []),
    stringOrNull(body.currentPlantId),
    now,
    now
  );
  return jsonResponse({ ok: true, tokenId });
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

async function createPlant(db, user, body = {}) {
  await upsertAuthUserRow(db, user);
  const name = stringOrNull(body.name);
  if (!name) throw Object.assign(new Error('Plant name is required.'), { status: 400 });
  const plantId = stringOrNull(body.plantId) || `${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now().toString(36)}`;
  const location = stringOrNull(body.location) || '';
  const now = nowIso();
  const defaultPermissions = body.defaultPermissions && typeof body.defaultPermissions === 'object'
    ? body.defaultPermissions
    : {
        canViewPlant: true,
        canCreateIssue: true,
        canEditIssue: true,
        canResolveIssue: true,
        canManageStatuses: true,
        canManagePresses: true,
        canExport: true
      };
  const defaultPresses = body.defaultPresses && typeof body.defaultPresses === 'object' ? body.defaultPresses : {};
  const defaultStatuses = body.defaultStatuses && typeof body.defaultStatuses === 'object' ? body.defaultStatuses : {};
  const defaultSubcategoryRoutes = body.defaultSubcategoryRoutes && typeof body.defaultSubcategoryRoutes === 'object'
    ? body.defaultSubcategoryRoutes
    : {};
  const defaultGameConfig = body.defaultGameConfig && typeof body.defaultGameConfig === 'object' ? body.defaultGameConfig : {};
  const defaultStoreConfig = body.defaultStoreConfig && typeof body.defaultStoreConfig === 'object' ? body.defaultStoreConfig : {};
  const statements = [
    db.prepare(`
      INSERT INTO plants (plant_id, name, location, is_active, created_by_uid, updated_by_uid, created_at, updated_at, schema_version)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, 1)
    `).bind(plantId, name, location, user.uid, user.uid, now, now),
    db.prepare(`
      INSERT INTO plant_members (
        plant_id, uid, role, is_active, display_name, full_name, sso_number, email,
        permissions_json, alert_category_subscriptions_json, job_role_keys_json, job_feeds_json,
        joined_at, last_seen_at
      ) VALUES (?, ?, 'admin', 1, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)
    `).bind(
      plantId,
      user.uid,
      stringOrNull(user.name),
      stringOrNull(user.name),
      stringOrNull(user.email),
      jsonOrNull(defaultPermissions),
      jsonOrNull([]),
      jsonOrNull([]),
      jsonOrNull([]),
      now
    ),
    db.prepare(`
      INSERT INTO plant_press_config (plant_id, presses_json, updated_by_uid, updated_at)
      VALUES (?, ?, ?, ?)
    `).bind(plantId, jsonOrNull(defaultPresses), user.uid, now),
    db.prepare(`
      INSERT INTO plant_status_config (plant_id, statuses_json, subcategory_routes_json, updated_by_uid, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(plantId, jsonOrNull(defaultStatuses), jsonOrNull(defaultSubcategoryRoutes), user.uid, now),
    db.prepare(`
      INSERT INTO gamification_config (plant_id, config_json, updated_at)
      VALUES (?, ?, ?)
    `).bind(plantId, jsonOrNull(defaultGameConfig), now),
    db.prepare(`
      INSERT INTO plant_store_config (plant_id, config_json, updated_at)
      VALUES (?, ?, ?)
    `).bind(plantId, jsonOrNull(defaultStoreConfig), now)
  ];
  await db.batch(statements);
  return jsonResponse({
    plant: {
      plantId,
      name,
      location,
      isActive: true
    }
  }, { status: 201 });
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
  const permissions = parsePermissions(currentMember.permissions_json);
  const canManageMembers = permissions.canManageMembers === true || currentMember.role === 'admin';
  if (user.uid !== uid) {
    if (!canManageMembers) {
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
  if (Object.prototype.hasOwnProperty.call(body, 'role')) {
    if (!canManageMembers) throw Object.assign(new Error('Permission denied'), { status: 403 });
    updates.push('role = ?');
    values.push(stringOrNull(body.role) || 'editor');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'permissions')) {
    if (!canManageMembers) throw Object.assign(new Error('Permission denied'), { status: 403 });
    updates.push('permissions_json = ?');
    values.push(jsonOrNull(body.permissions && typeof body.permissions === 'object' ? body.permissions : {}));
  }
  if (Object.prototype.hasOwnProperty.call(body, 'isActive')) {
    if (!canManageMembers) throw Object.assign(new Error('Permission denied'), { status: 403 });
    updates.push('is_active = ?');
    values.push(body.isActive === false ? 0 : 1);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'displayName')) {
    if (!canManageMembers) throw Object.assign(new Error('Permission denied'), { status: 403 });
    updates.push('display_name = ?');
    values.push(stringOrNull(body.displayName));
  }
  if (Object.prototype.hasOwnProperty.call(body, 'fullName')) {
    if (!canManageMembers) throw Object.assign(new Error('Permission denied'), { status: 403 });
    updates.push('full_name = ?');
    values.push(stringOrNull(body.fullName));
  }
  if (Object.prototype.hasOwnProperty.call(body, 'ssoNumber')) {
    if (!canManageMembers) throw Object.assign(new Error('Permission denied'), { status: 403 });
    updates.push('sso_number = ?');
    values.push(stringOrNull(body.ssoNumber));
  }
  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    if (!canManageMembers) throw Object.assign(new Error('Permission denied'), { status: 403 });
    updates.push('email = ?');
    values.push(stringOrNull(body.email));
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

async function addPlantMember(db, plantId, body, user) {
  const currentMember = await requirePlantPermission(db, plantId, user, null);
  const permissions = parsePermissions(currentMember.permissions_json);
  if (permissions.canManageMembers !== true && currentMember.role !== 'admin') {
    throw Object.assign(new Error('Permission denied'), { status: 403 });
  }
  const uid = stringOrNull(body.uid);
  if (!uid) throw Object.assign(new Error('Missing uid.'), { status: 400 });
  const role = stringOrNull(body.role) || 'editor';
  const permissionPayload = body.permissions && typeof body.permissions === 'object'
    ? body.permissions
    : {};
  await run(
    db,
    `
      INSERT INTO plant_members (
        plant_id, uid, role, is_active, display_name, full_name, sso_number, email,
        permissions_json, alert_category_subscriptions_json, job_role_keys_json, job_feeds_json,
        joined_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plant_id, uid) DO UPDATE SET
        role = excluded.role,
        is_active = excluded.is_active,
        display_name = COALESCE(excluded.display_name, plant_members.display_name),
        full_name = COALESCE(excluded.full_name, plant_members.full_name),
        sso_number = COALESCE(excluded.sso_number, plant_members.sso_number),
        email = COALESCE(excluded.email, plant_members.email),
        permissions_json = excluded.permissions_json,
        joined_at = COALESCE(plant_members.joined_at, excluded.joined_at)
    `,
    plantId,
    uid,
    role,
    body.isActive === false ? 0 : 1,
    stringOrNull(body.displayName),
    stringOrNull(body.fullName),
    stringOrNull(body.ssoNumber),
    stringOrNull(body.email),
    jsonOrNull(permissionPayload),
    jsonOrNull(Array.isArray(body.alertCategorySubscriptions) ? body.alertCategorySubscriptions : []),
    jsonOrNull(Array.isArray(body.jobRoleKeys) ? body.jobRoleKeys : []),
    jsonOrNull(Array.isArray(body.jobFeeds) ? body.jobFeeds : []),
    nowIso(),
    null
  );
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

async function deletePlantMember(db, plantId, uid, user) {
  const currentMember = await requirePlantPermission(db, plantId, user, null);
  const permissions = parsePermissions(currentMember.permissions_json);
  if (permissions.canManageMembers !== true && currentMember.role !== 'admin') {
    throw Object.assign(new Error('Permission denied'), { status: 403 });
  }
  await run(db, 'DELETE FROM plant_members WHERE plant_id = ? AND uid = ?', plantId, uid);
  return jsonResponse({ ok: true });
}

async function listAccessRequests(db, request, plantId, user) {
  const currentMember = await requirePlantPermission(db, plantId, user, null);
  const permissions = parsePermissions(currentMember.permissions_json);
  if (permissions.canManageMembers !== true && currentMember.role !== 'admin') {
    throw Object.assign(new Error('Permission denied'), { status: 403 });
  }
  const url = new URL(request.url);
  const status = stringOrNull(url.searchParams.get('status'));
  const rows = await all(
    db,
    `
      SELECT *
      FROM access_requests
      WHERE plant_id = ?
      ${status ? 'AND status = ?' : ''}
      ORDER BY requested_at DESC
    `,
    ...(status ? [plantId, status] : [plantId])
  );
  return jsonResponse({
    accessRequests: rows.map(row => ({
      uid: row.uid,
      status: row.status,
      displayName: row.display_name,
      fullName: row.full_name,
      ssoNumber: row.sso_number,
      email: row.email,
      photoUrl: row.photo_url,
      requestedAt: asIso(row.requested_at),
      updatedAt: asIso(row.updated_at)
    }))
  });
}

async function updateAccessRequest(db, plantId, uid, body, user) {
  const currentMember = await requirePlantPermission(db, plantId, user, null);
  const permissions = parsePermissions(currentMember.permissions_json);
  if (permissions.canManageMembers !== true && currentMember.role !== 'admin') {
    throw Object.assign(new Error('Permission denied'), { status: 403 });
  }
  const existing = await first(db, 'SELECT * FROM access_requests WHERE plant_id = ? AND uid = ? LIMIT 1', plantId, uid);
  if (!existing) throw Object.assign(new Error('Access request not found.'), { status: 404 });
  const nextStatus = stringOrNull(body.status) || existing.status || 'pending';
  await run(
    db,
    'UPDATE access_requests SET status = ?, updated_at = ? WHERE plant_id = ? AND uid = ?',
    nextStatus,
    nowIso(),
    plantId,
    uid
  );
  if (nextStatus === 'approved') {
    const role = stringOrNull(body.role) || 'editor';
    const permissionPayload = body.permissions && typeof body.permissions === 'object' ? body.permissions : {};
    await run(
      db,
      `
        INSERT INTO plant_members (
          plant_id, uid, role, is_active, display_name, full_name, sso_number, email,
          permissions_json, alert_category_subscriptions_json, job_role_keys_json, job_feeds_json,
          joined_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(plant_id, uid) DO UPDATE SET
          role = excluded.role,
          is_active = excluded.is_active,
          display_name = COALESCE(excluded.display_name, plant_members.display_name),
          full_name = COALESCE(excluded.full_name, plant_members.full_name),
          sso_number = COALESCE(excluded.sso_number, plant_members.sso_number),
          email = COALESCE(excluded.email, plant_members.email),
          permissions_json = excluded.permissions_json
      `,
      plantId,
      uid,
      role,
      1,
      existing.display_name,
      existing.full_name,
      existing.sso_number,
      existing.email,
      jsonOrNull(permissionPayload),
      jsonOrNull([]),
      jsonOrNull([]),
      jsonOrNull([]),
      nowIso(),
      null
    );
  }
  const saved = await first(db, 'SELECT * FROM access_requests WHERE plant_id = ? AND uid = ? LIMIT 1', plantId, uid);
  return jsonResponse({
    accessRequest: saved ? {
      uid: saved.uid,
      status: saved.status,
      displayName: saved.display_name,
      fullName: saved.full_name,
      ssoNumber: saved.sso_number,
      email: saved.email,
      photoUrl: saved.photo_url,
      requestedAt: asIso(saved.requested_at),
      updatedAt: asIso(saved.updated_at)
    } : null
  });
}

async function requirePlantConfigManager(db, plantId, user) {
  const currentMember = await requirePlantPermission(db, plantId, user, null);
  const permissions = parsePermissions(currentMember.permissions_json);
  if (currentMember.role !== 'admin' && permissions.canManageStatuses !== true) {
    throw Object.assign(new Error('Permission denied'), { status: 403 });
  }
  return currentMember;
}

async function getStatusConfig(db, plantId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const row = await first(db, 'SELECT * FROM plant_status_config WHERE plant_id = ? LIMIT 1', plantId);
  return jsonResponse({ statusConfig: serializeStatusConfig(row) });
}

async function updateStatusConfig(db, plantId, body, user) {
  await requirePlantConfigManager(db, plantId, user);
  const statuses = body?.statuses && typeof body.statuses === 'object' && !Array.isArray(body.statuses)
    ? body.statuses
    : {};
  const subcategoryRoutes = body?.subcategoryRoutes && typeof body.subcategoryRoutes === 'object'
    ? body.subcategoryRoutes
    : null;
  await run(
    db,
    `
      INSERT INTO plant_status_config (plant_id, statuses_json, subcategory_routes_json, updated_by_uid, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(plant_id) DO UPDATE SET
        statuses_json = excluded.statuses_json,
        subcategory_routes_json = excluded.subcategory_routes_json,
        updated_by_uid = excluded.updated_by_uid,
        updated_at = excluded.updated_at
    `,
    plantId,
    jsonOrNull(statuses),
    jsonOrNull(subcategoryRoutes),
    user.uid,
    nowIso()
  );
  return getStatusConfig(db, plantId, user);
}

async function getStoreConfig(db, plantId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const row = await first(db, 'SELECT * FROM plant_store_config WHERE plant_id = ? LIMIT 1', plantId);
  return jsonResponse({ storeConfig: serializePlantStoreConfig(row) });
}

async function updateStoreConfig(db, plantId, body, user) {
  await requirePlantConfigManager(db, plantId, user);
  const config = body?.config && typeof body.config === 'object' ? body.config : {};
  await run(
    db,
    `
      INSERT INTO plant_store_config (plant_id, config_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(plant_id) DO UPDATE SET
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `,
    plantId,
    jsonOrNull(config),
    nowIso()
  );
  return getStoreConfig(db, plantId, user);
}

async function getRoleAlertRouting(db, plantId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const row = await first(db, 'SELECT * FROM role_alert_routing_config WHERE plant_id = ? LIMIT 1', plantId);
  return jsonResponse({ roleAlertRouting: serializeRoleAlertRoutingConfig(row) });
}

async function updateRoleAlertRouting(db, plantId, body, user) {
  await requirePlantConfigManager(db, plantId, user);
  const rules = Array.isArray(body?.rules) ? body.rules : [];
  await run(
    db,
    `
      INSERT INTO role_alert_routing_config (plant_id, rules_json, updated_by_uid, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(plant_id) DO UPDATE SET
        rules_json = excluded.rules_json,
        updated_by_uid = excluded.updated_by_uid,
        updated_at = excluded.updated_at
    `,
    plantId,
    jsonOrNull(rules),
    user.uid,
    nowIso()
  );
  return getRoleAlertRouting(db, plantId, user);
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

async function getPressConfig(db, plantId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const row = await first(db, 'SELECT * FROM plant_press_config WHERE plant_id = ? LIMIT 1', plantId);
  return jsonResponse({ pressConfig: serializePressConfig(row) });
}

async function updatePressConfig(db, plantId, body, user) {
  await requirePlantConfigManager(db, plantId, user);
  const presses = body?.presses && typeof body.presses === 'object' && !Array.isArray(body.presses)
    ? body.presses
    : {};
  await run(
    db,
    `
      INSERT INTO plant_press_config (plant_id, presses_json, updated_by_uid, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(plant_id) DO UPDATE SET
        presses_json = excluded.presses_json,
        updated_by_uid = excluded.updated_by_uid,
        updated_at = excluded.updated_at
    `,
    plantId,
    jsonOrNull(presses),
    user.uid,
    nowIso()
  );
  return getPressConfig(db, plantId, user);
}

async function getGamificationAdmin(db, plantId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const [configRow, missionRows] = await Promise.all([
    first(db, 'SELECT * FROM gamification_config WHERE plant_id = ? LIMIT 1', plantId),
    all(db, 'SELECT * FROM game_missions WHERE plant_id = ? ORDER BY COALESCE(starts_at, updated_at) DESC, mission_id ASC', plantId)
  ]);
  return jsonResponse({
    gamificationConfig: serializeGamificationConfig(configRow),
    missions: missionRows.map(serializeGameMission)
  });
}

async function resetGamificationLeaderboard(db, plantId, body, user) {
  await requirePlantConfigManager(db, plantId, user);
  const boardId = stringOrNull(body?.boardId || body?.period) || 'weekly';
  const now = nowIso();
  await run(
    db,
    `
      INSERT INTO game_leaderboards (
        leaderboard_row_id, plant_id, board_id, entries_json, entries_by_uid_json, updated_at, schema_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plant_id, board_id) DO UPDATE SET
        entries_json = excluded.entries_json,
        entries_by_uid_json = excluded.entries_by_uid_json,
        updated_at = excluded.updated_at,
        schema_version = excluded.schema_version
    `,
    `${plantId}:${boardId}`,
    plantId,
    boardId,
    jsonOrNull([]),
    jsonOrNull({}),
    now,
    1
  );
  return jsonResponse({
    ok: true,
    boardId,
    updatedAt: now,
    resetBy: { uid: user.uid, name: user.name }
  });
}

async function updateGamificationAdmin(db, plantId, body, user) {
  await requirePlantConfigManager(db, plantId, user);
  const config = body?.config && typeof body.config === 'object' ? body.config : {};
  const missions = Array.isArray(body?.missions) ? body.missions : [];
  const now = nowIso();
  const existingMissionRows = await all(db, 'SELECT mission_id FROM game_missions WHERE plant_id = ?', plantId);
  const desiredIds = new Set(missions.map(mission => stringOrNull(mission?.id)).filter(Boolean));
  const statements = [
    db.prepare(`
      INSERT INTO gamification_config (plant_id, config_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(plant_id) DO UPDATE SET
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `).bind(plantId, jsonOrNull(config), now)
  ];

  existingMissionRows.forEach(row => {
    if (!desiredIds.has(row.mission_id)) {
      statements.push(db.prepare('DELETE FROM game_mission_progress WHERE plant_id = ? AND mission_id = ?').bind(plantId, row.mission_id));
      statements.push(db.prepare('DELETE FROM game_missions WHERE plant_id = ? AND mission_id = ?').bind(plantId, row.mission_id));
    }
  });

  missions.forEach((mission, index) => {
    const missionId = stringOrNull(mission?.id) || `mission_${Date.now().toString(36)}_${index}`;
    const startsAt = asIso(mission?.startsAt, now);
    statements.push(db.prepare(`
      INSERT INTO game_missions (
        mission_row_id, plant_id, mission_id, name, description, objective_json, rewards_json,
        is_active, starts_at, ends_at, updated_at, raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plant_id, mission_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        objective_json = excluded.objective_json,
        rewards_json = excluded.rewards_json,
        is_active = excluded.is_active,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        updated_at = excluded.updated_at,
        raw_json = excluded.raw_json
    `).bind(
      `${plantId}:${missionId}`,
      plantId,
      missionId,
      stringOrNull(mission?.name) || 'Mission',
      stringOrNull(mission?.description),
      jsonOrNull(mission?.objective && typeof mission.objective === 'object' ? mission.objective : {}),
      jsonOrNull(mission?.rewards && typeof mission.rewards === 'object' ? mission.rewards : {}),
      mission?.isActive === false ? 0 : 1,
      startsAt,
      asIso(mission?.endsAt),
      now,
      jsonOrNull({
        id: missionId,
        name: stringOrNull(mission?.name) || 'Mission',
        description: stringOrNull(mission?.description) || '',
        objective: mission?.objective && typeof mission.objective === 'object' ? mission.objective : {},
        rewards: mission?.rewards && typeof mission.rewards === 'object' ? mission.rewards : {},
        isActive: mission?.isActive !== false,
        startsAt,
        endsAt: asIso(mission?.endsAt),
        createdAt: asIso(mission?.createdAt, startsAt),
        updatedAt: now
      })
    ));
  });

  await db.batch(statements);
  return getGamificationAdmin(db, plantId, user);
}

async function listUserDirectory(db, user) {
  const adminRows = await all(
    db,
    `
      SELECT plant_id
      FROM plant_members
      WHERE uid = ? AND is_active = 1 AND role = 'admin'
      LIMIT 1
    `,
    user.uid
  );
  if (!adminRows.length) {
    throw Object.assign(new Error('Permission denied'), { status: 403 });
  }
  const rows = await all(
    db,
    `
      SELECT email_normalized, uid, display_name, full_name, photo_url
      FROM user_lookup
      ORDER BY COALESCE(display_name, email_normalized, uid) COLLATE NOCASE
    `
  );
  return jsonResponse({
    users: rows.map(row => ({
      uid: row.uid,
      displayName: row.display_name || row.full_name || '',
      email: row.email_normalized || '',
      photoURL: row.photo_url || ''
    }))
  });
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
  const [plant, statuses, presses, game, store, roleAlertRouting] = await Promise.all([
    first(db, 'SELECT * FROM plants WHERE plant_id = ? LIMIT 1', plantId),
    first(db, 'SELECT * FROM plant_status_config WHERE plant_id = ? LIMIT 1', plantId),
    first(db, 'SELECT * FROM plant_press_config WHERE plant_id = ? LIMIT 1', plantId),
    first(db, 'SELECT * FROM gamification_config WHERE plant_id = ? LIMIT 1', plantId),
    first(db, 'SELECT * FROM plant_store_config WHERE plant_id = ? LIMIT 1', plantId),
    first(db, 'SELECT * FROM role_alert_routing_config WHERE plant_id = ? LIMIT 1', plantId)
  ]);
  return jsonResponse({
    plant: serializePlant(plant),
    member: serializePlantMember(member),
    statusConfig: serializeStatusConfig(statuses),
    pressConfig: serializePressConfig(presses),
    gamificationConfig: serializeGamificationConfig(game),
    storeConfig: serializePlantStoreConfig(store),
    roleAlertRouting: serializeRoleAlertRoutingConfig(roleAlertRouting)
  });
}

async function getDailySchedule(db, plantId, scheduleDate, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const schedule = await first(
    db,
    'SELECT * FROM daily_schedules WHERE plant_id = ? AND schedule_date = ? LIMIT 1',
    plantId,
    scheduleDate
  );
  if (!schedule) {
    return jsonResponse({ schedule: null, sections: {} });
  }
  const rows = await all(
    db,
    `
      SELECT r.*, p.description
      FROM daily_schedule_rows r
      LEFT JOIN parts p ON r.part_number = p.part_number
      WHERE r.plant_id = ? AND r.schedule_date = ?
      ORDER BY r.section_key ASC, COALESCE(CAST(json_extract(r.raw_json, '$.displayOrder') AS INTEGER), 999999) ASC, r.row_id ASC
    `,
    plantId,
    scheduleDate
  );
  const sections = {
    page1: [],
    page2: [],
    northBayChanges: [],
    southBayChanges: []
  };
  rows.forEach(row => {
    const key = row.section_key;
    if (!sections[key]) sections[key] = [];
    sections[key].push(serializeDailyScheduleRow(row));
  });
  return jsonResponse({
    schedule: serializeDailySchedule(schedule),
    sections
  });
}

async function listDailySchedules(db, request, plantId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const url = new URL(request.url);
  const from = String(url.searchParams.get('from') || '').trim();
  const to = String(url.searchParams.get('to') || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw Object.assign(new Error('from and to query params must use yyyy-mm-dd format.'), { status: 400 });
  }
  const rows = await all(
    db,
    `
      SELECT *
      FROM daily_schedules
      WHERE plant_id = ?
        AND schedule_date >= ?
        AND schedule_date <= ?
      ORDER BY schedule_date ASC
    `,
    plantId,
    from,
    to
  );
  return jsonResponse({ schedules: rows.map(serializeDailySchedule) });
}

async function listIssues(db, request, plantId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 250));
  const date = String(url.searchParams.get('date') || '').trim();
  const machine = String(url.searchParams.get('machine') || '').trim();
  const cursor = String(url.searchParams.get('cursor') || '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error('date query param must use yyyy-mm-dd format.'), { status: 400 });
  }
  const where = ['plant_id = ?'];
  const params = [plantId];
  if (date) {
    where.push('reporting_date_key = ?');
    params.push(date);
  }
  if (machine) {
    where.push('machine_code = ?');
    params.push(machine);
  }
  if (cursor) {
    const separator = cursor.lastIndexOf('|');
    const cursorCreatedAt = separator > 0 ? cursor.slice(0, separator) : '';
    const cursorIssueId = separator > 0 ? cursor.slice(separator + 1) : '';
    if (!cursorCreatedAt || !cursorIssueId || !asIso(cursorCreatedAt)) {
      throw Object.assign(new Error('Invalid issue cursor.'), { status: 400 });
    }
    where.push('(created_at < ? OR (created_at = ? AND issue_id < ?))');
    params.push(cursorCreatedAt, cursorCreatedAt, cursorIssueId);
  }
  const issues = await all(
    db,
    `
      SELECT *
      FROM issues
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, issue_id DESC
      LIMIT ?
    `,
    ...params,
    limit + 1
  );
  const hasMore = issues.length > limit;
  const page = hasMore ? issues.slice(0, limit) : issues;
  const last = page[page.length - 1];
  return jsonResponse({
    issues: page.map(serializeIssue),
    nextCursor: hasMore && last ? `${last.created_at}|${last.issue_id}` : null,
    exhausted: !hasMore
  });
}

function safeJson(value, fallback = null) {
  if (!value) return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; }
}

function compactText(value, max = 900) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function searchBraveWeb(query, env) {
  if (!env.BRAVE_SEARCH_API_KEY) return { available: false, results: [] };
  try {
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': env.BRAVE_SEARCH_API_KEY }
    });
    if (!response.ok) return { available: false, results: [] };
    const body = await response.json();
    return {
      available: true,
      results: (body.web?.results || []).slice(0, 5).map(result => ({
        title: compactText(result.title, 180),
        url: String(result.url || ''),
        description: compactText(result.description, 500)
      })).filter(result => result.url)
    };
  } catch {
    return { available: false, results: [] };
  }
}

function similarFixesCandidateQuery(plantId, sourceIssueId = '') {
  const sourceId = compactText(sourceIssueId, 200);
  return {
    sql: `
      SELECT issue_id, machine_code, note, description, issue_type, priority, resolved_at,
             solution_current_json, legacy_status_history_json
      FROM issues
      WHERE plant_id = ? AND is_resolved = 1
        AND (solution_current_json IS NOT NULL OR legacy_status_history_json IS NOT NULL)
        ${sourceId ? 'AND issue_id != ?' : ''}
      ORDER BY resolved_at DESC, updated_at DESC
      LIMIT 80
    `,
    params: sourceId ? [plantId, sourceId] : [plantId]
  };
}

const SIMILAR_FIXES_STOP_WORDS = new Set(['about', 'after', 'again', 'also', 'and', 'are', 'been', 'before', 'both', 'but', 'can', 'could', 'did', 'does', 'for', 'from', 'had', 'has', 'have', 'into', 'its', 'not', 'now', 'our', 'out', 'see', 'she', 'that', 'the', 'their', 'then', 'there', 'they', 'this', 'through', 'too', 'was', 'were', 'when', 'with', 'would']);

function similarFixesTerms(value) {
  return [...new Set((String(value || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [])
    .filter(term => !SIMILAR_FIXES_STOP_WORDS.has(term)))];
}

function normalizeSimilarFixesStatusHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-12).map(entry => ({
    status: compactText(entry?.status || entry?.statusKey, 100),
    subStatus: compactText(entry?.subStatus || entry?.subStatusKey, 220),
    note: compactText(entry?.note || entry?.comment || '', 600)
  })).filter(entry => entry.status || entry.subStatus || entry.note);
}

function similarFixesStatusHistoryText(history = []) {
  return history.map(entry => `${entry.status} ${entry.subStatus} ${entry.note}`).join(' ');
}

function fallbackInternalMatches(candidates = [], machineCode = '') {
  return candidates
    .filter(candidate => candidate?.sameMachine || (candidate?.matchedTerms || []).length >= 2)
    .slice(0, 3)
    .map(candidate => ({
      issueId: candidate.issueId,
      whySimilar: [
        candidate.sameMachine && machineCode ? `Same press: ${machineCode}.` : '',
        candidate.matchedTerms?.length ? `Matching terms: ${candidate.matchedTerms.join(', ')}.` : ''
      ].filter(Boolean).join(' '),
      fix: candidate.resolution
    }));
}

export const __testOnly = { similarFixesCandidateQuery, fallbackInternalMatches, similarFixesTerms, normalizeSimilarFixesStatusHistory };

async function findSimilarFixes(db, plantId, body, user, env) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const description = compactText(body?.description, 1600);
  const machineCode = compactText(body?.machineCode, 80);
  const sourceIssueId = compactText(body?.sourceIssueId, 200);
  const sourceStatusHistory = normalizeSimilarFixesStatusHistory(body?.statusHistory);
  if (description.length < 8) {
    throw Object.assign(new Error('Describe the issue in at least 8 characters before searching for fixes.'), { status: 400 });
  }
  if (!env.DEEPSEEK_API_KEY) {
    throw Object.assign(new Error('DeepSeek is not configured for this deployment.'), { status: 503 });
  }

  // D1 is the source of truth: only completed issues with a usable resolution are
  // eligible. Candidate selection deliberately stays inside the requested plant.
  const candidateQuery = similarFixesCandidateQuery(plantId, sourceIssueId);
  const candidates = await all(db, candidateQuery.sql, ...candidateQuery.params);
  const terms = similarFixesTerms(`${description} ${similarFixesStatusHistoryText(sourceStatusHistory)}`);
  const rankedCandidates = candidates.map(row => {
    const solution = safeJson(row.solution_current_json, {});
    const history = normalizeSimilarFixesStatusHistory(safeJson(row.legacy_status_history_json, []));
    const resolution = compactText(solution?.current?.text || solution?.text || [...history].reverse().find(entry => entry?.status === 'resolved')?.note, 1200);
    const searchableTerms = new Set(similarFixesTerms(`${row.machine_code || ''} ${row.note || ''} ${row.description || ''} ${row.issue_type || ''} ${resolution} ${similarFixesStatusHistoryText(history)}`));
    const matchedTerms = terms.filter(term => searchableTerms.has(term));
    const sameMachine = Boolean(machineCode && row.machine_code === machineCode);
    const score = matchedTerms.length + (sameMachine ? 2 : 0);
    return { issueId: row.issue_id, machineCode: row.machine_code || '', issueType: row.issue_type || '', note: compactText(row.note || row.description, 700), statusHistory: history, resolution, resolvedAt: row.resolved_at || '', score, matchedTerms, sameMachine };
  }).filter(candidate => candidate.resolution).sort((a, b) => b.score - a.score || String(b.resolvedAt).localeCompare(String(a.resolvedAt))).slice(0, 12);

  const web = await searchBraveWeb(`${machineCode ? `${machineCode} ` : ''}${description} manufacturing troubleshooting`, env);
  const systemPrompt = `You are AP Tracker's evidence-based maintenance research assistant. Compare a new manufacturing-floor issue with internal resolved incidents and external web snippets. Never invent facts or repair steps. Treat external sources as general guidance, not plant-approved procedure. Require lockout/tagout and the plant SOP before machine service. Return ONLY JSON with internalMatches, externalResearch, recommendedNextSteps, and safetyNotes. Every internal match must cite an issueId; every external result must cite its supplied url.`;
  const prompt = {
    newIssue: { description, machineCode, statusHistory: sourceStatusHistory },
    internalResolvedIssues: rankedCandidates,
    externalSearchResults: web.results
  };
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: JSON.stringify(prompt) }],
      response_format: { type: 'json_object' },
      temperature: 0.15,
      max_tokens: 1800
    })
  });
  const deepseekBody = await response.json();
  if (!response.ok) throw Object.assign(new Error(deepseekBody?.error?.message || `DeepSeek request failed (${response.status}).`), { status: 502 });
  const content = deepseekBody?.choices?.[0]?.message?.content;
  const analysis = safeJson(content, null);
  if (!analysis || typeof analysis !== 'object') throw Object.assign(new Error('DeepSeek returned an invalid research response.'), { status: 502 });
  // DeepSeek is allowed to summarize evidence, not manufacture references. Keep
  // only citations that originated from D1 or the search provider response.
  const internalById = new Map(rankedCandidates.map(candidate => [candidate.issueId, candidate]));
  const externalByUrl = new Map(web.results.map(result => [result.url, result]));
  const modelInternalMatches = (Array.isArray(analysis.internalMatches) ? analysis.internalMatches : [])
    .map(match => {
      const candidate = internalById.get(String(match?.issueId || ''));
      return candidate && {
        issueId: candidate.issueId,
        whySimilar: compactText(match?.whySimilar, 500),
        fix: compactText(match?.fix || candidate.resolution, 1200)
      };
    }).filter(Boolean).slice(0, 6);
  // The model may conservatively omit valid citations. When D1 has scored
  // evidence, return it directly rather than showing an empty internal result.
  const internalMatches = modelInternalMatches.length
    ? modelInternalMatches
    : fallbackInternalMatches(rankedCandidates, machineCode);
  const externalResearch = (Array.isArray(analysis.externalResearch) ? analysis.externalResearch : [])
    .map(result => {
      const source = externalByUrl.get(String(result?.url || ''));
      return source && {
        title: source.title,
        url: source.url,
        summary: compactText(result?.summary || source.description, 700),
        applicability: compactText(result?.applicability, 500)
      };
    }).filter(Boolean).slice(0, 5);
  return jsonResponse({
    internalMatches,
    externalResearch,
    recommendedNextSteps: (Array.isArray(analysis.recommendedNextSteps) ? analysis.recommendedNextSteps : []).map(step => compactText(step, 400)).filter(Boolean).slice(0, 6),
    safetyNotes: (Array.isArray(analysis.safetyNotes) ? analysis.safetyNotes : []).map(note => compactText(note, 400)).filter(Boolean).slice(0, 4),
    internalCandidates: rankedCandidates,
    externalSearchAvailable: web.available
  });
}

async function saveIssueSimilarFixes(db, plantId, issueId, body, user) {
  await requirePlantPermission(db, plantId, user, 'canEditIssue');
  const existing = await first(db, 'SELECT issue_id FROM issues WHERE plant_id = ? AND issue_id = ? LIMIT 1', plantId, issueId);
  if (!existing) return jsonResponse({ error: 'Issue not found' }, { status: 404 });
  const payload = body?.payload && typeof body.payload === 'object' ? body.payload : null;
  if (!payload) throw Object.assign(new Error('A Similar Fixes research payload is required.'), { status: 400 });
  const saved = {
    payload: {
      internalMatches: Array.isArray(payload.internalMatches) ? payload.internalMatches.slice(0, 6) : [],
      externalResearch: Array.isArray(payload.externalResearch) ? payload.externalResearch.slice(0, 5) : [],
      recommendedNextSteps: Array.isArray(payload.recommendedNextSteps) ? payload.recommendedNextSteps.slice(0, 6) : [],
      safetyNotes: Array.isArray(payload.safetyNotes) ? payload.safetyNotes.slice(0, 4) : [],
      internalCandidates: Array.isArray(payload.internalCandidates) ? payload.internalCandidates.slice(0, 12) : [],
      externalSearchAvailable: !!payload.externalSearchAvailable
    },
    savedAt: nowIso(),
    savedBy: { uid: user.uid, name: user.name || user.email || user.uid }
  };
  await run(db, 'UPDATE issues SET similar_fixes_json = ?, updated_at = ?, updated_by_uid = ?, updated_by_name = ? WHERE plant_id = ? AND issue_id = ?',
    jsonString(saved), nowIso(), user.uid, user.name || user.email || user.uid, plantId, issueId);
  const issue = await first(db, 'SELECT * FROM issues WHERE plant_id = ? AND issue_id = ? LIMIT 1', plantId, issueId);
  return jsonResponse({ issue: serializeIssue(issue) });
}

async function getIssueSimilarFixes(db, plantId, issueId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const issue = await first(
    db,
    'SELECT similar_fixes_json FROM issues WHERE plant_id = ? AND issue_id = ? LIMIT 1',
    plantId,
    issueId
  );
  if (!issue) return jsonResponse({ error: 'Issue not found' }, { status: 404 });
  return jsonResponse({ similarFixes: safeJson(issue.similar_fixes_json, null) });
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

async function getNoteRow(db, plantId, noteId) {
  return first(
    db,
    `
      SELECT *
      FROM notes
      WHERE plant_id = ? AND note_id = ?
      LIMIT 1
    `,
    plantId,
    noteId
  );
}

async function listNotes(db, request, plantId, user) {
  await requirePlantPermission(db, plantId, user, null);
  const url = new URL(request.url);
  const includeArchived = url.searchParams.get('includeArchived') === 'true';
  const rows = await all(
    db,
    `
      SELECT *
      FROM notes
      WHERE plant_id = ?
        ${includeArchived ? '' : 'AND is_archived = 0'}
      ORDER BY is_pinned DESC, updated_at DESC, title COLLATE NOCASE ASC
    `,
    plantId
  );
  return jsonResponse({ notes: rows.map(serializeNote) });
}

async function createNote(db, plantId, body, user) {
  await requirePlantPermission(db, plantId, user, null);
  const noteId = stringOrNull(body.noteId || body.id);
  if (!noteId) throw Object.assign(new Error('Missing noteId.'), { status: 400 });
  const now = nowIso();
  const createdAt = asIso(body.createdAt, now);
  const updatedAt = asIso(body.updatedAt, createdAt);
  const createdByUid = stringOrNull(body.createdBy?.uid || body.createdByUid) || user.uid;
  const updatedByUid = stringOrNull(body.updatedBy?.uid || body.updatedByUid) || user.uid;
  await run(
    db,
    `
      INSERT INTO notes (
        note_id, plant_id, title, body_html, body_text, checklist_items_json, tags_json, press_id, machine_code, issue_id,
        is_pinned, is_archived, photo_count, search_text, created_by_uid, updated_by_uid, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(note_id) DO UPDATE SET
        title = excluded.title,
        body_html = excluded.body_html,
        body_text = excluded.body_text,
        checklist_items_json = excluded.checklist_items_json,
        tags_json = excluded.tags_json,
        press_id = excluded.press_id,
        machine_code = excluded.machine_code,
        issue_id = excluded.issue_id,
        is_pinned = excluded.is_pinned,
        is_archived = excluded.is_archived,
        photo_count = excluded.photo_count,
        search_text = excluded.search_text,
        updated_by_uid = excluded.updated_by_uid,
        updated_at = excluded.updated_at
    `,
    noteId,
    plantId,
    stringOrNull(body.title) || 'Untitled Note',
    stringOrNull(body.bodyHtml),
    stringOrNull(body.bodyText),
    jsonOrNull(Array.isArray(body.checklistItems) ? body.checklistItems : []),
    jsonOrNull(Array.isArray(body.tags) ? body.tags : []),
    stringOrNull(body.pressId),
    stringOrNull(body.machineCode),
    stringOrNull(body.issueId),
    asBoolInt(body.isPinned),
    asBoolInt(body.isArchived),
    numberOrZero(body.photoCount),
    stringOrNull(body.searchText),
    createdByUid,
    updatedByUid,
    createdAt,
    updatedAt
  );
  const saved = await getNoteRow(db, plantId, noteId);
  return jsonResponse({ note: serializeNote(saved) }, { status: 201 });
}

async function updateNote(db, plantId, noteId, body, user) {
  await requirePlantPermission(db, plantId, user, null);
  const existing = await getNoteRow(db, plantId, noteId);
  if (!existing) throw Object.assign(new Error('Note not found.'), { status: 404 });
  const now = nowIso();
  await run(
    db,
    `
      UPDATE notes
      SET title = ?,
          body_html = ?,
          body_text = ?,
          checklist_items_json = ?,
          tags_json = ?,
          press_id = ?,
          machine_code = ?,
          issue_id = ?,
          is_pinned = ?,
          is_archived = ?,
          photo_count = ?,
          search_text = ?,
          updated_by_uid = ?,
          updated_at = ?
      WHERE plant_id = ? AND note_id = ?
    `,
    stringOrNull(body.title) || existing.title || 'Untitled Note',
    stringOrNull(body.bodyHtml),
    stringOrNull(body.bodyText),
    jsonOrNull(Array.isArray(body.checklistItems) ? body.checklistItems : []),
    jsonOrNull(Array.isArray(body.tags) ? body.tags : []),
    stringOrNull(body.pressId),
    stringOrNull(body.machineCode),
    stringOrNull(body.issueId),
    asBoolInt(body.isPinned),
    asBoolInt(body.isArchived),
    numberOrZero(body.photoCount),
    stringOrNull(body.searchText),
    stringOrNull(body.updatedBy?.uid || body.updatedByUid) || user.uid,
    asIso(body.updatedAt, now),
    plantId,
    noteId
  );
  const saved = await getNoteRow(db, plantId, noteId);
  return jsonResponse({ note: serializeNote(saved) });
}

async function deleteNote(db, plantId, noteId, user) {
  await requirePlantPermission(db, plantId, user, null);
  await db.batch([
    db.prepare('DELETE FROM note_attachments WHERE plant_id = ? AND note_id = ?').bind(plantId, noteId),
    db.prepare('DELETE FROM notes WHERE plant_id = ? AND note_id = ?').bind(plantId, noteId)
  ]);
  return jsonResponse({ ok: true, noteId });
}

async function listNoteAttachments(db, plantId, noteId, user) {
  await requirePlantPermission(db, plantId, user, null);
  const note = await getNoteRow(db, plantId, noteId);
  if (!note) throw Object.assign(new Error('Note not found.'), { status: 404 });
  const attachments = await all(
    db,
    `
      SELECT *
      FROM note_attachments
      WHERE plant_id = ? AND note_id = ?
      ORDER BY uploaded_at DESC
    `,
    plantId,
    noteId
  );
  return jsonResponse({ attachments: attachments.map(serializeNoteAttachment) });
}

async function createNoteAttachment(db, plantId, noteId, body, user) {
  await requirePlantPermission(db, plantId, user, null);
  const note = await getNoteRow(db, plantId, noteId);
  if (!note) throw Object.assign(new Error('Note not found.'), { status: 404 });
  const attachmentId = stringOrNull(body.attachmentId || body.id);
  const storagePath = stringOrNull(body.storagePath);
  if (!attachmentId || !storagePath) {
    throw Object.assign(new Error('Missing attachmentId or storagePath.'), { status: 400 });
  }
  const noteAttachmentRowId = `${noteId}:${attachmentId}`;
  const uploadedAt = asIso(body.uploadedAt, nowIso());
  await run(
    db,
    `
      INSERT INTO note_attachments (
        note_attachment_id, note_id, plant_id, attachment_id, storage_path, storage_bucket, file_name,
        content_type, size_bytes, url, uploaded_by_json, uploaded_at, schema_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(note_attachment_id) DO UPDATE SET
        storage_path = excluded.storage_path,
        storage_bucket = excluded.storage_bucket,
        file_name = excluded.file_name,
        content_type = excluded.content_type,
        size_bytes = excluded.size_bytes,
        url = excluded.url,
        uploaded_by_json = excluded.uploaded_by_json,
        uploaded_at = excluded.uploaded_at,
        schema_version = excluded.schema_version
    `,
    noteAttachmentRowId,
    noteId,
    plantId,
    attachmentId,
    storagePath,
    stringOrNull(body.storageBucket),
    stringOrNull(body.fileName),
    stringOrNull(body.contentType),
    numberOrNull(body.sizeBytes),
    stringOrNull(body.url || body.downloadURL),
    jsonOrNull(body.uploadedBy || { uid: user.uid, name: user.name }),
    uploadedAt,
    numberOrZero(body.schemaVersion || 1)
  );
  await run(
    db,
    `
      UPDATE notes
      SET photo_count = (
            SELECT COUNT(*)
            FROM note_attachments
            WHERE plant_id = ? AND note_id = ?
          ),
          updated_by_uid = ?,
          updated_at = ?
      WHERE plant_id = ? AND note_id = ?
    `,
    plantId,
    noteId,
    user.uid,
    uploadedAt,
    plantId,
    noteId
  );
  const saved = await first(
    db,
    `
      SELECT *
      FROM note_attachments
      WHERE plant_id = ? AND note_id = ? AND attachment_id = ?
      LIMIT 1
    `,
    plantId,
    noteId,
    attachmentId
  );
  return jsonResponse({ attachment: serializeNoteAttachment(saved) }, { status: 201 });
}

async function deleteNoteAttachment(db, plantId, noteId, attachmentId, user) {
  await requirePlantPermission(db, plantId, user, null);
  const note = await getNoteRow(db, plantId, noteId);
  if (!note) throw Object.assign(new Error('Note not found.'), { status: 404 });
  await run(
    db,
    'DELETE FROM note_attachments WHERE plant_id = ? AND note_id = ? AND attachment_id = ?',
    plantId,
    noteId,
    attachmentId
  );
  const now = nowIso();
  await run(
    db,
    `
      UPDATE notes
      SET photo_count = (
            SELECT COUNT(*)
            FROM note_attachments
            WHERE plant_id = ? AND note_id = ?
          ),
          updated_by_uid = ?,
          updated_at = ?
      WHERE plant_id = ? AND note_id = ?
    `,
    plantId,
    noteId,
    user.uid,
    now,
    plantId,
    noteId
  );
  return jsonResponse({ ok: true, attachmentId });
}

async function getTodoRow(db, plantId, todoId) {
  return first(
    db,
    `
      SELECT *
      FROM todos
      WHERE plant_id = ? AND todo_id = ?
      LIMIT 1
    `,
    plantId,
    todoId
  );
}

async function listTodos(db, request, plantId, user) {
  await requirePlantPermission(db, plantId, user, null);
  const rows = await all(
    db,
    `
      SELECT *
      FROM todos
      WHERE plant_id = ?
        AND (scope = 'shared' OR (scope = 'personal' AND owner_uid = ?))
      ORDER BY updated_at DESC
    `,
    plantId,
    user.uid
  );
  const personal = rows.filter(r => r.scope === 'personal').map(serializeTodo);
  const shared = rows.filter(r => r.scope === 'shared').map(serializeTodo);
  return jsonResponse({ personal, shared });
}

async function createTodo(db, plantId, body, user) {
  await requirePlantPermission(db, plantId, user, null);
  const todoId = stringOrNull(body.todoId || body.id);
  if (!todoId) throw Object.assign(new Error('Missing todoId.'), { status: 400 });
  const scope = stringOrNull(body.scope) || 'personal';
  const ownerUid = stringOrNull(body.ownerUid) || user.uid;
  const now = nowIso();
  const createdAt = asIso(body.createdAt, now);
  const updatedAt = asIso(body.updatedAt, createdAt);
  
  await run(
    db,
    `
      INSERT INTO todos (
        todo_id, scope, plant_id, owner_uid, title, notes, list_name, due_date, priority,
        is_completed, completed_at, press_id, machine_code, issue_id, search_text,
        created_by_json, updated_by_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(todo_id) DO UPDATE SET
        scope = excluded.scope,
        plant_id = excluded.plant_id,
        owner_uid = excluded.owner_uid,
        title = excluded.title,
        notes = excluded.notes,
        list_name = excluded.list_name,
        due_date = excluded.due_date,
        priority = excluded.priority,
        is_completed = excluded.is_completed,
        completed_at = excluded.completed_at,
        press_id = excluded.press_id,
        machine_code = excluded.machine_code,
        issue_id = excluded.issue_id,
        search_text = excluded.search_text,
        updated_by_json = excluded.updated_by_json,
        updated_at = excluded.updated_at
    `,
    todoId,
    scope,
    plantId,
    ownerUid,
    stringOrNull(body.title) || 'Untitled Todo',
    stringOrNull(body.notes),
    stringOrNull(body.listName) || 'Inbox',
    stringOrNull(body.dueDate),
    stringOrNull(body.priority) || 'none',
    asBoolInt(body.isCompleted),
    asIso(body.completedAt, null),
    stringOrNull(body.pressId),
    stringOrNull(body.machineCode),
    stringOrNull(body.issueId),
    stringOrNull(body.searchText),
    jsonString(body.createdBy || { uid: user.uid, name: user.name }),
    jsonString(body.updatedBy || { uid: user.uid, name: user.name }),
    createdAt,
    updatedAt
  );
  
  const saved = await getTodoRow(db, plantId, todoId);
  return jsonResponse({ todo: serializeTodo(saved) }, { status: 201 });
}

async function updateTodo(db, plantId, todoId, body, user) {
  await requirePlantPermission(db, plantId, user, null);
  const existing = await getTodoRow(db, plantId, todoId);
  if (!existing) throw Object.assign(new Error('Todo not found.'), { status: 404 });
  const now = nowIso();
  
  const scope = body.scope !== undefined ? stringOrNull(body.scope) : existing.scope;
  const ownerUid = body.ownerUid !== undefined ? stringOrNull(body.ownerUid) : existing.owner_uid;
  const title = body.title !== undefined ? stringOrNull(body.title) : existing.title;
  const notes = body.notes !== undefined ? stringOrNull(body.notes) : existing.notes;
  const listName = body.listName !== undefined ? stringOrNull(body.listName) : existing.list_name;
  const dueDate = body.dueDate !== undefined ? stringOrNull(body.dueDate) : existing.due_date;
  const priority = body.priority !== undefined ? stringOrNull(body.priority) : existing.priority;
  const isCompleted = body.isCompleted !== undefined ? asBoolInt(body.isCompleted) : existing.is_completed;
  const completedAt = body.completedAt !== undefined ? asIso(body.completedAt, null) : existing.completed_at;
  const pressId = body.pressId !== undefined ? stringOrNull(body.pressId) : existing.press_id;
  const machineCode = body.machineCode !== undefined ? stringOrNull(body.machineCode) : existing.machine_code;
  const issueId = body.issueId !== undefined ? stringOrNull(body.issueId) : existing.issue_id;
  const searchText = body.searchText !== undefined ? stringOrNull(body.searchText) : existing.search_text;
  
  const updatedByJson = body.updatedBy !== undefined 
    ? jsonString(body.updatedBy) 
    : jsonString({ uid: user.uid, name: user.name });

  await run(
    db,
    `
      UPDATE todos
      SET scope = ?,
          owner_uid = ?,
          title = ?,
          notes = ?,
          list_name = ?,
          due_date = ?,
          priority = ?,
          is_completed = ?,
          completed_at = ?,
          press_id = ?,
          machine_code = ?,
          issue_id = ?,
          search_text = ?,
          updated_by_json = ?,
          updated_at = ?
      WHERE plant_id = ? AND todo_id = ?
    `,
    scope,
    ownerUid,
    title || 'Untitled Todo',
    notes,
    listName || 'Inbox',
    dueDate,
    priority || 'none',
    isCompleted,
    completedAt,
    pressId,
    machineCode,
    issueId,
    searchText,
    updatedByJson,
    now,
    plantId,
    todoId
  );
  
  const saved = await getTodoRow(db, plantId, todoId);
  return jsonResponse({ todo: serializeTodo(saved) });
}

async function deleteTodo(db, plantId, todoId, user) {
  await requirePlantPermission(db, plantId, user, null);
  await run(db, 'DELETE FROM todos WHERE plant_id = ? AND todo_id = ?', plantId, todoId);
  return jsonResponse({ ok: true, todoId });
}

async function requireConversationMember(db, plantId, conversationId, user) {
  await requirePlantPermission(db, plantId, user, null);
  const row = await first(
    db,
    `
      SELECT c.*, cm.uid AS member_uid, cm.role AS member_role
      FROM conversations c
      JOIN conversation_members cm
        ON cm.conversation_id = c.conversation_id
      WHERE c.plant_id = ? AND c.conversation_id = ? AND cm.uid = ?
      LIMIT 1
    `,
    plantId,
    conversationId,
    user.uid
  );
  if (!row) throw Object.assign(new Error('Conversation access denied'), { status: 403 });
  return row;
}

async function listConversations(db, request, plantId, user) {
  await requirePlantPermission(db, plantId, user, null);
  const url = new URL(request.url);
  const type = stringOrNull(url.searchParams.get('type'));
  const rows = await all(
    db,
    `
      SELECT c.*,
             cm.uid AS member_uid,
             cm.role AS member_role,
             cm.joined_at AS member_joined_at,
             cm.last_read_at AS member_last_read_at,
             cm.last_read_message_id AS member_last_read_message_id,
             cm.unread_count AS member_unread_count,
             cm.muted AS member_muted
      FROM conversations c
      JOIN conversation_members cm
        ON cm.conversation_id = c.conversation_id
      WHERE c.plant_id = ?
        AND cm.uid = ?
        ${type ? 'AND c.type = ?' : ''}
        AND c.is_archived = 0
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
    `,
    ...(type ? [plantId, user.uid, type] : [plantId, user.uid])
  );
  return jsonResponse({ conversations: rows.map(serializeConversation) });
}

async function createConversation(db, plantId, body, user) {
  await requirePlantPermission(db, plantId, user, null);
  const now = nowIso();
  const type = ['dm', 'group', 'press'].includes(String(body.type || '').trim().toLowerCase())
    ? String(body.type || '').trim().toLowerCase()
    : 'group';
  const actor = { uid: user.uid, name: user.name || user.email || user.uid };
  const memberIds = Array.from(new Set([...(Array.isArray(body.memberIds) ? body.memberIds : []), user.uid].map(v => String(v || '').trim()).filter(Boolean)));
  if (memberIds.length < 2) throw Object.assign(new Error('At least two members are required.'), { status: 400 });
  if (type === 'dm' && memberIds.length !== 2) throw Object.assign(new Error('DM conversations must have exactly two members.'), { status: 400 });
  const title = stringOrNull(body.title);
  if (type === 'group' && !title) throw Object.assign(new Error('Group conversations require a title.'), { status: 400 });
  const pressId = type === 'press' ? stringOrNull(body.pressId) : null;

  const memberPlaceholders = memberIds.map(() => '?').join(', ');
  const allowedMembers = await all(
    db,
    `
      SELECT uid
      FROM plant_members
      WHERE plant_id = ? AND is_active = 1 AND uid IN (${memberPlaceholders})
    `,
    plantId,
    ...memberIds
  );
  if (allowedMembers.length !== memberIds.length) {
    throw Object.assign(new Error('One or more selected members are not active in this plant.'), { status: 400 });
  }

  if (type === 'dm') {
    const existingRows = await all(
      db,
      `
        SELECT c.*,
               cm.uid AS member_uid,
               cm.role AS member_role,
               cm.joined_at AS member_joined_at,
               cm.last_read_at AS member_last_read_at,
               cm.last_read_message_id AS member_last_read_message_id,
               cm.unread_count AS member_unread_count,
               cm.muted AS member_muted
        FROM conversations c
        JOIN conversation_members cm
          ON cm.conversation_id = c.conversation_id
        WHERE c.plant_id = ?
          AND cm.uid = ?
          AND c.type = 'dm'
          AND c.is_archived = 0
          AND c.member_count = 2
          AND c.member_ids_json = ?
      `,
      plantId,
      user.uid
    );
    const sortedIds = [...memberIds].sort();
    const existing = existingRows.find(row => {
      let ids = [];
      try {
        const parsed = JSON.parse(row.member_ids_json || '[]');
        if (Array.isArray(parsed)) ids = parsed;
      } catch {}
      return ids.length === sortedIds.length && ids.slice().sort().every((value, index) => value === sortedIds[index]);
    });
    if (existing) {
      return jsonResponse({ conversation: serializeConversation(existing) });
    }
  }

  const conversationId = stringOrNull(body.conversationId || body.id) || `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const memberIdsJson = jsonOrNull([...memberIds].sort());
  const statements = [
    db.prepare(
      `
        INSERT INTO conversations (
          conversation_id, plant_id, type, title, member_ids_json, last_message_text, last_message_at,
          created_by_uid, created_at, press_id, member_count, created_by_name, last_message_json, is_archived
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, 0)
      `
    ).bind(
      conversationId,
      plantId,
      type,
      title,
      memberIdsJson,
      now,
      user.uid,
      now,
      pressId,
      memberIds.length,
      actor.name
    )
  ];
  memberIds.forEach(uid => {
    statements.push(
      db.prepare(
        `
          INSERT INTO conversation_members (
            conversation_id, uid, last_read_at, muted, role, joined_at, last_read_message_id, unread_count
          ) VALUES (?, ?, ?, 0, ?, ?, NULL, 0)
        `
      ).bind(
        conversationId,
        uid,
        now,
        uid === user.uid ? 'owner' : 'member',
        now
      )
    );
  });
  await db.batch(statements);
  const created = await first(
    db,
    `
      SELECT c.*,
             cm.uid AS member_uid,
             cm.role AS member_role,
             cm.joined_at AS member_joined_at,
             cm.last_read_at AS member_last_read_at,
             cm.last_read_message_id AS member_last_read_message_id,
             cm.unread_count AS member_unread_count,
             cm.muted AS member_muted
      FROM conversations c
      JOIN conversation_members cm
        ON cm.conversation_id = c.conversation_id
      WHERE c.plant_id = ? AND c.conversation_id = ? AND cm.uid = ?
      LIMIT 1
    `,
    plantId,
    conversationId,
    user.uid
  );
  return jsonResponse({ conversation: serializeConversation(created) }, { status: 201 });
}

async function listConversationMessages(db, plantId, conversationId, user) {
  await requireConversationMember(db, plantId, conversationId, user);
  const rows = await all(
    db,
    `
      SELECT *
      FROM conversation_messages
      WHERE plant_id = ? AND conversation_id = ?
      ORDER BY created_at ASC
    `,
    plantId,
    conversationId
  );
  return jsonResponse({ messages: rows.map(serializeConversationMessage) });
}

async function createConversationMessage(db, plantId, conversationId, body, user) {
  await requireConversationMember(db, plantId, conversationId, user);
  const text = String(body.text || '').trim();
  const attachments = Array.isArray(body.attachments) ? body.attachments.filter(Boolean) : [];
  if (!text && !attachments.length) {
    throw Object.assign(new Error('Message body or attachment is required.'), { status: 400 });
  }
  const now = nowIso();
  const messageId = stringOrNull(body.messageId || body.id) || `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const lastMessage = {
    id: messageId,
    textPreview: text ? text.slice(0, 280) : (attachments.length ? '📷 Photo' : ''),
    sender: { uid: user.uid, name: user.name || user.email || user.uid },
    senderUid: user.uid,
    senderName: user.name || user.email || user.uid,
    at: now
  };
  await run(
    db,
    `
      INSERT INTO conversation_messages (
        message_id, conversation_id, plant_id, sender_uid, sender_name, body, created_at, type,
        mentions_json, attachments_json, edited_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `,
    messageId,
    conversationId,
    plantId,
    user.uid,
    stringOrNull(user.name || user.email || user.uid),
    text,
    now,
    stringOrNull(body.type) || 'text',
    jsonOrNull(Array.from(new Set((Array.isArray(body.mentions) ? body.mentions : []).map(v => String(v || '').trim()).filter(Boolean)))),
    jsonOrNull(attachments)
  );
  await run(
    db,
    `
      UPDATE conversations
      SET last_message_text = ?,
          last_message_at = ?,
          last_message_json = ?
      WHERE plant_id = ? AND conversation_id = ?
    `,
    lastMessage.textPreview,
    now,
    jsonOrNull(lastMessage),
    plantId,
    conversationId
  );
  await db.batch([
    db.prepare(
      `
        UPDATE conversation_members
        SET last_read_at = ?, last_read_message_id = ?, unread_count = 0
        WHERE conversation_id = ? AND uid = ?
      `
    ).bind(now, messageId, conversationId, user.uid),
    db.prepare(
      `
        UPDATE conversation_members
        SET unread_count = COALESCE(unread_count, 0) + 1
        WHERE conversation_id = ? AND uid != ?
      `
    ).bind(conversationId, user.uid)
  ]);
  const saved = await first(
    db,
    `
      SELECT *
      FROM conversation_messages
      WHERE message_id = ?
      LIMIT 1
    `,
    messageId
  );
  return jsonResponse({ message: serializeConversationMessage(saved) }, { status: 201 });
}

async function markConversationRead(db, plantId, conversationId, body, user) {
  await requireConversationMember(db, plantId, conversationId, user);
  const now = nowIso();
  await run(
    db,
    `
      UPDATE conversation_members
      SET last_read_at = ?, last_read_message_id = ?, unread_count = 0
      WHERE conversation_id = ? AND uid = ?
    `,
    now,
    stringOrNull(body.lastReadMessageId),
    conversationId,
    user.uid
  );
  return jsonResponse({ ok: true, conversationId, lastReadMessageId: stringOrNull(body.lastReadMessageId) });
}

function parseWikiScopeParams(url) {
  const scope = String(url.searchParams.get('scope') || 'press').trim().toLowerCase() === 'shared' ? 'shared' : 'press';
  const pressId = stringOrNull(url.searchParams.get('pressId'));
  return { scope, pressId };
}

async function getWikiPageRow(db, plantId, scope, pressId, pageId) {
  return first(
    db,
    `
      SELECT *
      FROM wiki_pages
      WHERE plant_id = ? AND scope = ? AND ${scope === 'shared' ? 'press_id IS NULL' : 'press_id = ?'} AND page_id = ?
      LIMIT 1
    `,
    ...(scope === 'shared' ? [plantId, scope, pageId] : [plantId, scope, pressId, pageId])
  );
}

async function listWikiPages(db, request, plantId, user) {
  await requirePlantPermission(db, plantId, user, null);
  const { scope, pressId } = parseWikiScopeParams(new URL(request.url));
  if (scope === 'press' && !pressId) throw Object.assign(new Error('pressId is required for press wiki scope.'), { status: 400 });
  const rows = await all(
    db,
    `
      SELECT *
      FROM wiki_pages
      WHERE plant_id = ? AND scope = ? AND ${scope === 'shared' ? 'press_id IS NULL' : 'press_id = ?'}
      ORDER BY COALESCE(sort_order, 0) ASC, updated_at DESC, title COLLATE NOCASE ASC
    `,
    ...(scope === 'shared' ? [plantId, scope] : [plantId, scope, pressId])
  );
  return jsonResponse({ pages: rows.map(serializeWikiPage) });
}

async function getWikiPageDetail(db, request, plantId, pageId, user) {
  await requirePlantPermission(db, plantId, user, null);
  const { scope, pressId } = parseWikiScopeParams(new URL(request.url));
  if (scope === 'press' && !pressId) throw Object.assign(new Error('pressId is required for press wiki scope.'), { status: 400 });
  const page = await getWikiPageRow(db, plantId, scope, pressId, pageId);
  if (!page) throw Object.assign(new Error('Wiki page not found.'), { status: 404 });
  const revisions = await all(
    db,
    `
      SELECT *
      FROM wiki_revisions
      WHERE wiki_page_row_id = ?
      ORDER BY edited_at DESC
      LIMIT 30
    `,
    page.wiki_page_row_id
  );
  const attachments = await all(
    db,
    `
      SELECT *
      FROM wiki_attachments
      WHERE wiki_page_row_id = ?
      ORDER BY uploaded_at DESC
      LIMIT 24
    `,
    page.wiki_page_row_id
  );
  return jsonResponse({
    page: serializeWikiPage(page),
    revisions: revisions.map(serializeWikiRevision),
    attachments: attachments.map(serializeWikiAttachment)
  });
}

async function saveWikiRevision(db, request, plantId, pageId, body, user) {
  await requirePlantPermission(db, plantId, user, 'canEditIssue');
  const { scope, pressId } = parseWikiScopeParams(new URL(request.url));
  if (scope === 'press' && !pressId) throw Object.assign(new Error('pressId is required for press wiki scope.'), { status: 400 });
  const rawBody = String(body.body || '').trim();
  if (!rawBody) throw Object.assign(new Error('Body is required.'), { status: 400 });
  const now = nowIso();
  const actor = body.actor && typeof body.actor === 'object'
    ? body.actor
    : { uid: user.uid, name: user.name || user.email || user.uid };
  const pageRowId = wikiPageRowId(scope, pressId, pageId);
  const existing = await getWikiPageRow(db, plantId, scope, pressId, pageId);
  const revisionId = stringOrNull(body.revisionId) || `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const revisionRowId = wikiRevisionRowId(scope, pressId, pageId, revisionId);
  const prevRevisionId = existing?.current_revision_id || null;
  const title = stringOrNull(body.title) || existing?.title || pageId;
  const actorName = String(actor?.name || actor?.email || actor?.uid || 'Unknown').trim() || 'Unknown';
  const changeNote = stringOrNull(body.changeNote) || `${actorName} saved ${now}`;
  await db.batch([
    db.prepare(
      `
        INSERT INTO wiki_revisions (
          wiki_revision_row_id, wiki_page_row_id, plant_id, scope, press_id, page_id, revision_id, body,
          change_note, prev_revision_id, edited_by_json, edited_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).bind(
      revisionRowId,
      pageRowId,
      plantId,
      scope,
      pressId,
      pageId,
      revisionId,
      rawBody,
      changeNote,
      prevRevisionId,
      jsonOrNull(actor),
      now
    ),
    db.prepare(
      `
        INSERT INTO wiki_pages (
          wiki_page_row_id, plant_id, scope, press_id, page_id, title, slug, summary, tags_json, parent_page_id,
          sort_order, is_pinned, is_locked, visibility, current_revision_id, photo_count, search_text, created_by_json,
          updated_by_json, created_at, updated_at, last_activity_at, last_verified_at, last_verified_by, schema_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(wiki_page_row_id) DO UPDATE SET
          title = excluded.title,
          slug = excluded.slug,
          current_revision_id = excluded.current_revision_id,
          updated_by_json = excluded.updated_by_json,
          updated_at = excluded.updated_at,
          last_activity_at = excluded.last_activity_at,
          search_text = excluded.search_text,
          summary = COALESCE(excluded.summary, wiki_pages.summary),
          parent_page_id = COALESCE(wiki_pages.parent_page_id, excluded.parent_page_id),
          sort_order = COALESCE(wiki_pages.sort_order, excluded.sort_order),
          photo_count = COALESCE(wiki_pages.photo_count, excluded.photo_count),
          schema_version = excluded.schema_version
      `
    ).bind(
      pageRowId,
      plantId,
      scope,
      pressId,
      pageId,
      title,
      stringOrNull(body.slug) || pageId,
      stringOrNull(body.summary),
      jsonOrNull(Array.isArray(body.tags) ? body.tags : (existing?.tags_json ? JSON.parse(existing.tags_json) : [])),
      stringOrNull(body.parentPageId),
      numberOrNull(body.sortOrder) ?? 0,
      body.isPinned ? 1 : 0,
      body.isLocked ? 1 : 0,
      stringOrNull(body.visibility) || 'plant',
      revisionId,
      numberOrZero(body.photoCount ?? existing?.photo_count ?? 0),
      stringOrNull(`${title} ${rawBody}`.toLowerCase()),
      jsonOrNull(existing?.created_by_json ? JSON.parse(existing.created_by_json) : actor),
      jsonOrNull(actor),
      existing?.created_at || now,
      now,
      now,
      existing?.last_verified_at || null,
      existing?.last_verified_by || null,
      numberOrZero(body.schemaVersion || existing?.schema_version || 2)
    )
  ]);
  return getWikiPageDetail(db, request, plantId, pageId, user);
}

async function deleteWikiPage(db, request, plantId, pageId, user) {
  await requirePlantPermission(db, plantId, user, 'canEditIssue');
  const { scope, pressId } = parseWikiScopeParams(new URL(request.url));
  if (scope === 'press' && !pressId) throw Object.assign(new Error('pressId is required for press wiki scope.'), { status: 400 });
  const page = await getWikiPageRow(db, plantId, scope, pressId, pageId);
  if (!page) throw Object.assign(new Error('Wiki page not found.'), { status: 404 });
  const child = await first(db, `SELECT page_id FROM wiki_pages WHERE plant_id = ? AND scope = ? AND ${scope === 'shared' ? 'press_id IS NULL' : 'press_id = ?'} AND parent_page_id = ? LIMIT 1`, ...(scope === 'shared' ? [plantId, scope, pageId] : [plantId, scope, pressId, pageId]));
  if (child) throw Object.assign(new Error('Move child pages first before deleting this page.'), { status: 400 });
  await db.batch([
    db.prepare('DELETE FROM wiki_attachments WHERE wiki_page_row_id = ?').bind(page.wiki_page_row_id),
    db.prepare('DELETE FROM wiki_revisions WHERE wiki_page_row_id = ?').bind(page.wiki_page_row_id),
    db.prepare('DELETE FROM wiki_pages WHERE wiki_page_row_id = ?').bind(page.wiki_page_row_id)
  ]);
  return jsonResponse({ ok: true, pageId });
}

async function createWikiAttachment(db, request, plantId, pageId, body, user) {
  await requirePlantPermission(db, plantId, user, 'canEditIssue');
  const { scope, pressId } = parseWikiScopeParams(new URL(request.url));
  if (scope === 'press' && !pressId) throw Object.assign(new Error('pressId is required for press wiki scope.'), { status: 400 });
  const page = await getWikiPageRow(db, plantId, scope, pressId, pageId);
  if (!page) throw Object.assign(new Error('Wiki page not found.'), { status: 404 });
  const attachmentId = stringOrNull(body.attachmentId || body.id);
  const storagePath = stringOrNull(body.storagePath);
  if (!attachmentId || !storagePath) throw Object.assign(new Error('Missing attachmentId or storagePath.'), { status: 400 });
  const now = asIso(body.uploadedAt, nowIso());
  await db.batch([
    db.prepare(
      `
        INSERT INTO wiki_attachments (
          wiki_attachment_row_id, wiki_page_row_id, plant_id, scope, press_id, page_id, attachment_id, storage_path,
          content_type, caption, linked_revision_id, uploaded_by_json, uploaded_at, width, height, url, schema_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(wiki_attachment_row_id) DO UPDATE SET
          storage_path = excluded.storage_path,
          content_type = excluded.content_type,
          caption = excluded.caption,
          linked_revision_id = excluded.linked_revision_id,
          uploaded_by_json = excluded.uploaded_by_json,
          uploaded_at = excluded.uploaded_at,
          width = excluded.width,
          height = excluded.height,
          url = excluded.url,
          schema_version = excluded.schema_version
      `
    ).bind(
      wikiAttachmentRowId(scope, pressId, pageId, attachmentId),
      page.wiki_page_row_id,
      plantId,
      scope,
      pressId,
      pageId,
      attachmentId,
      storagePath,
      stringOrNull(body.contentType),
      stringOrNull(body.caption),
      stringOrNull(body.linkedRevisionId || page.current_revision_id),
      jsonOrNull(body.uploadedBy || { uid: user.uid, name: user.name || user.email || user.uid }),
      now,
      numberOrNull(body.width),
      numberOrNull(body.height),
      stringOrNull(body.url || body.downloadURL),
      numberOrZero(body.schemaVersion || 1)
    ),
    db.prepare(
      `
        UPDATE wiki_pages
        SET photo_count = (
              SELECT COUNT(*)
              FROM wiki_attachments
              WHERE wiki_page_row_id = ?
            ),
            updated_at = ?,
            last_activity_at = ?
        WHERE wiki_page_row_id = ?
      `
    ).bind(page.wiki_page_row_id, now, now, page.wiki_page_row_id)
  ]);
  return getWikiPageDetail(db, request, plantId, pageId, user);
}

export async function handleD1ApiRequest(request, env, { authenticateRequest } = {}) {
  const url = new URL(request.url);

  try {
    const db = getDb(env);
    const meMatch = request.method === 'GET' && url.pathname === '/api/me';
    const meUpdateMatch = request.method === 'PATCH' && url.pathname === '/api/me';
    const meStorePurchaseMatch = request.method === 'POST' && url.pathname === '/api/me/store-purchases';
    const mePushTokenMatch = request.method === 'POST' && url.pathname === '/api/me/push-tokens';
    const accessRequestCreateSelfMatch = request.method === 'POST' && url.pathname === '/api/access-requests';
    const plantsListMatch = request.method === 'GET' && url.pathname === '/api/plants';
    const plantCreateMatch = request.method === 'POST' && url.pathname === '/api/plants';
    const bootstrapMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/bootstrap$/);
    const dailySchedulesMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/daily-schedules$/);
    const dailyScheduleMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/daily-schedules\/([^/]+)$/);
    const plantMembersMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/members$/);
    const plantMemberCreateMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/members$/);
    const plantMemberUpdateMatch = request.method === 'PATCH' && url.pathname.match(/^\/api\/plants\/([^/]+)\/members\/([^/]+)$/);
    const plantMemberDeleteMatch = request.method === 'DELETE' && url.pathname.match(/^\/api\/plants\/([^/]+)\/members\/([^/]+)$/);
    const accessRequestsMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/access-requests$/);
    const accessRequestUpdateMatch = request.method === 'PATCH' && url.pathname.match(/^\/api\/plants\/([^/]+)\/access-requests\/([^/]+)$/);
    const statusConfigMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/status-config$/);
    const statusConfigUpdateMatch = request.method === 'PUT' && url.pathname.match(/^\/api\/plants\/([^/]+)\/status-config$/);
    const pressConfigMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/press-config$/);
    const pressConfigUpdateMatch = request.method === 'PUT' && url.pathname.match(/^\/api\/plants\/([^/]+)\/press-config$/);
    const storeConfigMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/store-config$/);
    const storeConfigUpdateMatch = request.method === 'PUT' && url.pathname.match(/^\/api\/plants\/([^/]+)\/store-config$/);
    const roleAlertRoutingMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/role-alert-routing$/);
    const roleAlertRoutingUpdateMatch = request.method === 'PUT' && url.pathname.match(/^\/api\/plants\/([^/]+)\/role-alert-routing$/);
    const gamificationMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/gamification$/);
    const gamificationAwardMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/gamification\/award$/);
    const gamificationAdminMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/gamification-admin$/);
    const gamificationAdminUpdateMatch = request.method === 'PUT' && url.pathname.match(/^\/api\/plants\/([^/]+)\/gamification-admin$/);
    const gamificationLeaderboardResetMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/gamification\/leaderboard-reset$/);
    const userDirectoryMatch = request.method === 'GET' && url.pathname === '/api/user-directory';
    const roleAlertsMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/role-alerts$/);
    const roleAlertCreateMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/role-alerts$/);
    const roleAlertUpdateMatch = request.method === 'PATCH' && url.pathname.match(/^\/api\/plants\/([^/]+)\/role-alerts\/([^/]+)$/);
    const issuesMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues$/);
    const similarFixesMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/similar-fixes$/);
    const issueSimilarFixesSaveMatch = request.method === 'PUT' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)\/similar-fixes$/);
    const issueSimilarFixesGetMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)\/similar-fixes$/);
    const issueCreateMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues$/);
    const issueMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)$/);
    const issueUpdateMatch = request.method === 'PATCH' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)$/);
    const issueDeleteMatch = request.method === 'DELETE' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)$/);
    const eventsMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)\/events$/);
    const attachmentsMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)\/attachments$/);
    const notesMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/notes$/);
    const noteCreateMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/notes$/);
    const noteUpdateMatch = request.method === 'PATCH' && url.pathname.match(/^\/api\/plants\/([^/]+)\/notes\/([^/]+)$/);
    const noteDeleteMatch = request.method === 'DELETE' && url.pathname.match(/^\/api\/plants\/([^/]+)\/notes\/([^/]+)$/);
    const noteAttachmentsMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/notes\/([^/]+)\/attachments$/);
    const noteAttachmentCreateMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/notes\/([^/]+)\/attachments$/);
    const noteAttachmentDeleteMatch = request.method === 'DELETE' && url.pathname.match(/^\/api\/plants\/([^/]+)\/notes\/([^/]+)\/attachments\/([^/]+)$/);
    const todosMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/todos$/);
    const todoCreateMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/todos$/);
    const todoUpdateMatch = request.method === 'PATCH' && url.pathname.match(/^\/api\/plants\/([^/]+)\/todos\/([^/]+)$/);
    const todoDeleteMatch = request.method === 'DELETE' && url.pathname.match(/^\/api\/plants\/([^/]+)\/todos\/([^/]+)$/);
    const conversationsMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/conversations$/);
    const conversationCreateMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/conversations$/);
    const conversationMessagesMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/conversations\/([^/]+)\/messages$/);
    const conversationMessageCreateMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/conversations\/([^/]+)\/messages$/);
    const conversationReadMatch = request.method === 'PATCH' && url.pathname.match(/^\/api\/plants\/([^/]+)\/conversations\/([^/]+)\/read$/);
    const wikiPagesMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/wiki-pages$/);
    const wikiPageMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/wiki-pages\/([^/]+)$/);
    const wikiRevisionSaveMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/wiki-pages\/([^/]+)\/revisions$/);
    const wikiPageDeleteMatch = request.method === 'DELETE' && url.pathname.match(/^\/api\/plants\/([^/]+)\/wiki-pages\/([^/]+)$/);
    const wikiAttachmentCreateMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/wiki-pages\/([^/]+)\/attachments$/);
    const reportsDohMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/reports\/doh$/);
    const reportsRunsMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/reports\/runs$/);

    if (!meMatch && !meUpdateMatch && !meStorePurchaseMatch && !mePushTokenMatch && !accessRequestCreateSelfMatch && !plantsListMatch && !plantCreateMatch && !bootstrapMatch && !dailySchedulesMatch && !dailyScheduleMatch && !plantMembersMatch && !plantMemberCreateMatch && !plantMemberUpdateMatch && !plantMemberDeleteMatch && !accessRequestsMatch && !accessRequestUpdateMatch && !statusConfigMatch && !statusConfigUpdateMatch && !pressConfigMatch && !pressConfigUpdateMatch && !storeConfigMatch && !storeConfigUpdateMatch && !roleAlertRoutingMatch && !roleAlertRoutingUpdateMatch && !gamificationMatch && !gamificationAwardMatch && !gamificationAdminMatch && !gamificationAdminUpdateMatch && !gamificationLeaderboardResetMatch && !userDirectoryMatch && !roleAlertsMatch && !roleAlertCreateMatch && !roleAlertUpdateMatch && !issuesMatch && !similarFixesMatch && !issueSimilarFixesSaveMatch && !issueSimilarFixesGetMatch && !issueCreateMatch && !issueMatch && !issueUpdateMatch && !issueDeleteMatch && !eventsMatch && !attachmentsMatch && !notesMatch && !noteCreateMatch && !noteUpdateMatch && !noteDeleteMatch && !noteAttachmentsMatch && !noteAttachmentCreateMatch && !noteAttachmentDeleteMatch && !todosMatch && !todoCreateMatch && !todoUpdateMatch && !todoDeleteMatch && !conversationsMatch && !conversationCreateMatch && !conversationMessagesMatch && !conversationMessageCreateMatch && !conversationReadMatch && !wikiPagesMatch && !wikiPageMatch && !wikiRevisionSaveMatch && !wikiPageDeleteMatch && !wikiAttachmentCreateMatch && !reportsDohMatch && !reportsRunsMatch) {
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
    if (meStorePurchaseMatch) {
      return purchaseStoreItem(db, user, await request.json());
    }
    if (mePushTokenMatch) {
      return registerPushToken(db, user, await request.json());
    }
    if (accessRequestCreateSelfMatch) {
      return createAccessRequests(db, user, await request.json());
    }
    if (plantsListMatch) {
      return listPlants(db, user, request);
    }
    if (plantCreateMatch) {
      return createPlant(db, user, await request.json());
    }
    if (bootstrapMatch) {
      return getPlantBootstrap(db, decodePathSegment(bootstrapMatch[1]), user);
    }
    if (dailySchedulesMatch) {
      return listDailySchedules(db, request, decodePathSegment(dailySchedulesMatch[1]), user);
    }
    if (dailyScheduleMatch) {
      return getDailySchedule(db, decodePathSegment(dailyScheduleMatch[1]), decodePathSegment(dailyScheduleMatch[2]), user);
    }
    if (plantMembersMatch) {
      return listPlantMembers(db, request, decodePathSegment(plantMembersMatch[1]), user);
    }
    if (plantMemberCreateMatch) {
      return addPlantMember(db, decodePathSegment(plantMemberCreateMatch[1]), await request.json(), user);
    }
    if (plantMemberUpdateMatch) {
      return updatePlantMember(db, decodePathSegment(plantMemberUpdateMatch[1]), decodePathSegment(plantMemberUpdateMatch[2]), await request.json(), user);
    }
    if (plantMemberDeleteMatch) {
      return deletePlantMember(db, decodePathSegment(plantMemberDeleteMatch[1]), decodePathSegment(plantMemberDeleteMatch[2]), user);
    }
    if (accessRequestsMatch) {
      return listAccessRequests(db, request, decodePathSegment(accessRequestsMatch[1]), user);
    }
    if (accessRequestUpdateMatch) {
      return updateAccessRequest(db, decodePathSegment(accessRequestUpdateMatch[1]), decodePathSegment(accessRequestUpdateMatch[2]), await request.json(), user);
    }
    if (statusConfigMatch) {
      return getStatusConfig(db, decodePathSegment(statusConfigMatch[1]), user);
    }
    if (statusConfigUpdateMatch) {
      return updateStatusConfig(db, decodePathSegment(statusConfigUpdateMatch[1]), await request.json(), user);
    }
    if (pressConfigMatch) {
      return getPressConfig(db, decodePathSegment(pressConfigMatch[1]), user);
    }
    if (pressConfigUpdateMatch) {
      return updatePressConfig(db, decodePathSegment(pressConfigUpdateMatch[1]), await request.json(), user);
    }
    if (storeConfigMatch) {
      return getStoreConfig(db, decodePathSegment(storeConfigMatch[1]), user);
    }
    if (storeConfigUpdateMatch) {
      return updateStoreConfig(db, decodePathSegment(storeConfigUpdateMatch[1]), await request.json(), user);
    }
    if (roleAlertRoutingMatch) {
      return getRoleAlertRouting(db, decodePathSegment(roleAlertRoutingMatch[1]), user);
    }
    if (roleAlertRoutingUpdateMatch) {
      return updateRoleAlertRouting(db, decodePathSegment(roleAlertRoutingUpdateMatch[1]), await request.json(), user);
    }
    if (gamificationMatch) {
      return getGamificationState(db, decodePathSegment(gamificationMatch[1]), user);
    }
    if (gamificationAwardMatch) {
      return awardGamification(db, decodePathSegment(gamificationAwardMatch[1]), await request.json(), user);
    }
    if (gamificationAdminMatch) {
      return getGamificationAdmin(db, decodePathSegment(gamificationAdminMatch[1]), user);
    }
    if (gamificationAdminUpdateMatch) {
      return updateGamificationAdmin(db, decodePathSegment(gamificationAdminUpdateMatch[1]), await request.json(), user);
    }
    if (gamificationLeaderboardResetMatch) {
      return resetGamificationLeaderboard(db, decodePathSegment(gamificationLeaderboardResetMatch[1]), await request.json(), user);
    }
    if (userDirectoryMatch) {
      return listUserDirectory(db, user);
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
    if (similarFixesMatch) {
      return findSimilarFixes(db, decodePathSegment(similarFixesMatch[1]), await request.json(), user, env);
    }
    if (issueSimilarFixesSaveMatch) {
      return saveIssueSimilarFixes(db, decodePathSegment(issueSimilarFixesSaveMatch[1]), decodePathSegment(issueSimilarFixesSaveMatch[2]), await request.json(), user);
    }
    if (issueSimilarFixesGetMatch) {
      return getIssueSimilarFixes(db, decodePathSegment(issueSimilarFixesGetMatch[1]), decodePathSegment(issueSimilarFixesGetMatch[2]), user);
    }
    if (issueCreateMatch) {
      return upsertIssueWriteBundle(db, decodePathSegment(issueCreateMatch[1]), await request.json(), user);
    }
    if (issueMatch) {
      return getIssue(db, decodePathSegment(issueMatch[1]), decodePathSegment(issueMatch[2]), user);
    }
    if (issueUpdateMatch) {
      const plantId = decodePathSegment(issueUpdateMatch[1]);
      const issueId = decodePathSegment(issueUpdateMatch[2]);
      const body = await request.json();
      const existing = await first(
        db,
        'SELECT issue_id FROM issues WHERE plant_id = ? AND issue_id = ? LIMIT 1',
        plantId,
        issueId
      );
      if (!existing) {
        return jsonResponse({ error: 'Issue not found' }, { status: 404 });
      }
      return upsertIssueWriteBundle(
        db,
        plantId,
        { ...body, issueId },
        user,
        // Only a purpose-built creation-time editor may opt into changing this.
        // Full issue writes such as workflow updates must leave it untouched.
        { updateCreatedAt: body.updateCreatedAt === true }
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
    if (notesMatch) {
      return listNotes(db, request, decodePathSegment(notesMatch[1]), user);
    }
    if (noteCreateMatch) {
      return createNote(db, decodePathSegment(noteCreateMatch[1]), await request.json(), user);
    }
    if (noteUpdateMatch) {
      return updateNote(db, decodePathSegment(noteUpdateMatch[1]), decodePathSegment(noteUpdateMatch[2]), await request.json(), user);
    }
    if (noteDeleteMatch) {
      return deleteNote(db, decodePathSegment(noteDeleteMatch[1]), decodePathSegment(noteDeleteMatch[2]), user);
    }
    if (noteAttachmentsMatch) {
      return listNoteAttachments(db, decodePathSegment(noteAttachmentsMatch[1]), decodePathSegment(noteAttachmentsMatch[2]), user);
    }
    if (noteAttachmentCreateMatch) {
      return createNoteAttachment(db, decodePathSegment(noteAttachmentCreateMatch[1]), decodePathSegment(noteAttachmentCreateMatch[2]), await request.json(), user);
    }
    if (noteAttachmentDeleteMatch) {
      return deleteNoteAttachment(
        db,
        decodePathSegment(noteAttachmentDeleteMatch[1]),
        decodePathSegment(noteAttachmentDeleteMatch[2]),
        decodePathSegment(noteAttachmentDeleteMatch[3]),
        user
      );
    }
    if (todosMatch) {
      return listTodos(db, request, decodePathSegment(todosMatch[1]), user);
    }
    if (todoCreateMatch) {
      return createTodo(db, decodePathSegment(todoCreateMatch[1]), await request.json(), user);
    }
    if (todoUpdateMatch) {
      return updateTodo(db, decodePathSegment(todoUpdateMatch[1]), decodePathSegment(todoUpdateMatch[2]), await request.json(), user);
    }
    if (todoDeleteMatch) {
      return deleteTodo(db, decodePathSegment(todoDeleteMatch[1]), decodePathSegment(todoDeleteMatch[2]), user);
    }
    if (conversationsMatch) {
      return listConversations(db, request, decodePathSegment(conversationsMatch[1]), user);
    }
    if (conversationCreateMatch) {
      return createConversation(db, decodePathSegment(conversationCreateMatch[1]), await request.json(), user);
    }
    if (conversationMessagesMatch) {
      return listConversationMessages(db, decodePathSegment(conversationMessagesMatch[1]), decodePathSegment(conversationMessagesMatch[2]), user);
    }
    if (conversationMessageCreateMatch) {
      return createConversationMessage(db, decodePathSegment(conversationMessageCreateMatch[1]), decodePathSegment(conversationMessageCreateMatch[2]), await request.json(), user);
    }
    if (conversationReadMatch) {
      return markConversationRead(db, decodePathSegment(conversationReadMatch[1]), decodePathSegment(conversationReadMatch[2]), await request.json(), user);
    }
    if (wikiPagesMatch) {
      return listWikiPages(db, request, decodePathSegment(wikiPagesMatch[1]), user);
    }
    if (wikiPageMatch) {
      return getWikiPageDetail(db, request, decodePathSegment(wikiPageMatch[1]), decodePathSegment(wikiPageMatch[2]), user);
    }
    if (wikiRevisionSaveMatch) {
      return saveWikiRevision(db, request, decodePathSegment(wikiRevisionSaveMatch[1]), decodePathSegment(wikiRevisionSaveMatch[2]), await request.json(), user);
    }
    if (wikiPageDeleteMatch) {
      return deleteWikiPage(db, request, decodePathSegment(wikiPageDeleteMatch[1]), decodePathSegment(wikiPageDeleteMatch[2]), user);
    }
    if (wikiAttachmentCreateMatch) {
      return createWikiAttachment(db, request, decodePathSegment(wikiAttachmentCreateMatch[1]), decodePathSegment(wikiAttachmentCreateMatch[2]), await request.json(), user);
    }
    if (reportsDohMatch) {
      return getDohReport(db, decodePathSegment(reportsDohMatch[1]), user);
    }
    if (reportsRunsMatch) {
      return getRunsReport(db, decodePathSegment(reportsRunsMatch[1]), user);
    }
    return null;
  } catch (error) {
    return errorResponse(error);
  }
}

function normalizeRunKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function inferMoldCandidate(row) {
  const source = [row.notes, row.mc, row.description].map(v => String(v || '')).join(' ');
  const explicit = source.match(/\b(?:mold|mould|tool|die|mc)\s*#?\s*[:\-]?\s*([A-Z]?\d[\w.-]{2,})\b/i)
    || source.match(/\b(M[-\s]?\d[\w.-]{2,})\b/i);
  if (explicit?.[1]) {
    return {
      key: explicit[1].toUpperCase().replace(/\s+/g, ''),
      source: 'inferred',
      confidence: 'explicit-token'
    };
  }

  const partNumber = normalizeRunKey(row.part_number);
  const compact = partNumber.replace(/[^A-Za-z0-9]/g, '');
  if (compact.length >= 4) {
    return {
      key: `M-${compact.slice(0, Math.min(6, compact.length)).toUpperCase()}`,
      source: 'inferred',
      confidence: 'part-similarity'
    };
  }

  return {
    key: '',
    source: 'inferred',
    confidence: 'none'
  };
}

async function getRunsReport(db, plantId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const query = `
    SELECT r.schedule_date, r.shift, r.press, r.part_number, p.description, r.cavity, r.doh, r.notes, r.mc, r.section_key
    FROM daily_schedule_rows r
    LEFT JOIN parts p ON r.part_number = p.part_number
    WHERE r.plant_id = ?
      AND r.press IS NOT NULL
      AND r.press != ''
      AND r.part_number IS NOT NULL
      AND r.part_number != ''
    ORDER BY r.schedule_date ASC, r.press ASC
  `;
  const { results } = await db.prepare(query).bind(plantId).all();
  const rows = [];
  const entities = {};

  for (const row of (results || [])) {
    const partNumber = normalizeRunKey(row.part_number);
    const description = normalizeRunKey(row.description);
    const press = normalizeRunKey(row.press);
    const dateKey = String(row.schedule_date || '').split('T')[0];
    if (!partNumber || !press || !dateKey) continue;

    const mold = inferMoldCandidate(row);
    const entityKey = partNumber;
    const record = {
      id: `${dateKey}:${press}:${partNumber}:${row.section_key || ''}`,
      scheduleDate: dateKey,
      shift: row.shift == null ? '' : String(row.shift),
      press,
      partNumber,
      description,
      moldKey: mold.key,
      moldSource: mold.source,
      moldConfidence: mold.confidence,
      cavity: row.cavity == null ? '' : String(row.cavity),
      doh: row.doh == null || row.doh === '' ? null : Number(row.doh),
      notes: normalizeRunKey(row.notes),
      mc: normalizeRunKey(row.mc),
      section: row.section_key || ''
    };
    rows.push(record);

    if (!entities[entityKey]) {
      entities[entityKey] = {
        key: entityKey,
        partNumber,
        description,
        moldKey: mold.key,
        moldSource: mold.source,
        moldConfidence: mold.confidence,
        runs: 0,
        presses: {},
        dates: {}
      };
    }
    const entity = entities[entityKey];
    if (!entity.description && description) entity.description = description;
    if (!entity.moldKey && mold.key) {
      entity.moldKey = mold.key;
      entity.moldSource = mold.source;
      entity.moldConfidence = mold.confidence;
    }
    entity.runs += 1;
    entity.dates[dateKey] = (entity.dates[dateKey] || 0) + 1;
    if (!entity.presses[press]) entity.presses[press] = { press, runs: 0, lastRun: dateKey };
    entity.presses[press].runs += 1;
    if (dateKey > entity.presses[press].lastRun) entity.presses[press].lastRun = dateKey;
  }

  const entityList = Object.values(entities)
    .map(entity => ({
      ...entity,
      presses: Object.values(entity.presses).sort((a, b) => b.runs - a.runs || b.lastRun.localeCompare(a.lastRun)),
      lastRun: Object.keys(entity.dates).sort().pop() || ''
    }))
    .sort((a, b) => b.runs - a.runs || a.partNumber.localeCompare(b.partNumber));

  return jsonResponse({
    success: true,
    data: {
      entities: entityList,
      rows
    }
  });
}

async function getDohReport(db, plantId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const query = "SELECT r.schedule_date, r.part_number, p.description, r.doh FROM daily_schedule_rows r LEFT JOIN parts p ON r.part_number = p.part_number WHERE r.plant_id = ? AND r.part_number IS NOT NULL AND r.part_number != '' AND r.doh IS NOT NULL AND r.doh != '' ORDER BY r.schedule_date ASC";
  const { results } = await db.prepare(query).bind(plantId).all();
  
  const series = {};
  const metadata = {};
  
  for (const row of (results || [])) {
    const part = row.part_number;
    if (!series[part]) series[part] = {};
    if (!metadata[part]) {
      metadata[part] = { description: row.description || '', count: 0 };
    } else if (row.description && !metadata[part].description) {
      metadata[part].description = row.description;
    }
    
    let dohValue = parseFloat(row.doh);
    if (!isNaN(dohValue)) {
      const dateKey = (row.schedule_date || '').split('T')[0];
      if (dateKey) {
        if (series[part][dateKey] === undefined) {
          metadata[part].count++;
        }
        series[part][dateKey] = dohValue;
      }
    }
  }

  return jsonResponse({
    success: true,
    data: {
      series,
      metadata
    }
  });
}
