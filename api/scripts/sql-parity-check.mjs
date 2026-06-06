import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import sql from 'mssql';

function readArg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

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

  const keyPath = path.resolve(process.cwd(), '../serviceAccountKey.json');
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
  const issuesSnap = await db.collection('plants').doc(plantId).collection('issues').get();
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

  return {
    issues: issuesSnap.size,
    openIssues: openCount,
    resolvedIssues: resolvedCount,
    statusCounts: sortedObjectFromMap(statusCounts),
    attachmentCount,
    eventCount
  };
}

async function loadSqlCounts(pool, plantId) {
  const issuesResult = await pool.request()
    .input('plantId', sql.NVarChar(80), plantId)
    .query(`
      SELECT current_status_key, is_resolved
      FROM dbo.issues
      WHERE plant_id = @plantId
    `);

  const statusCounts = new Map();
  let openCount = 0;
  let resolvedCount = 0;
  issuesResult.recordset.forEach(row => {
    const statusKey = row.current_status_key || (row.is_resolved ? 'resolved' : 'open');
    incrementMap(statusCounts, statusKey);
    if (statusKey === 'resolved') resolvedCount += 1;
    else openCount += 1;
  });

  const [attachmentResult, eventResult] = await Promise.all([
    pool.request()
      .input('plantId', sql.NVarChar(80), plantId)
      .query('SELECT COUNT(*) AS total FROM dbo.issue_attachments WHERE plant_id = @plantId'),
    pool.request()
      .input('plantId', sql.NVarChar(80), plantId)
      .query('SELECT COUNT(*) AS total FROM dbo.issue_events WHERE plant_id = @plantId')
  ]);

  return {
    issues: issuesResult.recordset.length,
    openIssues: openCount,
    resolvedIssues: resolvedCount,
    statusCounts: sortedObjectFromMap(statusCounts),
    attachmentCount: Number(attachmentResult.recordset[0]?.total || 0),
    eventCount: Number(eventResult.recordset[0]?.total || 0)
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

  return {
    issues: sqlCounts.issues - firestoreCounts.issues,
    openIssues: sqlCounts.openIssues - firestoreCounts.openIssues,
    resolvedIssues: sqlCounts.resolvedIssues - firestoreCounts.resolvedIssues,
    attachmentCount: sqlCounts.attachmentCount - firestoreCounts.attachmentCount,
    eventCount: sqlCounts.eventCount - firestoreCounts.eventCount,
    statusDiff
  };
}

async function main() {
  const plantId = requireArg('--plant', readArg('--plant'));
  const connectionString = process.env.SQL_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('SQL_CONNECTION_STRING must be set.');
  }

  initFirebaseAdmin();
  const db = getFirestore();
  const pool = await sql.connect(connectionString);

  try {
    const [firestoreCounts, sqlCounts] = await Promise.all([
      loadFirestoreCounts(db, plantId),
      loadSqlCounts(pool, plantId)
    ]);

    const output = {
      plantId,
      checkedAt: new Date().toISOString(),
      firestore: firestoreCounts,
      sql: sqlCounts,
      diff: diffSummary(firestoreCounts, sqlCounts)
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
