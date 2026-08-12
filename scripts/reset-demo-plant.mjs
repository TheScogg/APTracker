#!/usr/bin/env node
/**
 * Reset the shared AP Tracker demo plant.
 *
 * Usage:
 *   node scripts/reset-demo-plant.mjs --dry-run
 *   node scripts/reset-demo-plant.mjs --commit
 *
 * Requirements:
 *   - GOOGLE_APPLICATION_CREDENTIALS set to a service account key file, or
 *     application default credentials available in the environment.
 *   - FIREBASE_PROJECT_ID set when the project cannot be inferred.
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const args = new Set(process.argv.slice(2));
const shouldCommit = args.has('--commit');
const plantIdArg = process.argv.find(arg => arg.startsWith('--plant='));
const plantId = plantIdArg ? plantIdArg.slice('--plant='.length) : 'plant_demo';

const DEMO_PRESSES = {
  'Zone A': ['AX-101','AX-102','AX-103','AX-104','AX-105','AX-106','AX-107','AX-108','AX-109','AX-110','AX-111','AX-112','AX-113'],
  'Zone B': ['BX-201','BX-202','BX-203','BX-204','BX-205','BX-206','BX-207','BX-208','BX-209','BX-210','BX-211','BX-212','BX-213','BX-214','BX-215','BX-216'],
  'Zone C': ['CX-301','CX-302','CX-303','CX-304','CX-305','CX-306','CX-307','CX-308','CX-309','CX-310','CX-311','CX-312','CX-313','CX-314'],
  'Zone D': ['DX-401','DX-402','DX-403','DX-404','DX-405','DX-406','DX-407','DX-408','DX-409','DX-410','DX-411','DX-412'],
  'Zone E': ['EX-501','EX-502','EX-503','EX-504','EX-505','EX-506','EX-507','EX-508','EX-509'],
  'Zone F': ['FX-601','FX-602','FX-603','FX-604','FX-605'],
  Auxiliary: ['QC-LAB','MAT-HUB','CELL-Z9']
};

const STATUS_META = {
  open: { label: 'Open', color: '#ef4444' },
  alert: { label: 'Alert', color: '#ef4444' },
  controlman: { label: 'Controlman', color: '#38bdf8' },
  maintenance: { label: 'Maintenance', color: '#eab308' },
  materials: { label: 'Materials', color: '#6b7280' },
  processengineer: { label: 'Process Eng.', color: '#a855f7' },
  quality: { label: 'Quality', color: '#ec4899' },
  resolved: { label: 'Resolved', color: '#22c55e' },
  startup: { label: 'Startup', color: '#14b8a6' },
  tooldie: { label: 'Tool & Die', color: '#f97316' }
};

const DEMO_ACTORS = {
  operator: { uid: 'demo_sample_operator', displayName: 'Demo Operator', email: 'operator@demo.local' },
  maintenance: { uid: 'demo_sample_maintenance', displayName: 'Demo Maintenance', email: 'maintenance@demo.local' },
  quality: { uid: 'demo_sample_quality', displayName: 'Demo Quality', email: 'quality@demo.local' },
  materials: { uid: 'demo_sample_materials', displayName: 'Demo Materials', email: 'materials@demo.local' },
  lead: { uid: 'demo_sample_lead', displayName: 'Demo Lead', email: 'lead@demo.local' }
};

const CURATED_DEMO_ISSUES = [
  {
    id: 'sample_alert_robot_estop',
    machine: 'AX-107',
    minutes: 18,
    note: 'Robot arm E-stop during part removal. Cell is safe and waiting for controlman review.',
    priority: 'critical',
    history: [
      { status: 'alert', subStatus: 'Robot / EOAT (End of Arm Tooling) Fault', actor: 'operator', minuteOffset: 0, workflowState: 'called' },
      { status: 'controlman', subStatus: 'Robot / EOAT (End of Arm Tooling) Fault', actor: 'lead', minuteOffset: 10, note: 'Controlman called and reviewing servo fault.', workflowState: 'accepted' }
    ]
  },
  {
    id: 'sample_maintenance_leak',
    machine: 'CX-304',
    minutes: 42,
    note: 'Hydraulic leak at clamp unit. Oil is contained and maintenance is replacing a high-pressure hose.',
    history: [
      { status: 'open', actor: 'operator', minuteOffset: 0 },
      { status: 'maintenance', subStatus: 'Hydraulic Leak / Pressure Drop', actor: 'maintenance', minuteOffset: 16, note: 'Maintenance on site with lockout complete.', workflowState: 'in-progress' }
    ]
  },
  {
    id: 'sample_materials_serial',
    machine: 'DX-409',
    minutes: 68,
    note: 'Material lot needs verification before startup can continue.',
    history: [
      { status: 'materials', subStatus: 'Wrong / Missing Material', actor: 'operator', minuteOffset: 0, note: 'S/N: STK12345', workflowState: 'called' },
      { status: 'startup', subStatus: 'First Article Inspection (FAI)', actor: 'materials', minuteOffset: 24, note: 'Lot STK12345 verified and released to startup.', workflowState: 'accepted' }
    ]
  },
  {
    id: 'sample_quality_review',
    machine: 'EX-503',
    minutes: 94,
    note: 'Part surface shows intermittent scuffing after mold clean. Quality is checking the last tray.',
    history: [
      { status: 'quality', subStatus: 'Cosmetic / Visual Defect', actor: 'operator', minuteOffset: 0, workflowState: 'called' }
    ]
  },
  {
    id: 'sample_resolved_calibration',
    machine: 'FX-605',
    minutes: 128,
    note: 'Gate sensor alignment drifted after tool swap. Offsets were corrected and verified.',
    history: [
      { status: 'processengineer', subStatus: 'Process Window / Parameter Adjustment', actor: 'operator', minuteOffset: 0, workflowState: 'called' },
      { status: 'maintenance', subStatus: 'Barrel / Screw / Check Ring Issue', actor: 'maintenance', minuteOffset: 22, note: 'Mechanical check complete.', workflowState: 'finished' },
      { status: 'resolved', actor: 'lead', minuteOffset: 47, note: 'Calibration complete and press returned to production.', workflowState: 'finished' }
    ]
  }
];

function parseServiceAccountFromEnv() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) return null;
  return JSON.parse(readFileSync(keyPath, 'utf8'));
}

const serviceAccount = parseServiceAccountFromEnv();
initializeApp(serviceAccount
  ? {
      credential: cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id
    }
  : {
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID
    });

const db = getFirestore();
const plantRef = db.collection('plants').doc(plantId);

function pad2(value) {
  return String(value).padStart(2, '0');
}

function localDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function fmtDate(date) {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function demoDate(minutes) {
  const d = new Date();
  d.setHours(6, 0, 0, 0);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function toPressId(machine) {
  return String(machine || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function findRowNameForMachine(machine) {
  for (const [rowName, machines] of Object.entries(DEMO_PRESSES)) {
    if (machines.includes(machine)) return rowName;
  }
  return 'Other';
}

function toRowId(rowName) {
  return String(rowName || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'other';
}

function actorFor(key) {
  return DEMO_ACTORS[key] || DEMO_ACTORS.operator;
}

function workflowIdFor(issueId, index) {
  return `wf_${issueId}_${index + 1}`;
}

function buildIssueDoc(sample) {
  const createdDate = demoDate(sample.minutes);
  const lastEntry = sample.history[sample.history.length - 1];
  const lastStatus = lastEntry.status || 'open';
  const lastMeta = STATUS_META[lastStatus] || STATUS_META.open;
  const lastDate = demoDate(sample.minutes + (lastEntry.minuteOffset || 0));
  const firstActor = actorFor(sample.history[0]?.actor);
  const lastActor = actorFor(lastEntry.actor);
  const statusHistory = sample.history.map((entry, index) => {
    const entryDate = demoDate(sample.minutes + (entry.minuteOffset || 0));
    return {
      status: entry.status,
      subStatus: entry.subStatus || '',
      note: entry.note || '',
      dateTime: fmtDate(entryDate),
      by: actorFor(entry.actor).displayName,
      workflowId: workflowIdFor(sample.id, index)
    };
  });
  const workflowStateByEntry = {};
  const workflowStateByEntryHistory = {};
  sample.history.forEach((entry, index) => {
    const wfId = workflowIdFor(sample.id, index);
    workflowStateByEntry[wfId] = entry.workflowState || null;
    if (entry.workflowState) {
      workflowStateByEntryHistory[wfId] = {
        [entry.workflowState]: { by: actorFor(entry.actor), at: demoDate(sample.minutes + (entry.minuteOffset || 0)) }
      };
    }
  });
  const isResolved = lastStatus === 'resolved';
  return {
    machine: sample.machine,
    note: sample.note,
    dateTime: fmtDate(createdDate),
    dateKey: localDateKey(createdDate),
    timestamp: createdDate.getTime(),
    shift: 'first',
    timer: { minutes: 0, endAt: 0, isRunning: false, alerted: false },
    userId: firstActor.uid,
    userName: firstActor.displayName,
    photoCount: 0,
    createdAt: createdDate,
    createdBy: firstActor,
    statusHistory,
    workflowStateByEntry,
    workflowStateByEntryHistory,
    workflowState: lastEntry.workflowState || (isResolved ? 'finished' : null),
    ...(lastEntry.workflowState ? { workflowStateHistory: { [lastEntry.workflowState]: { by: lastActor, at: lastDate } } } : {}),
    ...(sample.priority === 'critical' ? { highPriority: true, priority: 'critical' } : {}),
    schemaVersion: 2,
    plantId,
    pressId: toPressId(sample.machine),
    machineCode: sample.machine,
    rowId: toRowId(findRowNameForMachine(sample.machine)),
    currentStatus: {
      statusKey: lastStatus,
      subStatusKey: lastEntry.subStatus || '',
      label: lastMeta.label,
      subLabel: lastEntry.subStatus || '',
      color: lastMeta.color,
      enteredAt: lastDate,
      enteredDateTime: fmtDate(lastDate),
      enteredBy: lastActor,
      notePreview: lastEntry.note || sample.note
    },
    lifecycle: {
      isOpen: !isResolved,
      isResolved,
      openedAt: createdDate,
      resolvedAt: isResolved ? lastDate : null,
      closedAt: isResolved ? lastDate : null,
      reopenedCount: 0
    },
    updatedAt: lastDate,
    updatedBy: lastActor
  };
}

async function seedCuratedDemoIssues() {
  if (!shouldCommit) {
    console.log(`- curated issues: ${CURATED_DEMO_ISSUES.length} docs`);
    return;
  }
  const batch = db.batch();
  for (const sample of CURATED_DEMO_ISSUES) {
    const issueRef = plantRef.collection('issues').doc(sample.id);
    batch.set(issueRef, buildIssueDoc(sample));
    sample.history.forEach((entry, index) => {
      const eventAt = demoDate(sample.minutes + (entry.minuteOffset || 0));
      const eventRef = issueRef.collection('events').doc(`event_${index + 1}_${entry.status}`);
      batch.set(eventRef, {
        type: index === 0 ? 'issue_created' : 'status_changed',
        eventAt,
        actor: actorFor(entry.actor),
        schemaVersion: 2,
        payload: index === 0
          ? {
              machineCode: sample.machine,
              note: sample.note,
              initialStatusKey: entry.status,
              initialSubStatusKey: entry.subStatus || '',
              urgent: sample.priority === 'critical'
            }
          : {
              fromStatusKey: sample.history[index - 1]?.status || null,
              fromSubStatusKey: sample.history[index - 1]?.subStatus || '',
              toStatusKey: entry.status,
              toSubStatusKey: entry.subStatus || '',
              note: entry.note || ''
            }
      });
    });
  }
  await batch.commit();
  console.log(`- curated issues: seeded ${CURATED_DEMO_ISSUES.length} docs`);
}

async function recursiveDeleteCollection(collectionName) {
  const snap = await plantRef.collection(collectionName).get();
  if (snap.empty) {
    console.log(`- ${collectionName}: 0 docs`);
    return 0;
  }
  console.log(`- ${collectionName}: ${snap.size} top-level docs`);
  if (!shouldCommit) return snap.size;
  await Promise.all(snap.docs.map(docSnap => db.recursiveDelete(docSnap.ref)));
  return snap.size;
}

async function main() {
  console.log(`${shouldCommit ? 'Resetting' : 'Dry run for'} demo plant "${plantId}"`);
  const collectionsToClear = [
    'issues',
    'roleFeedAlerts',
    'conversations',
    'notes',
    'pressNotes',
    'presses',
    'wikiPages',
    'gameEvents',
    'userGameStats',
    'userBadges',
    'leaderboards'
  ];

  let total = 0;
  for (const collectionName of collectionsToClear) {
    total += await recursiveDeleteCollection(collectionName);
  }

  if (shouldCommit) {
    await plantRef.set({
      name: 'Demo Plant',
      location: 'Demo Location',
      isActive: true,
      isDemo: true,
      resetAt: FieldValue.serverTimestamp()
    }, { merge: true });
    await plantRef.collection('config').doc('presses').set({ presses: DEMO_PRESSES }, { merge: true });
  }
  await seedCuratedDemoIssues();

  console.log(`${shouldCommit ? 'Reset complete' : 'Dry run complete'}; ${total} top-level docs matched.`);
  if (!shouldCommit) console.log('Run again with --commit to apply the reset.');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
