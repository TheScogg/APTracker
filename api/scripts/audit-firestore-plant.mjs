#!/usr/bin/env node

import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const KNOWN_MAPPED_COLLECTIONS = new Set([
  'plants/{plantId}/accessRequests',
  'plants/{plantId}/config',
  'plants/{plantId}/conversations',
  'plants/{plantId}/conversations/*/members',
  'plants/{plantId}/conversations/*/messages',
  'plants/{plantId}/dailySchedules',
  'plants/{plantId}/dailySchedules/*/northBayChanges',
  'plants/{plantId}/dailySchedules/*/page1',
  'plants/{plantId}/dailySchedules/*/page2',
  'plants/{plantId}/dailySchedules/*/southBayChanges',
  'plants/{plantId}/gameEvents',
  'plants/{plantId}/gamificationConfig',
  'plants/{plantId}/issues',
  'plants/{plantId}/issues/*/attachments',
  'plants/{plantId}/issues/*/events',
  'plants/{plantId}/leaderboards',
  'plants/{plantId}/members',
  'plants/{plantId}/missions',
  'plants/{plantId}/missions/*/progress',
  'plants/{plantId}/notes',
  'plants/{plantId}/notes/*/attachments',
  'plants/{plantId}/presses',
  'plants/{plantId}/presses/*/wikiPages',
  'plants/{plantId}/presses/*/wikiPages/*/attachments',
  'plants/{plantId}/presses/*/wikiPages/*/revisions',
  'plants/{plantId}/pressNotes',
  'plants/{plantId}/roleFeedAlerts',
  'plants/{plantId}/todos',
  'plants/{plantId}/userBadges',
  'plants/{plantId}/userGameStats',
  'plants/{plantId}/wikiPages',
  'plants/{plantId}/wikiPages/*/attachments',
  'plants/{plantId}/wikiPages/*/revisions'
]);

const KNOWN_DOC_IDS = {
  'plants/{plantId}/config': new Set(['presses', 'statuses', 'store']),
  'plants/{plantId}/gamificationConfig': new Set(['main'])
};

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

function hasFlag(flag) {
  return process.argv.includes(flag);
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

function normalizeCollectionPath(collectionPath) {
  const parts = String(collectionPath || '').split('/').filter(Boolean);
  return parts.map((part, index) => {
    if (index === 1 && parts[0] === 'plants') return '{plantId}';
    return index % 2 === 1 ? '*' : part;
  }).join('/');
}

function printCollectionReport(collections) {
  console.log('\nCollection audit');
  collections.forEach(record => {
    const label = record.mapped ? 'mapped' : 'UNMAPPED';
    const sampleSuffix = record.samplePaths.length ? ` | sample: ${record.samplePaths[0]}` : '';
    console.log(`- [${label}] ${record.pathPattern} | docs=${record.docCount} | occurrences=${record.occurrences}${sampleSuffix}`);
    if (record.unmappedDocIds.length) {
      console.log(`  unmapped doc ids: ${record.unmappedDocIds.join(', ')}`);
    }
  });
}

function printRelatedTodoReport(personalTodos) {
  console.log('\nRelated personal todos');
  console.log(`- users/*/todos for this plant: ${personalTodos.total}`);
  if (!personalTodos.byUser.length) return;
  personalTodos.byUser
    .filter(entry => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.uid.localeCompare(b.uid))
    .forEach(entry => {
      console.log(`  ${entry.uid}: ${entry.count}`);
    });
}

async function collectUserTodoAudit(db, plantId, memberIds) {
  const byUser = [];
  let total = 0;

  for (const uid of memberIds) {
    const todosSnap = await db.collection('users').doc(uid).collection('todos').get();
    const count = todosSnap.docs.filter(docSnap => String(docSnap.data()?.plantId || '') === String(plantId)).length;
    byUser.push({ uid, count });
    total += count;
  }

  return {
    total,
    byUser
  };
}

async function auditPlant(db, plantId) {
  const plantRef = db.collection('plants').doc(plantId);
  const rootCollections = await plantRef.listCollections();
  const stats = new Map();
  const memberIds = new Set();

  async function walkCollection(collectionRef) {
    const concretePath = collectionRef.path;
    const pathPattern = normalizeCollectionPath(concretePath);
    const docsSnap = await collectionRef.get();
    const knownDocIds = KNOWN_DOC_IDS[pathPattern];
    const unmappedDocIds = knownDocIds
      ? docsSnap.docs.map(docSnap => docSnap.id).filter(docId => !knownDocIds.has(docId)).sort()
      : [];

    if (!stats.has(pathPattern)) {
      stats.set(pathPattern, {
        pathPattern,
        mapped: KNOWN_MAPPED_COLLECTIONS.has(pathPattern),
        docCount: 0,
        occurrences: 0,
        samplePaths: new Set(),
        unmappedDocIds: new Set()
      });
    }

    const record = stats.get(pathPattern);
    record.docCount += docsSnap.size;
    record.occurrences += 1;
    if (record.samplePaths.size < 3) record.samplePaths.add(concretePath);
    unmappedDocIds.forEach(docId => record.unmappedDocIds.add(docId));

    if (pathPattern === 'plants/{plantId}/members') {
      docsSnap.docs.forEach(docSnap => memberIds.add(docSnap.id));
    }

    await Promise.all(docsSnap.docs.map(async docSnap => {
      const childCollections = await docSnap.ref.listCollections();
      await Promise.all(childCollections.map(walkCollection));
    }));
  }

  await Promise.all(rootCollections.map(walkCollection));

  const collections = [...stats.values()]
    .map(record => ({
      pathPattern: record.pathPattern,
      mapped: record.mapped,
      docCount: record.docCount,
      occurrences: record.occurrences,
      samplePaths: [...record.samplePaths],
      unmappedDocIds: [...record.unmappedDocIds].sort()
    }))
    .sort((a, b) => a.pathPattern.localeCompare(b.pathPattern));

  const personalTodos = await collectUserTodoAudit(db, plantId, [...memberIds].sort());

  const summary = collections.reduce((acc, record) => {
    if (record.mapped && record.unmappedDocIds.length === 0) {
      acc.mappedCollections += 1;
      acc.mappedDocs += record.docCount;
    } else {
      acc.unmappedCollections += 1;
      acc.unmappedDocs += record.docCount;
    }
    return acc;
  }, {
    mappedCollections: 0,
    mappedDocs: 0,
    unmappedCollections: 0,
    unmappedDocs: 0
  });

  return {
    plantId,
    generatedAt: new Date().toISOString(),
    summary,
    collections,
    related: {
      personalTodos
    }
  };
}

const plantId = String(argValue('--plant') || '').trim();
const asJson = hasFlag('--json');

if (!plantId) {
  console.error('Missing required argument: --plant <plantId>');
  process.exit(1);
}

initFirebaseAdmin();
const db = getFirestore();
const report = await auditPlant(db, plantId);

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log(`Plant audit for ${report.plantId}`);
console.log(`Generated at ${report.generatedAt}`);
console.log(`Mapped collections: ${report.summary.mappedCollections} (${report.summary.mappedDocs} docs)`);
console.log(`Needs review: ${report.summary.unmappedCollections} (${report.summary.unmappedDocs} docs)`);

printCollectionReport(report.collections);
printRelatedTodoReport(report.related.personalTodos);
