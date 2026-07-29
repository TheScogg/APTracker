import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import {
  argValue,
  executeD1Command,
  extractD1Rows,
  resolveD1DatabaseName,
  resolveD1ExecutionMode
} from './d1-cli.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function requireArg(name, value) {
  if (!value) {
    throw new Error(`Missing required argument ${name}. Example: node scripts/sql-parity-check.mjs --plant plant_a`);
  }
  return value;
}

function initFirebaseAdmin() {
  if (getApps().length) return getApps()[0];
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    return initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) });
  }

  const keyPath = path.join(repoRoot, 'serviceAccountKey.json');
  if (!existsSync(keyPath)) {
    throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON or place serviceAccountKey.json in the repo root.');
  }
  return initializeApp({
    credential: cert(JSON.parse(readFileSync(keyPath, 'utf8')))
  });
}

function statusFromFirestoreIssue(data = {}) {
  if (data.currentStatus?.statusKey) return String(data.currentStatus.statusKey);
  if (data.lifecycle?.isResolved === true || data.resolved === true) return 'resolved';
  return 'open';
}

function incrementMap(map, key) {
  const normalized = String(key || 'unknown');
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function sortedObjectFromMap(map) {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function loadFirestoreCounts(db, plantId) {
  const plantRef = db.collection('plants').doc(plantId);
  const [
    issuesSnap,
    notesSnap,
    plantTodosSnap,
    conversationsSnap,
    sharedWikiPagesSnap,
    userGameStatsSnap,
    gameEventsSnap,
    leaderboardsSnap,
    missionsSnap,
    userBadgesSnap,
    storeConfigSnap,
    dailySchedulesSnap,
    roleFeedAlertsSnap,
    pressNotesSnap,
    membersSnap,
    pressesSnap
  ] = await Promise.all([
    plantRef.collection('issues').get(),
    plantRef.collection('notes').get(),
    plantRef.collection('todos').get(),
    plantRef.collection('conversations').get(),
    plantRef.collection('wikiPages').get(),
    plantRef.collection('userGameStats').get(),
    plantRef.collection('gameEvents').get(),
    plantRef.collection('leaderboards').get(),
    plantRef.collection('missions').get(),
    plantRef.collection('userBadges').get(),
    plantRef.collection('config').doc('store').get(),
    plantRef.collection('dailySchedules').get(),
    plantRef.collection('roleFeedAlerts').get(),
    plantRef.collection('pressNotes').get(),
    plantRef.collection('members').get(),
    plantRef.collection('presses').get()
  ]);
  const issueIds = [];
  const statusCounts = new Map();
  let openCount = 0;
  let resolvedCount = 0;

  issuesSnap.forEach(docSnap => {
    issueIds.push(docSnap.id);
    const data = docSnap.data() || {};
    const statusKey = statusFromFirestoreIssue(data);
    incrementMap(statusCounts, statusKey);
    if (statusKey === 'resolved') resolvedCount += 1;
    else openCount += 1;
  });

  let attachmentCount = 0;
  let eventCount = 0;
  for (const issueId of issueIds) {
    const [attachmentsSnap, eventsSnap] = await Promise.all([
      db.collection('plants').doc(plantId).collection('issues').doc(issueId).collection('attachments').count().get(),
      db.collection('plants').doc(plantId).collection('issues').doc(issueId).collection('events').count().get()
    ]);
    attachmentCount += attachmentsSnap.data().count || 0;
    eventCount += eventsSnap.data().count || 0;
  }

  let noteAttachmentCount = 0;
  for (const noteSnap of notesSnap.docs) {
    const attachmentsSnap = await noteSnap.ref.collection('attachments').count().get();
    noteAttachmentCount += attachmentsSnap.data().count || 0;
  }

  let conversationMemberCount = 0;
  let messageCount = 0;
  for (const conversationSnap of conversationsSnap.docs) {
    const [membersCountSnap, messagesCountSnap] = await Promise.all([
      conversationSnap.ref.collection('members').count().get(),
      conversationSnap.ref.collection('messages').count().get()
    ]);
    conversationMemberCount += membersCountSnap.data().count || 0;
    messageCount += messagesCountSnap.data().count || 0;
  }

  let pressWikiPages = 0;
  let pressWikiRevisions = 0;
  let pressWikiAttachments = 0;
  for (const pressSnap of pressesSnap.docs) {
    const wikiPagesSnap = await pressSnap.ref.collection('wikiPages').get();
    pressWikiPages += wikiPagesSnap.size;
    for (const pageSnap of wikiPagesSnap.docs) {
      const [revisionsCountSnap, attachmentsCountSnap] = await Promise.all([
        pageSnap.ref.collection('revisions').count().get(),
        pageSnap.ref.collection('attachments').count().get()
      ]);
      pressWikiRevisions += revisionsCountSnap.data().count || 0;
      pressWikiAttachments += attachmentsCountSnap.data().count || 0;
    }
  }

  let sharedWikiRevisions = 0;
  let sharedWikiAttachments = 0;
  for (const pageSnap of sharedWikiPagesSnap.docs) {
    const [revisionsCountSnap, attachmentsCountSnap] = await Promise.all([
      pageSnap.ref.collection('revisions').count().get(),
      pageSnap.ref.collection('attachments').count().get()
    ]);
    sharedWikiRevisions += revisionsCountSnap.data().count || 0;
    sharedWikiAttachments += attachmentsCountSnap.data().count || 0;
  }

  let missionProgressCount = 0;
  for (const missionSnap of missionsSnap.docs) {
    const progressCountSnap = await missionSnap.ref.collection('progress').count().get();
    missionProgressCount += progressCountSnap.data().count || 0;
  }

  let dailyScheduleRowCount = 0;
  let dailySchedulePage1Count = 0;
  let dailySchedulePage2Count = 0;
  let dailyScheduleNorthBayChangesCount = 0;
  let dailyScheduleSouthBayChangesCount = 0;
  for (const scheduleSnap of dailySchedulesSnap.docs) {
    const [
      page1CountSnap,
      page2CountSnap,
      northBayChangesCountSnap,
      southBayChangesCountSnap
    ] = await Promise.all([
      scheduleSnap.ref.collection('page1').count().get(),
      scheduleSnap.ref.collection('page2').count().get(),
      scheduleSnap.ref.collection('northBayChanges').count().get(),
      scheduleSnap.ref.collection('southBayChanges').count().get()
    ]);
    dailyScheduleRowCount +=
      (page1CountSnap.data().count || 0)
      + (page2CountSnap.data().count || 0)
      + (northBayChangesCountSnap.data().count || 0)
      + (southBayChangesCountSnap.data().count || 0);
    dailySchedulePage1Count += page1CountSnap.data().count || 0;
    dailySchedulePage2Count += page2CountSnap.data().count || 0;
    dailyScheduleNorthBayChangesCount += northBayChangesCountSnap.data().count || 0;
    dailyScheduleSouthBayChangesCount += southBayChangesCountSnap.data().count || 0;
  }

  let personalTodoCount = 0;
  for (const memberSnap of membersSnap.docs) {
    const todosSnap = await db.collection('users').doc(memberSnap.id).collection('todos').get();
    personalTodoCount += todosSnap.docs.filter(docSnap => String(docSnap.data()?.plantId || '') === String(plantId)).length;
  }

  return {
    issues: issuesSnap.size,
    openIssues: openCount,
    resolvedIssues: resolvedCount,
    statusCounts: sortedObjectFromMap(statusCounts),
    attachmentCount,
    eventCount,
    notes: notesSnap.size,
    noteAttachmentCount,
    sharedTodos: plantTodosSnap.size,
    personalTodos: personalTodoCount,
    conversations: conversationsSnap.size,
    conversationMembers: conversationMemberCount,
    conversationMessages: messageCount,
    sharedWikiPages: sharedWikiPagesSnap.size,
    sharedWikiRevisions,
    sharedWikiAttachments,
    pressWikiPages,
    pressWikiRevisions,
    pressWikiAttachments,
    userGameStats: userGameStatsSnap.size,
    gameEvents: gameEventsSnap.size,
    leaderboards: leaderboardsSnap.size,
    missions: missionsSnap.size,
    missionProgress: missionProgressCount,
    userBadges: userBadgesSnap.size,
    storeConfigDocs: storeConfigSnap.exists ? 1 : 0,
    dailySchedules: dailySchedulesSnap.size,
    dailyScheduleRows: dailyScheduleRowCount,
    dailySchedulePage1: dailySchedulePage1Count,
    dailySchedulePage2: dailySchedulePage2Count,
    dailyScheduleNorthBayChanges: dailyScheduleNorthBayChangesCount,
    dailyScheduleSouthBayChanges: dailyScheduleSouthBayChangesCount,
    roleFeedAlerts: roleFeedAlertsSnap.size,
    pressNotes: pressNotesSnap.size
  };
}

function valueFromRow(row, keys) {
  for (const key of keys) {
    if (row && row[key] != null) return Number(row[key]);
  }
  return 0;
}

async function loadD1Counts(databaseName, mode, plantId) {
  const issuesPayload = await executeD1Command(
    databaseName,
    `SELECT current_status_key, is_resolved FROM issues WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`,
    { mode, workdir: repoRoot }
  );
  const issueRows = extractD1Rows(issuesPayload);

  const statusCounts = new Map();
  let openCount = 0;
  let resolvedCount = 0;
  issueRows.forEach(row => {
    const statusKey = row.current_status_key || (Number(row.is_resolved) ? 'resolved' : 'open');
    incrementMap(statusCounts, statusKey);
    if (statusKey === 'resolved') resolvedCount += 1;
    else openCount += 1;
  });

  const [
    attachmentPayload,
    eventPayload,
    notesPayload,
    noteAttachmentsPayload,
    sharedTodosPayload,
    personalTodosPayload,
    conversationsPayload,
    conversationMembersPayload,
    conversationMessagesPayload,
    sharedWikiPagesPayload,
    sharedWikiRevisionsPayload,
    sharedWikiAttachmentsPayload,
    pressWikiPagesPayload,
    pressWikiRevisionsPayload,
    pressWikiAttachmentsPayload,
    userGameStatsPayload,
    gameEventsPayload,
    leaderboardsPayload,
    missionsPayload,
    missionProgressPayload,
    userBadgesPayload,
    storeConfigPayload,
    dailySchedulesPayload,
    dailyScheduleRowsPayload,
    dailySchedulePage1Payload,
    dailySchedulePage2Payload,
    dailyScheduleNorthBayChangesPayload,
    dailyScheduleSouthBayChangesPayload,
    roleFeedAlertsPayload,
    pressNotesPayload
  ] = await Promise.all([
    executeD1Command(
      databaseName,
      `SELECT COUNT(*) AS total FROM issue_attachments WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`,
      { mode, workdir: repoRoot }
    ),
    executeD1Command(
      databaseName,
      `SELECT COUNT(*) AS total FROM issue_events WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`,
      { mode, workdir: repoRoot }
    ),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM notes WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM note_attachments WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM todos WHERE plant_id = '${String(plantId).replace(/'/g, "''")}' AND scope = 'shared';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM todos WHERE plant_id = '${String(plantId).replace(/'/g, "''")}' AND scope = 'personal';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM conversations WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM conversation_members WHERE conversation_id IN (SELECT conversation_id FROM conversations WHERE plant_id = '${String(plantId).replace(/'/g, "''")}');`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM conversation_messages WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM wiki_pages WHERE plant_id = '${String(plantId).replace(/'/g, "''")}' AND scope = 'shared';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM wiki_revisions WHERE plant_id = '${String(plantId).replace(/'/g, "''")}' AND scope = 'shared';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM wiki_attachments WHERE plant_id = '${String(plantId).replace(/'/g, "''")}' AND scope = 'shared';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM wiki_pages WHERE plant_id = '${String(plantId).replace(/'/g, "''")}' AND scope = 'press';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM wiki_revisions WHERE plant_id = '${String(plantId).replace(/'/g, "''")}' AND scope = 'press';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM wiki_attachments WHERE plant_id = '${String(plantId).replace(/'/g, "''")}' AND scope = 'press';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM user_game_stats WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM game_events WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM game_leaderboards WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM game_missions WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM game_mission_progress WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM user_badges WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM plant_store_config WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM daily_schedules WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM daily_schedule_rows WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM daily_schedule_rows WHERE plant_id = '${String(plantId).replace(/'/g, "''")}' AND section_key = 'page1';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM daily_schedule_rows WHERE plant_id = '${String(plantId).replace(/'/g, "''")}' AND section_key = 'page2';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM daily_schedule_rows WHERE plant_id = '${String(plantId).replace(/'/g, "''")}' AND section_key = 'northBayChanges';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM daily_schedule_rows WHERE plant_id = '${String(plantId).replace(/'/g, "''")}' AND section_key = 'southBayChanges';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM role_feed_alerts WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot }),
    executeD1Command(databaseName, `SELECT COUNT(*) AS total FROM press_notes WHERE plant_id = '${String(plantId).replace(/'/g, "''")}';`, { mode, workdir: repoRoot })
  ]);

  return {
    issues: issueRows.length,
    openIssues: openCount,
    resolvedIssues: resolvedCount,
    statusCounts: sortedObjectFromMap(statusCounts),
    attachmentCount: valueFromRow(extractD1Rows(attachmentPayload)[0], ['total', 'COUNT(*)']),
    eventCount: valueFromRow(extractD1Rows(eventPayload)[0], ['total', 'COUNT(*)']),
    notes: valueFromRow(extractD1Rows(notesPayload)[0], ['total', 'COUNT(*)']),
    noteAttachmentCount: valueFromRow(extractD1Rows(noteAttachmentsPayload)[0], ['total', 'COUNT(*)']),
    sharedTodos: valueFromRow(extractD1Rows(sharedTodosPayload)[0], ['total', 'COUNT(*)']),
    personalTodos: valueFromRow(extractD1Rows(personalTodosPayload)[0], ['total', 'COUNT(*)']),
    conversations: valueFromRow(extractD1Rows(conversationsPayload)[0], ['total', 'COUNT(*)']),
    conversationMembers: valueFromRow(extractD1Rows(conversationMembersPayload)[0], ['total', 'COUNT(*)']),
    conversationMessages: valueFromRow(extractD1Rows(conversationMessagesPayload)[0], ['total', 'COUNT(*)']),
    sharedWikiPages: valueFromRow(extractD1Rows(sharedWikiPagesPayload)[0], ['total', 'COUNT(*)']),
    sharedWikiRevisions: valueFromRow(extractD1Rows(sharedWikiRevisionsPayload)[0], ['total', 'COUNT(*)']),
    sharedWikiAttachments: valueFromRow(extractD1Rows(sharedWikiAttachmentsPayload)[0], ['total', 'COUNT(*)']),
    pressWikiPages: valueFromRow(extractD1Rows(pressWikiPagesPayload)[0], ['total', 'COUNT(*)']),
    pressWikiRevisions: valueFromRow(extractD1Rows(pressWikiRevisionsPayload)[0], ['total', 'COUNT(*)']),
    pressWikiAttachments: valueFromRow(extractD1Rows(pressWikiAttachmentsPayload)[0], ['total', 'COUNT(*)']),
    userGameStats: valueFromRow(extractD1Rows(userGameStatsPayload)[0], ['total', 'COUNT(*)']),
    gameEvents: valueFromRow(extractD1Rows(gameEventsPayload)[0], ['total', 'COUNT(*)']),
    leaderboards: valueFromRow(extractD1Rows(leaderboardsPayload)[0], ['total', 'COUNT(*)']),
    missions: valueFromRow(extractD1Rows(missionsPayload)[0], ['total', 'COUNT(*)']),
    missionProgress: valueFromRow(extractD1Rows(missionProgressPayload)[0], ['total', 'COUNT(*)']),
    userBadges: valueFromRow(extractD1Rows(userBadgesPayload)[0], ['total', 'COUNT(*)']),
    storeConfigDocs: valueFromRow(extractD1Rows(storeConfigPayload)[0], ['total', 'COUNT(*)']),
    dailySchedules: valueFromRow(extractD1Rows(dailySchedulesPayload)[0], ['total', 'COUNT(*)']),
    dailyScheduleRows: valueFromRow(extractD1Rows(dailyScheduleRowsPayload)[0], ['total', 'COUNT(*)']),
    dailySchedulePage1: valueFromRow(extractD1Rows(dailySchedulePage1Payload)[0], ['total', 'COUNT(*)']),
    dailySchedulePage2: valueFromRow(extractD1Rows(dailySchedulePage2Payload)[0], ['total', 'COUNT(*)']),
    dailyScheduleNorthBayChanges: valueFromRow(extractD1Rows(dailyScheduleNorthBayChangesPayload)[0], ['total', 'COUNT(*)']),
    dailyScheduleSouthBayChanges: valueFromRow(extractD1Rows(dailyScheduleSouthBayChangesPayload)[0], ['total', 'COUNT(*)']),
    roleFeedAlerts: valueFromRow(extractD1Rows(roleFeedAlertsPayload)[0], ['total', 'COUNT(*)']),
    pressNotes: valueFromRow(extractD1Rows(pressNotesPayload)[0], ['total', 'COUNT(*)'])
  };
}

function diffSummary(firestoreCounts, sqlCounts) {
  const statusKeys = new Set([
    ...Object.keys(firestoreCounts.statusCounts || {}),
    ...Object.keys(sqlCounts.statusCounts || {})
  ]);
  const statusDiff = {};
  [...statusKeys].sort().forEach(key => {
    const firestoreValue = Number(firestoreCounts.statusCounts?.[key] || 0);
    const sqlValue = Number(sqlCounts.statusCounts?.[key] || 0);
    if (firestoreValue !== sqlValue) {
      statusDiff[key] = { firestore: firestoreValue, sql: sqlValue };
    }
  });

  const scalarKeys = [
    'issues',
    'openIssues',
    'resolvedIssues',
    'attachmentCount',
    'eventCount',
    'notes',
    'noteAttachmentCount',
    'sharedTodos',
    'personalTodos',
    'conversations',
    'conversationMembers',
    'conversationMessages',
    'sharedWikiPages',
    'sharedWikiRevisions',
    'sharedWikiAttachments',
    'pressWikiPages',
    'pressWikiRevisions',
    'pressWikiAttachments',
    'userGameStats',
    'gameEvents',
    'leaderboards',
    'missions',
    'missionProgress',
    'userBadges',
    'storeConfigDocs',
    'dailySchedules',
    'dailyScheduleRows',
    'dailySchedulePage1',
    'dailySchedulePage2',
    'dailyScheduleNorthBayChanges',
    'dailyScheduleSouthBayChanges',
    'roleFeedAlerts',
    'pressNotes'
  ];
  const scalarDiff = Object.fromEntries(
    scalarKeys.map(key => [key, Number(sqlCounts[key] || 0) - Number(firestoreCounts[key] || 0)])
  );

  return {
    ...scalarDiff,
    issues: sqlCounts.issues - firestoreCounts.issues,
    openIssues: sqlCounts.openIssues - firestoreCounts.openIssues,
    resolvedIssues: sqlCounts.resolvedIssues - firestoreCounts.resolvedIssues,
    attachmentCount: sqlCounts.attachmentCount - firestoreCounts.attachmentCount,
    eventCount: sqlCounts.eventCount - firestoreCounts.eventCount,
    statusDiff
  };
}

async function main() {
  const plantId = requireArg('--plant', argValue('--plant'));
  const databaseName = requireArg('--database', resolveD1DatabaseName());
  const d1Mode = resolveD1ExecutionMode();

  initFirebaseAdmin();
  const db = getFirestore();

  const [firestoreCounts, sqlCounts] = await Promise.all([
    loadFirestoreCounts(db, plantId),
    loadD1Counts(databaseName, d1Mode, plantId)
  ]);

  const output = {
    plantId,
    checkedAt: new Date().toISOString(),
    d1Mode,
    databaseName,
    firestore: firestoreCounts,
    sql: sqlCounts,
    diff: diffSummary(firestoreCounts, sqlCounts)
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
