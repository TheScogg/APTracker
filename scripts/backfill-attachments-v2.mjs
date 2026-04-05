#!/usr/bin/env node
/**
 * Phase 3 attachment backfill for APTracker Firestore v2.
 *
 * Usage:
 *   node scripts/backfill-attachments-v2.mjs --dry-run
 *   node scripts/backfill-attachments-v2.mjs --commit
 *
 * Requirements:
 *   - GOOGLE_APPLICATION_CREDENTIALS set to a service account key file
 *   - FIREBASE_PROJECT_ID set (optional if present in service account)
 *   - FIREBASE_STORAGE_BUCKET set (optional; defaults to <project-id>.firebasestorage.app)
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const args = new Set(process.argv.slice(2));
const shouldCommit = args.has('--commit');
const isDryRun = !shouldCommit;

function parseServiceAccountFromEnv() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) return null;
  const raw = readFileSync(keyPath, 'utf8');
  return JSON.parse(raw);
}

function inferDefaultBucket(projectId) {
  return projectId ? `${projectId}.firebasestorage.app` : undefined;
}

function dataUrlToBuffer(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const contentType = m[1] || 'application/octet-stream';
  const raw = Buffer.from(m[2], 'base64');
  return { contentType, raw };
}

function extForContentType(contentType) {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'bin';
}

function stablePhotoId(issueId, photo, idx) {
  const base = `${issueId}|${idx}|${photo?.name || ''}|${String(photo?.dataUrl || '').slice(0, 120)}`;
  return createHash('sha1').update(base).digest('hex').slice(0, 16);
}

const serviceAccount = parseServiceAccountFromEnv();
const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || inferDefaultBucket(projectId);

if (serviceAccount) {
  initializeApp({
    credential: cert(serviceAccount),
    projectId,
    storageBucket
  });
} else {
  initializeApp({
    credential: applicationDefault(),
    projectId,
    storageBucket
  });
}

const db = getFirestore();
const bucket = getStorage().bucket();

async function backfillAttachments() {
  const issuesSnap = await db.collectionGroup('issues').get();

  let scanned = 0;
  let withLegacyPhotos = 0;
  let uploadsPlanned = 0;
  let uploadsDone = 0;
  let attachmentDocsWritten = 0;

  for (const issueSnap of issuesSnap.docs) {
    scanned += 1;
    const issue = issueSnap.data();
    const photos = Array.isArray(issue.photos) ? issue.photos : [];
    if (photos.length === 0) continue;

    const legacyPhotos = photos.filter(p => typeof p?.dataUrl === 'string' && p.dataUrl.startsWith('data:'));
    if (legacyPhotos.length === 0) continue;

    withLegacyPhotos += 1;
    const issueRef = issueSnap.ref;
    const segments = issueRef.path.split('/');
    const plantId = segments[1];
    const attachmentsCol = issueRef.collection('attachments');

    const batch = db.batch();
    let issueHadWrite = false;

    for (let idx = 0; idx < legacyPhotos.length; idx += 1) {
      const photo = legacyPhotos[idx];
      const decoded = dataUrlToBuffer(photo.dataUrl);
      if (!decoded) continue;

      const photoId = stablePhotoId(issueRef.id, photo, idx);
      const attachmentId = `legacy_${photoId}`;
      const attachmentRef = attachmentsCol.doc(attachmentId);
      const existingAttachment = await attachmentRef.get();
      if (existingAttachment.exists) continue;

      const ext = extForContentType(decoded.contentType);
      const storagePath = `plants/${plantId}/issues/${issueRef.id}/photos/${photoId}.${ext}`;
      const storageFile = bucket.file(storagePath);

      uploadsPlanned += 1;

      if (!isDryRun) {
        await storageFile.save(decoded.raw, {
          resumable: false,
          metadata: {
            contentType: decoded.contentType,
            metadata: {
              plantId,
              issueId: issueRef.id,
              migratedFrom: 'issue.photos.dataUrl'
            }
          }
        });
        uploadsDone += 1;
      }

      batch.set(attachmentRef, {
        type: 'photo',
        fileName: photo.name || `${photoId}.${ext}`,
        contentType: decoded.contentType,
        storagePath,
        thumbnailPath: null,
        uploadedBy: {
          uid: issue.userId || issue.createdBy?.uid || '',
          name: issue.userName || issue.createdBy?.name || 'Unknown'
        },
        uploadedAt: FieldValue.serverTimestamp(),
        sizeBytes: decoded.raw.length,
        source: 'legacy_data_url_migration',
        schemaVersion: 2
      }, { merge: false });
      attachmentDocsWritten += 1;
      issueHadWrite = true;
    }

    if (!issueHadWrite) continue;

    batch.set(issueRef, {
      photoCount: photos.length,
      migration: {
        ...(issue.migration || {}),
        photosBackfilledAt: FieldValue.serverTimestamp()
      },
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    if (!isDryRun) {
      await batch.commit();
    }
  }

  console.log(JSON.stringify({
    mode: isDryRun ? 'dry-run' : 'commit',
    bucket: bucket.name,
    scanned,
    withLegacyPhotos,
    uploadsPlanned,
    uploadsDone,
    attachmentDocsWritten
  }, null, 2));
}

backfillAttachments().catch(err => {
  console.error('Attachment backfill failed:', err);
  process.exit(1);
});
