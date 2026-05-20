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

const DEFAULT_PRESSES = {
  'Row 1': ['1.01','1.02','1.03','1.04','1.05','1.06','1.07','1.08','1.09','1.10','1.11','1.12','1.13','1.14','1.15','1.16','1.17'],
  'Row 2': ['2.01','2.02','2.03','2.04','2.05','2.06','2.07','2.08','2.09','2.10','2.11','2.12','2.13','2.14','2.15','2.16','2.17','2.18','2.19','2.20','2.21','2.22'],
  'Row 3': ['3.01','3.02','3.03','3.04','3.05','3.06','3.07','3.08','3.09','3.10','3.12','3.13','3.14','3.15','3.16','3.17','3.18','3.19'],
  'Row 4': ['4.01','4.02','4.03','4.04','4.05','4.06','4.07','4.08','4.09','4.10','4.11','4.12','4.13','4.14','4.15','4.16','4.17'],
  'Row 5': ['5.01','5.02','5.03','5.04','5.05','5.06','5.07','5.08','5.09','5.10','5.11','5.12'],
  'Row 6': ['6.01','6.02','6.03','6.05','6.06','6.07'],
  Other: ['Auto Cell','BR-1','CR-1','CR-2']
};

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
    await plantRef.collection('config').doc('presses').set({ presses: DEFAULT_PRESSES }, { merge: true });
  }

  console.log(`${shouldCommit ? 'Reset complete' : 'Dry run complete'}; ${total} top-level docs matched.`);
  if (!shouldCommit) console.log('Run again with --commit to apply the reset.');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
