#!/usr/bin/env node
/**
 * Phase 3 backfill for APTracker Firestore v2 issue schema.
 *
 * Usage:
 *   node scripts/backfill-issues-v2.mjs --dry-run
 *   node scripts/backfill-issues-v2.mjs --commit
 *
 * Requirements:
 *   - GOOGLE_APPLICATION_CREDENTIALS set to a service account key file
 *   - FIREBASE_PROJECT_ID set (optional if present in service account)
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';

const args = new Set(process.argv.slice(2));
const shouldCommit = args.has('--commit');
const isDryRun = !shouldCommit;

function parseServiceAccountFromEnv() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) return null;
  const raw = readFileSync(keyPath, 'utf8');
  return JSON.parse(raw);
}

const serviceAccount = parseServiceAccountFromEnv();
if (serviceAccount) {
  initializeApp({
    credential: cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id
  });
} else {
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
}

const db = getFirestore();

function toPressId(machineCode) {
  return `press_${String(machineCode || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}`;
}

function toRowId(rowName) {
  const m = String(rowName || '').match(/(\d+)/);
  if (m) return `row_${String(m[1]).padStart(2, '0')}`;
  const norm = String(rowName || 'other')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return norm ? `row_${norm}` : 'row_other';
}

function findRowNameForMachine(pressMap, machineCode) {
  for (const [rowName, machines] of Object.entries(pressMap || {})) {
    if (Array.isArray(machines) && machines.includes(machineCode)) return rowName;
  }
  return 'Other';
}

function parseDateToTimestamp(dateLike) {
  if (!dateLike) return Timestamp.now();
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return Timestamp.now();
  return Timestamp.fromDate(d);
}

function deriveCurrentStatus(issue) {
  const history = Array.isArray(issue.statusHistory) ? issue.statusHistory : [];
  const last = history.length > 0 ? history[history.length - 1] : null;
  const statusKey = issue.currentStatus?.statusKey || last?.status || (issue.resolved ? 'resolved' : (issue.status || 'open'));
  const subStatusKey = issue.currentStatus?.subStatusKey || last?.subStatus || issue.subStatus || '';
  const enteredDateTime = issue.currentStatus?.enteredDateTime || last?.dateTime || issue.statusDateTime || issue.dateTime || '';

  return {
    statusKey,
    subStatusKey,
    label: issue.currentStatus?.label || statusKey,
    subLabel: issue.currentStatus?.subLabel || subStatusKey || '',
    color: issue.currentStatus?.color || '',
    enteredAt: issue.currentStatus?.enteredAt || parseDateToTimestamp(enteredDateTime),
    enteredDateTime,
    enteredBy: issue.currentStatus?.enteredBy || {
      uid: issue.userId || issue.createdBy?.uid || '',
      name: issue.userName || issue.createdBy?.name || 'Unknown'
    },
    notePreview: issue.currentStatus?.notePreview || last?.note || ''
  };
}

function deriveLifecycle(issue, currentStatus) {
  const isResolved = currentStatus.statusKey === 'resolved' || issue.resolved === true;
  const openedAt = issue.lifecycle?.openedAt || issue.createdAt || parseDateToTimestamp(issue.dateTime);
  const resolvedAt = isResolved
    ? (issue.lifecycle?.resolvedAt || parseDateToTimestamp(issue.resolveDateTime || currentStatus.enteredDateTime))
    : null;

  return {
    isOpen: !isResolved,
    isResolved,
    openedAt,
    resolvedAt,
    closedAt: resolvedAt,
    reopenedCount: Number(issue.lifecycle?.reopenedCount || (Array.isArray(issue.resolveHistory) ? issue.resolveHistory.length : 0) || 0)
  };
}

function buildLegacyEvents(issue, currentStatus) {
  const history = Array.isArray(issue.statusHistory) ? issue.statusHistory : [];
  const actor = {
    uid: issue.userId || issue.createdBy?.uid || '',
    name: issue.userName || issue.createdBy?.name || 'Unknown'
  };

  if (history.length === 0) {
    return [{
      type: 'status_changed',
      eventAt: parseDateToTimestamp(issue.dateTime),
      actor,
      payload: {
        fromStatusKey: null,
        fromSubStatusKey: null,
        toStatusKey: currentStatus.statusKey,
        toSubStatusKey: currentStatus.subStatusKey,
        note: ''
      },
      schemaVersion: 2
    }];
  }

  return history.map((entry, idx) => ({
    type: 'status_changed',
    eventAt: parseDateToTimestamp(entry.dateTime || issue.dateTime),
    actor: {
      uid: issue.userId || '',
      name: entry.by || actor.name
    },
    payload: {
      fromStatusKey: idx === 0 ? null : (history[idx - 1].status || null),
      fromSubStatusKey: idx === 0 ? null : (history[idx - 1].subStatus || null),
      toStatusKey: entry.status || 'open',
      toSubStatusKey: entry.subStatus || '',
      note: entry.note || ''
    },
    schemaVersion: 2
  }));
}

function stableEventId(issueId, index, ev) {
  const key = `${issueId}|${index}|${ev.type}|${ev.payload?.toStatusKey || ''}|${ev.payload?.toSubStatusKey || ''}|${ev.payload?.note || ''}`;
  const digest = createHash('sha1').update(key).digest('hex').slice(0, 12);
  return `legacy_${String(index).padStart(3, '0')}_${digest}`;
}

async function getPlantPressMap(plantId, cache) {
  if (cache.has(plantId)) return cache.get(plantId);
  const snap = await db.doc(`plants/${plantId}/config/presses`).get();
  const map = snap.exists ? (snap.data()?.presses || {}) : {};
  cache.set(plantId, map);
  return map;
}

async function backfill() {
  const issuesSnap = await db.collectionGroup('issues').get();
  const plantPressMapCache = new Map();

  let scanned = 0;
  let updated = 0;
  let eventsCreated = 0;

  for (const docSnap of issuesSnap.docs) {
    scanned += 1;
    const issue = docSnap.data();
    const ref = docSnap.ref;
    const segments = ref.path.split('/');
    const plantId = segments[1];

    const machineCode = issue.machineCode || issue.machine || '';
    const pressMap = await getPlantPressMap(plantId, plantPressMapCache);
    const rowName = findRowNameForMachine(pressMap, machineCode);

    const currentStatus = deriveCurrentStatus(issue);
    const lifecycle = deriveLifecycle(issue, currentStatus);

    const patch = {
      schemaVersion: 2,
      plantId,
      machineCode,
      pressId: issue.pressId || toPressId(machineCode),
      rowId: issue.rowId || toRowId(rowName),
      currentStatus,
      lifecycle,
      updatedAt: FieldValue.serverTimestamp(),
      migration: {
        ...(issue.migration || {}),
        v2Phase3BackfilledAt: FieldValue.serverTimestamp()
      }
    };

    const eventsCol = ref.collection('events');
    const existingEvents = await eventsCol.limit(1).get();
    const shouldCreateLegacyEvents = existingEvents.empty;
    const legacyEvents = shouldCreateLegacyEvents ? buildLegacyEvents(issue, currentStatus) : [];

    const needsPatch =
      issue.schemaVersion !== 2 ||
      !issue.currentStatus ||
      !issue.lifecycle ||
      !issue.pressId ||
      !issue.rowId ||
      !issue.machineCode;

    if (!needsPatch && !shouldCreateLegacyEvents) continue;

    updated += 1;
    eventsCreated += legacyEvents.length;

    if (isDryRun) continue;

    const batch = db.batch();
    batch.set(ref, patch, { merge: true });

    legacyEvents.forEach((ev, idx) => {
      const eventRef = eventsCol.doc(stableEventId(ref.id, idx, ev));
      batch.set(eventRef, ev, { merge: false });
    });

    await batch.commit();
  }

  console.log(JSON.stringify({ mode: isDryRun ? 'dry-run' : 'commit', scanned, updated, eventsCreated }, null, 2));
}

backfill().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
