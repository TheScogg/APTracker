#!/usr/bin/env node
/**
 * Phase 8 cleanup script for APTracker Firestore v2.
 *
 * Removes legacy v1 fields after migration cutover.
 *
 * Usage:
 *   node scripts/cleanup-legacy-v1-fields.mjs --dry-run
 *   node scripts/cleanup-legacy-v1-fields.mjs --commit
 *
 * Requirements:
 *   - GOOGLE_APPLICATION_CREDENTIALS set to a service account key file
 *   - FIREBASE_PROJECT_ID set (optional if present in service account)
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

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

function stripLegacyPhotoDataUrls(photos) {
  if (!Array.isArray(photos)) return { photos, strippedCount: 0 };
  let strippedCount = 0;
  const next = photos.map(photo => {
    if (!photo || typeof photo !== 'object') return photo;
    if (!Object.prototype.hasOwnProperty.call(photo, 'dataUrl')) return photo;

    const clone = { ...photo };
    delete clone.dataUrl;
    strippedCount += 1;
    return clone;
  });
  return { photos: next, strippedCount };
}

async function cleanupLegacyFields() {
  const issuesSnap = await db.collectionGroup('issues').get();

  let scanned = 0;
  let updated = 0;
  let statusHistoryRemoved = 0;
  let resolvedFieldsRemoved = 0;
  let photoDataUrlsRemoved = 0;

  for (const issueSnap of issuesSnap.docs) {
    scanned += 1;
    const issue = issueSnap.data();
    const patch = {};

    if (Array.isArray(issue.statusHistory) && issue.statusHistory.length > 0) {
      const eventsSnap = await issueSnap.ref.collection('events').limit(1).get();
      if (!eventsSnap.empty) {
        patch.statusHistory = FieldValue.delete();
        statusHistoryRemoved += 1;
      }
    }

    const legacyResolutionKeys = ['resolved', 'resolveNote', 'resolveDateTime'];
    const issueHasLegacyResolution = legacyResolutionKeys.some(key => Object.prototype.hasOwnProperty.call(issue, key));
    if (issueHasLegacyResolution) {
      patch.resolved = FieldValue.delete();
      patch.resolveNote = FieldValue.delete();
      patch.resolveDateTime = FieldValue.delete();
      resolvedFieldsRemoved += 1;
    }

    if (Array.isArray(issue.photos) && issue.photos.length > 0) {
      const { photos: cleanedPhotos, strippedCount } = stripLegacyPhotoDataUrls(issue.photos);
      if (strippedCount > 0) {
        patch.photos = cleanedPhotos;
        photoDataUrlsRemoved += strippedCount;
      }
    }

    if (Object.keys(patch).length === 0) continue;

    patch.updatedAt = FieldValue.serverTimestamp();
    patch.migration = {
      ...(issue.migration || {}),
      legacyFieldsCleanedAt: FieldValue.serverTimestamp()
    };

    updated += 1;

    if (!isDryRun) {
      await issueSnap.ref.set(patch, { merge: true });
    }
  }

  console.log(JSON.stringify({
    mode: isDryRun ? 'dry-run' : 'commit',
    scanned,
    updated,
    statusHistoryRemoved,
    resolvedFieldsRemoved,
    photoDataUrlsRemoved
  }, null, 2));
}

cleanupLegacyFields().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
