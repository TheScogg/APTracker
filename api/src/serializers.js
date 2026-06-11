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
      themePrefs: parseJson(first.theme_prefs_json, null),
      requestedPlantIds: parseJson(first.requested_plant_ids_json, []),
      profileOnboarding: parseJson(first.profile_onboarding_json, null),
      globalLifetimeXp: Number(first.global_lifetime_xp || 0),
      globalXpSpent: Number(first.global_xp_spent || 0),
      inventory: parseJson(first.inventory_json, null)
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

export function serializePlantStoreConfig(row) {
  if (!row) return null;
  return {
    plantId: row.plant_id,
    config: parseJson(row.config_json, {}),
    updatedAt: toIso(row.updated_at)
  };
}

export function serializeRoleAlertRoutingConfig(row) {
  if (!row) return null;
  return {
    plantId: row.plant_id,
    rules: parseJson(row.rules_json, []),
    updatedByUid: row.updated_by_uid,
    updatedAt: toIso(row.updated_at)
  };
}

export function serializeDailySchedule(row) {
  if (!row) return null;
  const raw = parseJson(row.raw_json, null) || {};
  return {
    plantId: row.plant_id,
    scheduleDate: row.schedule_date,
    shift: row.shift,
    lineSpeed: row.line_speed == null ? null : Number(row.line_speed),
    totalPlannedPcs: row.total_planned_pcs == null ? null : Number(row.total_planned_pcs),
    sourceFileName: row.source_file_name,
    sourceFileType: row.source_file_type,
    status: row.status,
    notes: row.notes,
    page1Count: Number(row.page1_count || 0),
    page2Count: Number(row.page2_count || 0),
    northBayChangesCount: Number(row.north_bay_changes_count || 0),
    southBayChangesCount: Number(row.south_bay_changes_count || 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    ...raw
  };
}

export function serializeDailyScheduleRow(row) {
  if (!row) return null;
  const raw = parseJson(row.raw_json, null) || {};
  return {
    plantId: row.plant_id,
    scheduleDate: row.schedule_date,
    section: row.section_key,
    rowId: row.row_id,
    press: row.press,
    partNumber: row.part_number,
    description: row.description,
    cavity: row.cavity,
    doh: row.doh == null ? null : Number(row.doh),
    labelsPerShift: row.labels_per_shift == null ? null : Number(row.labels_per_shift),
    mc: row.mc,
    notes: row.notes,
    shift: row.shift,
    partStorageLocation: parseJson(row.part_storage_location_json, []),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    ...raw
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
    timer: row.timer_enabled
      ? {
          enabled: Boolean(row.timer_enabled),
          startedAt: toIso(row.timer_started_at),
          dueAt: toIso(row.timer_due_at),
          dueAtMs: row.timer_due_at_ms == null ? null : Number(row.timer_due_at_ms),
          durationMinutes: row.timer_duration_minutes == null ? null : Number(row.timer_duration_minutes),
          notificationStatus: row.timer_notification_status,
          notificationOwnerUid: row.timer_notification_owner_uid,
          notificationRequestedBy: parseJson(row.timer_notification_requested_by_json, null),
          notificationDelivery: parseJson(row.timer_notification_delivery_json, null)
        }
      : null,
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

export function serializeNote(row) {
  if (!row) return null;
  return {
    id: row.note_id,
    noteId: row.note_id,
    plantId: row.plant_id,
    title: row.title,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    checklistItems: parseJson(row.checklist_items_json, []),
    tags: parseJson(row.tags_json, []),
    pressId: row.press_id,
    machineCode: row.machine_code,
    issueId: row.issue_id,
    isPinned: Boolean(row.is_pinned),
    isArchived: Boolean(row.is_archived),
    photoCount: Number(row.photo_count || 0),
    searchText: row.search_text || '',
    createdBy: row.created_by_uid ? { uid: row.created_by_uid } : null,
    updatedBy: row.updated_by_uid ? { uid: row.updated_by_uid } : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    schemaVersion: 1
  };
}

export function serializeNoteAttachment(row) {
  if (!row) return null;
  return {
    id: row.attachment_id,
    attachmentId: row.attachment_id,
    noteId: row.note_id,
    plantId: row.plant_id,
    storagePath: row.storage_path,
    storageBucket: row.storage_bucket,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes == null ? 0 : Number(row.size_bytes),
    url: row.url,
    downloadURL: row.url,
    uploadedBy: parseJson(row.uploaded_by_json, null),
    uploadedAt: toIso(row.uploaded_at),
    schemaVersion: row.schema_version
  };
}

export function serializeConversation(row) {
  if (!row) return null;
  const lastMessage = parseJson(row.last_message_json, null);
  return {
    id: row.conversation_id,
    conversationId: row.conversation_id,
    plantId: row.plant_id,
    type: row.type || 'group',
    title: row.title || '',
    pressId: row.press_id || '',
    memberIds: parseJson(row.member_ids_json, []),
    memberCount: Number(row.member_count || 0),
    createdBy: row.created_by_uid || row.created_by_name
      ? { uid: row.created_by_uid || '', name: row.created_by_name || '' }
      : null,
    createdAt: toIso(row.created_at),
    lastMessageText: row.last_message_text || '',
    lastMessageAt: toIso(row.last_message_at),
    lastMessage: lastMessage ? {
      ...lastMessage,
      id: lastMessage.id || null,
      sender: lastMessage.sender || null,
      at: toIso(lastMessage.at || row.last_message_at)
    } : null,
    isArchived: Boolean(row.is_archived),
    myMembership: row.member_uid ? {
      uid: row.member_uid,
      role: row.member_role || 'member',
      joinedAt: toIso(row.member_joined_at),
      lastReadAt: toIso(row.member_last_read_at),
      lastReadMessageId: row.member_last_read_message_id || null,
      unreadCount: Number(row.member_unread_count || 0),
      muted: Boolean(row.member_muted)
    } : null
  };
}

export function serializeConversationMessage(row) {
  if (!row) return null;
  return {
    id: row.message_id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    plantId: row.plant_id,
    type: row.type || 'text',
    text: row.body || '',
    sender: {
      uid: row.sender_uid || '',
      name: row.sender_name || ''
    },
    mentions: parseJson(row.mentions_json, []),
    attachments: parseJson(row.attachments_json, []),
    createdAt: toIso(row.created_at),
    editedAt: toIso(row.edited_at),
    deletedAt: toIso(row.deleted_at)
  };
}

export function serializeWikiPage(row) {
  if (!row) return null;
  return {
    id: row.page_id,
    pageId: row.page_id,
    wikiPageRowId: row.wiki_page_row_id,
    plantId: row.plant_id,
    scope: row.scope,
    pressId: row.press_id || '',
    title: row.title || '',
    slug: row.slug || '',
    summary: row.summary || '',
    tags: parseJson(row.tags_json, []),
    parentPageId: row.parent_page_id || null,
    sortOrder: row.sort_order == null ? null : Number(row.sort_order),
    isPinned: Boolean(row.is_pinned),
    isLocked: Boolean(row.is_locked),
    visibility: row.visibility || '',
    currentRevisionId: row.current_revision_id || null,
    photoCount: Number(row.photo_count || 0),
    searchText: row.search_text || '',
    createdBy: parseJson(row.created_by_json, null),
    updatedBy: parseJson(row.updated_by_json, null),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    lastActivityAt: toIso(row.last_activity_at),
    lastVerifiedAt: toIso(row.last_verified_at),
    lastVerifiedBy: row.last_verified_by || null,
    schemaVersion: Number(row.schema_version || 1)
  };
}

export function serializeWikiRevision(row) {
  if (!row) return null;
  return {
    id: row.revision_id,
    revisionId: row.revision_id,
    wikiRevisionRowId: row.wiki_revision_row_id,
    wikiPageRowId: row.wiki_page_row_id,
    plantId: row.plant_id,
    scope: row.scope,
    pressId: row.press_id || '',
    pageId: row.page_id,
    body: row.body || '',
    changeNote: row.change_note || '',
    prevRevisionId: row.prev_revision_id || null,
    editedBy: parseJson(row.edited_by_json, null),
    editedAt: toIso(row.edited_at)
  };
}

export function serializeWikiAttachment(row) {
  if (!row) return null;
  return {
    id: row.attachment_id,
    attachmentId: row.attachment_id,
    wikiAttachmentRowId: row.wiki_attachment_row_id,
    wikiPageRowId: row.wiki_page_row_id,
    plantId: row.plant_id,
    scope: row.scope,
    pressId: row.press_id || '',
    pageId: row.page_id,
    storagePath: row.storage_path,
    contentType: row.content_type || '',
    caption: row.caption || '',
    linkedRevisionId: row.linked_revision_id || null,
    uploadedBy: parseJson(row.uploaded_by_json, null),
    uploadedAt: toIso(row.uploaded_at),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    url: row.url || '',
    downloadURL: row.url || '',
    schemaVersion: Number(row.schema_version || 1)
  };
}

export const __testOnly = {
  parseJson,
  toIso
};
