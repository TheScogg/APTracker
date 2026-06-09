function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function serializeUserContextRows(rows = []) {
  if (!rows.length) {
    return {
      user: null,
      plants: []
    };
  }

  const first = rows[0];
  return {
    user: {
      uid: first.uid,
      email: first.email,
      displayName: first.display_name,
      fullName: first.full_name,
      ssoNumber: first.sso_number,
      photoUrl: first.photo_url,
      lastPlantId: first.last_plant_id,
      requestedPlantIds: parseJson(first.requested_plant_ids_json, []),
      profileOnboarding: parseJson(first.profile_onboarding_json, null),
      globalLifetimeXp: Number(first.global_lifetime_xp || 0)
    },
    plants: rows
      .filter(row => row.plant_id)
      .map(row => ({
        plantId: row.plant_id,
        plantName: row.plant_name,
        role: row.role,
        isActive: Boolean(row.is_active),
        permissions: parseJson(row.permissions_json, {})
      }))
  };
}

export function serializePlant(row) {
  if (!row) return null;
  return {
    plantId: row.plant_id,
    name: row.name,
    code: row.code,
    location: row.location,
    timezone: row.timezone,
    isActive: Boolean(row.is_active),
    createdByUid: row.created_by_uid,
    updatedByUid: row.updated_by_uid,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    schemaVersion: row.schema_version
  };
}

export function serializePlantMember(row) {
  if (!row) return null;
  return {
    role: row.role,
    isActive: Boolean(row.is_active),
    permissions: parseJson(row.permissions_json, {}),
    alertCategorySubscriptions: parseJson(row.alert_category_subscriptions_json, []),
    jobRoleKeys: parseJson(row.job_role_keys_json, []),
    jobFeeds: parseJson(row.job_feeds_json, [])
  };
}

export function serializeStatusConfig(row) {
  if (!row) return null;
  return {
    plantId: row.plant_id,
    statuses: parseJson(row.statuses_json, {}),
    subcategoryRoutes: parseJson(row.subcategory_routes_json, null),
    updatedByUid: row.updated_by_uid,
    updatedAt: toIso(row.updated_at)
  };
}

export function serializePressConfig(row) {
  if (!row) return null;
  return {
    plantId: row.plant_id,
    presses: parseJson(row.presses_json, []),
    updatedByUid: row.updated_by_uid,
    updatedAt: toIso(row.updated_at)
  };
}

export function serializeGamificationConfig(row) {
  if (!row) return null;
  return {
    plantId: row.plant_id,
    config: parseJson(row.config_json, {}),
    updatedAt: toIso(row.updated_at)
  };
}

export function serializeUserGameStats(row) {
  if (!row) return null;
  return {
    plantId: row.plant_id,
    uid: row.uid,
    userId: row.user_id,
    displayName: row.display_name,
    totals: parseJson(row.totals_json, {}),
    streaks: parseJson(row.streaks_json, {}),
    lastEventAt: toIso(row.last_event_at),
    updatedAt: toIso(row.updated_at),
    schemaVersion: row.schema_version
  };
}

export function serializeUserBadges(row) {
  if (!row) return null;
  return {
    plantId: row.plant_id,
    uid: row.uid,
    earnedBadges: parseJson(row.earned_badges_json, {}),
    updatedAt: toIso(row.updated_at)
  };
}

export function serializeGameLeaderboard(row) {
  if (!row) return null;
  return {
    plantId: row.plant_id,
    boardId: row.board_id,
    entries: parseJson(row.entries_json, []),
    entriesByUid: parseJson(row.entries_by_uid_json, {}),
    updatedAt: toIso(row.updated_at),
    schemaVersion: row.schema_version
  };
}

export function serializeGameMission(row) {
  if (!row) return null;
  const raw = parseJson(row.raw_json, null) || {};
  return {
    id: row.mission_id,
    plantId: row.plant_id,
    name: row.name,
    description: row.description,
    objective: parseJson(row.objective_json, {}),
    rewards: parseJson(row.rewards_json, {}),
    isActive: Boolean(row.is_active),
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    updatedAt: toIso(row.updated_at),
    ...raw
  };
}

export function serializeGameMissionProgress(row) {
  if (!row) return null;
  const raw = parseJson(row.raw_json, null) || {};
  return {
    plantId: row.plant_id,
    missionId: row.mission_id,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    current: row.current_value,
    target: row.target_value,
    percent: row.percent,
    completed: Boolean(row.completed),
    updatedAt: toIso(row.updated_at),
    ...raw
  };
}

export function serializeRoleFeedAlert(row) {
  if (!row) return null;
  return {
    alertId: row.alert_id,
    plantId: row.plant_id,
    issueId: row.issue_id,
    statusKey: row.status_key,
    subcategoryKey: row.subcategory_key,
    title: row.title,
    body: row.body,
    isResolved: Boolean(row.is_resolved),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    categoryKey: row.category_key,
    categoryKeys: parseJson(row.category_keys_json, []),
    workflowId: row.workflow_id,
    feedKey: row.feed_key,
    feedLabel: row.feed_label,
    recipientUserIds: parseJson(row.recipient_user_ids_json, []),
    requiredJobRoleKeys: parseJson(row.required_job_role_keys_json, []),
    createdBy: parseJson(row.created_by_json, null),
    raw: parseJson(row.raw_json, null)
  };
}

export function serializeIssue(row) {
  if (!row) return null;
  return {
    issueId: row.issue_id,
    plantId: row.plant_id,
    pressId: row.press_id,
    machineCode: row.machine_code,
    rowId: row.row_id,
    title: row.title,
    note: row.note,
    description: row.description,
    issueType: row.issue_type,
    priority: row.priority,
    severity: row.severity,
    highPriority: Boolean(row.high_priority),
    currentStatusKey: row.current_status_key,
    currentSubStatusKey: row.current_sub_status_key,
    currentStatusLabel: row.current_status_label,
    currentSubStatusLabel: row.current_sub_status_label,
    currentStatusColor: row.current_status_color,
    currentStatusEnteredAt: toIso(row.current_status_entered_at),
    currentStatusEnteredByUid: row.current_status_entered_by_uid,
    currentStatusEnteredByName: row.current_status_entered_by_name,
    isOpen: Boolean(row.is_open),
    isResolved: Boolean(row.is_resolved),
    openedAt: toIso(row.opened_at),
    resolvedAt: toIso(row.resolved_at),
    closedAt: toIso(row.closed_at),
    reopenedCount: row.reopened_count,
    assignedTeam: row.assigned_team,
    assignedUserUid: row.assigned_user_uid,
    assignedUserName: row.assigned_user_name,
    serialRequired: Boolean(row.serial_required),
    serialCaptured: Boolean(row.serial_captured),
    serialValue: row.serial_value,
    reportingDateKey: row.reporting_date_key,
    reportingWeekKey: row.reporting_week_key,
    reportingMonthKey: row.reporting_month_key,
    reportingShiftKey: row.reporting_shift_key,
    workflowState: row.workflow_state,
    workflowStateByEntry: parseJson(row.workflow_state_by_entry_json, null),
    workflowStateHistory: parseJson(row.workflow_state_history_json, null),
    legacyStatusHistory: parseJson(row.legacy_status_history_json, null),
    latestNotePreview: row.latest_note_preview,
    tags: parseJson(row.tags_json, []),
    photoCount: row.photo_count,
    createdByUid: row.created_by_uid,
    createdByName: row.created_by_name,
    updatedByUid: row.updated_by_uid,
    updatedByName: row.updated_by_name,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    schemaVersion: row.schema_version
  };
}

export function serializeIssueEvent(row) {
  if (!row) return null;
  return {
    eventId: row.event_id,
    issueId: row.issue_id,
    plantId: row.plant_id,
    eventType: row.event_type,
    eventAt: toIso(row.event_at),
    actorUid: row.actor_uid,
    actorName: row.actor_name,
    payload: parseJson(row.payload_json, null),
    dedupeKey: row.dedupe_key,
    createdAt: toIso(row.created_at)
  };
}

export function serializeIssueAttachment(row) {
  if (!row) return null;
  return {
    attachmentId: row.attachment_id,
    issueId: row.issue_id,
    plantId: row.plant_id,
    type: row.type,
    fileName: row.file_name,
    contentType: row.content_type,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    thumbnailPath: row.thumbnail_path,
    downloadUrl: row.download_url,
    uploadedByUid: row.uploaded_by_uid,
    uploadedByName: row.uploaded_by_name,
    uploadedAt: toIso(row.uploaded_at),
    sizeBytes: row.size_bytes,
    schemaVersion: row.schema_version
  };
}

export const __testOnly = {
  parseJson,
  toIso
};
