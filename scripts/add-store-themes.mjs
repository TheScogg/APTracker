#!/usr/bin/env node
/**
 * One-time script: merge new theme entries into the globalConfig/store document.
 *
 * Reads the existing items array from Firestore, appends any themes listed in
 * THEMES_TO_ADD whose id is not already present, then writes the doc back.
 * Existing items are never modified.
 *
 * Usage:
 *   node scripts/add-store-themes.mjs --dry-run
 *   node scripts/add-store-themes.mjs --commit
 *
 * Requirements:
 *   GOOGLE_APPLICATION_CREDENTIALS — path to a service account key JSON file
 *   FIREBASE_PROJECT_ID            — optional if present in the service account
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const args = new Set(process.argv.slice(2));
const isDryRun = !args.has('--commit');

// ── Themes to add ────────────────────────────────────────────────────────────
// Add future store-item entries here; the script will skip any whose id already
// exists in Firestore so it is safe to re-run.
const THEMES_TO_ADD = [
  { id: 'theme_cardinals', type: 'theme', themeKey: 'cardinals', customVars: null, name: 'Cardinals', price: 25, isActive: true, order: 11 },
  { id: 'theme_wildcats',  type: 'theme', themeKey: 'wildcats',  customVars: null, name: 'Wildcats',  price: 25, isActive: true, order: 12 },
  {
    id: 'theme_nocturne_slate',
    type: 'theme',
    themeKey: null,
    customVars: {
      '--bg': '#121722',
      '--bg2': '#1a2130',
      '--bg3': '#242d3f',
      '--border': '#344055',
      '--text': '#e7edf7',
      '--text2': '#b5c0d4',
      '--text3': '#8c99af',
      '--accent': '#5d84d6',
      '--accent2': '#7d9de0',
      '--green': '#4bbf8a',
      '--red': '#d96b7a',
      '--blue': '#5d84d6',
      '--yellow': '#d4b46a',
      '--orange': '#c98a62'
    },
    name: 'Nocturne Slate',
    price: 3,
    isActive: true,
    order: 13
  }
];
// ─────────────────────────────────────────────────────────────────────────────

function parseServiceAccountFromEnv() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) return null;
  return JSON.parse(readFileSync(keyPath, 'utf8'));
}

const serviceAccount = parseServiceAccountFromEnv();
if (serviceAccount) {
  initializeApp({ credential: cert(serviceAccount), projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id });
} else {
  initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID });
}

const db = getFirestore();
const STORE_DOC = db.doc('globalConfig/store');

async function main() {
  console.log(`Mode: ${isDryRun ? 'DRY RUN (pass --commit to write)' : 'COMMIT'}\n`);

  const snap = await STORE_DOC.get();
  const existing = snap.exists ? (snap.data().items || []) : [];
  const existingIds = new Set(existing.map(i => i.id));

  const toAdd = THEMES_TO_ADD.filter(t => !existingIds.has(t.id));
  const alreadyPresent = THEMES_TO_ADD.filter(t => existingIds.has(t.id));

  if (alreadyPresent.length) {
    console.log('Already in Firestore (skipping):');
    alreadyPresent.forEach(t => console.log(`  ✓ ${t.id} — ${t.name}`));
    console.log();
  }

  if (!toAdd.length) {
    console.log('Nothing to add. Firestore is already up to date.');
    return;
  }

  console.log('Items to add:');
  toAdd.forEach(t => console.log(`  + ${t.id} — ${t.name} (${t.price} XP, order ${t.order})`));
  console.log();

  if (isDryRun) {
    console.log('Dry run complete. No changes written.');
    return;
  }

  await STORE_DOC.set(
    { items: FieldValue.arrayUnion(...toAdd) },
    { merge: true }
  );

  console.log(`Done. ${toAdd.length} item(s) added to globalConfig/store.`);
}

main().catch(err => { console.error(err); process.exit(1); });
