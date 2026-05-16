#!/usr/bin/env node

/**
 * batch-import-schedules.mjs
 *
 * Batch-import daily schedule PDFs from a folder into Firestore.
 * Pipeline per file: PDF → Worker Doc AI OCR → Worker DeepSeek → Validate → Firestore
 *
 * Usage:
 *   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
 *   node scripts/batch-import-schedules.mjs \
 *     --dir ~/ScheduleScans/ \
 *     --plant plant_abc \
 *     --worker-url https://press-tracker.yourdomain.workers.dev \
 *     --docai-project my-project --docai-processor abc-123 \
 *     --dry-run
 *   node scripts/batch-import-schedules.mjs \
 *     --dir ~/ScheduleScans/ \
 *     --plant plant_abc \
 *     --worker-url https://press-tracker.yourdomain.workers.dev \
 *     --docai-project my-project --docai-processor abc-123 \
 *     --commit
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, parse, extname, resolve } from 'node:path';
import { homedir } from 'node:os';
import process from 'node:process';
import { initializeApp, cert } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

let pdfjsLib;

// ─── Constants ───────────────────────────────────────────────────────────────

const SCHEDULE_SECTIONS = [
  { inputKey: 'page_1', section: 'page1', isChange: false },
  { inputKey: 'page_2', section: 'page2', isChange: false },
  { inputKey: 'north_bay_changes', section: 'northBayChanges', isChange: true },
  { inputKey: 'south_bay_changes', section: 'southBayChanges', isChange: true },
];

const MONTH_NAMES = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const MONTH_PATTERN = '(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)';

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const val = flag => { const i = args.indexOf(flag); return i !== -1 && i + 1 < args.length ? args[i + 1] : null; };
  const has = flag => args.includes(flag);

  const engine = (val('--engine') || val('-e') || 'document-ai').toLowerCase();
  const validEngines = ['document-ai', 'azure', 'google'];
  if (!validEngines.includes(engine)) die(`Invalid --engine: ${engine}. Valid: ${validEngines.join(', ')}`);

  return {
    engine,
    dir: val('--dir') || val('-d'),
    plant: val('--plant') || val('-p'),
    workerUrl: val('--worker-url') || val('-w') || process.env.WORKER_URL,
    docaiProject: val('--docai-project'),
    docaiProcessor: val('--docai-processor'),
    docaiLocation: val('--docai-location') || 'us',
    fromDate: val('--from-date'),
    toDate: val('--to-date'),
    dateRegex: val('--date-regex'),
    concurrency: Math.max(1, parseInt(val('--concurrency') || val('-c') || '1', 10) || 1),
    delay: Math.max(0, parseInt(val('--delay') || '500', 10) || 500),
    dryRun: has('--dry-run'),
    resume: has('--resume') || !has('--overwrite'),
    overwrite: has('--overwrite'),
    verbose: has('--verbose') || has('-v'),
    logFile: val('--log') || 'batch-import-results.json',
  };
}

function printHelp() {
  console.log(`
batch-import-schedules.mjs — Batch import daily schedule PDFs into Firestore

USAGE:
  node scripts/batch-import-schedules.mjs --dir <path> --plant <id> --worker-url <url> [options]

REQUIRED:
  --dir, -d <path>        Folder of schedule PDFs
  --plant, -p <id>        Target Firestore plant ID
  --worker-url, -w <url>  Cloudflare Worker base URL (or WORKER_URL env var)

DOC AI SETTINGS (for document-ai OCR engine):
  --docai-project <id>    GCP project ID
  --docai-processor <id>  Document AI processor ID
  --docai-location <loc>  Processor location (default: us)

ENVIRONMENT:
  GOOGLE_APPLICATION_CREDENTIALS  Path to Firebase service account JSON

OPTIONS:
  --engine, -e <engine>   OCR engine: document-ai, azure, google (default: document-ai)
  --from-date <YYYY-MM-DD>  Earliest date to import (inclusive)
  --to-date <YYYY-MM-DD>    Latest date to import (inclusive)
  --concurrency, -c <n>     Files to process in parallel (default: 1)
  --delay <ms>              Pause before each file (default: 500)
  --dry-run                 Skip Firestore writes, only test pipeline
  --resume                  Skip dates already in Firestore (default: on)
  --overwrite               Re-import even if date exists
  --date-regex <regex>      Custom regex with capture group for date in filename
  --log <file>              Results output file (default: batch-import-results.json)
  --verbose, -v             Detailed per-file progress
  --help, -h                Show this help
`);
}

// ─── Firebase ────────────────────────────────────────────────────────────────

function initFirebase() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) die('GOOGLE_APPLICATION_CREDENTIALS env var is required');
  const resolved = keyPath.startsWith('~') ? join(homedir(), keyPath.slice(1)) : resolve(keyPath);
  if (!existsSync(resolved)) die(`Service account key not found: ${resolved}`);
  const sa = JSON.parse(readFileSync(resolved, 'utf8'));
  initializeApp({ credential: cert(sa) });
  return getFirestore();
}

function die(msg) { console.error('FATAL:', msg); process.exit(1); }

// ─── Date Extraction from Filename ───────────────────────────────────────

function extractDateFromFilename(filename, opts) {
  const name = parse(filename).name;

  if (opts.dateRegex) {
    const re = new RegExp(opts.dateRegex, 'i');
    const m = name.match(re);
    if (m) {
      const captured = m[1] || m[0];
      const d = normalizeDateStr(captured);
      if (d) return d;
    }
  }

  // 1) YYYY-MM-DD
  let m = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // 2) "January 15 2025" or "Jan 15, 2025"
  m = name.match(new RegExp(`(${MONTH_PATTERN})\\s+(\\d{1,2})\\s*,?\\s*(\\d{4})`, 'i'));
  if (m) {
    const month = String(MONTH_NAMES[m[1].toLowerCase()]).padStart(2, '0');
    return `${m[3]}-${month}-${String(parseInt(m[2])).padStart(2, '0')}`;
  }

  // 3) MM-DD-YYYY or MM/DD/YYYY
  m = name.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m) {
    const a = parseInt(m[1]), b = parseInt(m[2]);
    if (a > 12) return `${m[3]}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    if (b > 31) return `${m[3]}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    return `${m[3]}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
  }

  // 4) YYYYMMDD
  m = name.match(/(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  return null;
}

function normalizeDateStr(s) {
  const cleaned = String(s).replace(/[^0-9-]/g, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  return null;
}

// ─── Schema Normalization (ported from admin.html) ───────────────────────

function normalizeRowId(press, cavity, usedIds) {
  const rawPress = String(press || '').trim().toLowerCase()
    .replace(/\./g, '_').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'row';
  const safeCavity = String(cavity || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!usedIds.has(rawPress)) { usedIds.add(rawPress); return rawPress; }
  if (safeCavity) {
    const c = `${rawPress}_cav${safeCavity}`;
    if (!usedIds.has(c)) { usedIds.add(c); return c; }
  }
  let n = 2, c = `${rawPress}_${n}`;
  while (usedIds.has(c)) { n++; c = `${rawPress}_${n}`; }
  usedIds.add(c);
  return c;
}

function parseMaybeNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeSchemaPayload(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Schedule JSON must be an object.');
  const info = raw.schedule_info || {};
  const scheduleDate = String(info.date || '').trim();
  if (!scheduleDate) throw new Error('schedule_info.date is required (yyyy-mm-dd).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) throw new Error('schedule_info.date must use yyyy-mm-dd format.');

  const sections = {};
  for (const cfg of SCHEDULE_SECTIONS) {
    const rows = Array.isArray(raw[cfg.inputKey]) ? raw[cfg.inputKey] : [];
    const usedIds = new Set();
    sections[cfg.section] = rows.map((row, idx) => ({
      rowId: normalizeRowId(row?.press, row?.cavity, usedIds),
      scheduleDate,
      shift: Number(info.shift) || 1,
      section: cfg.section,
      press: String(row?.press || ''),
      partStorageLocation: Array.isArray(row?.part_storage_location)
        ? row.part_storage_location.map(v => String(v ?? '')) : [],
      partNumber: String(row?.part_number || ''),
      description: String(row?.description || ''),
      cavity: String(row?.cavity || ''),
      doh: parseMaybeNumber(row?.doh),
      labelsPerShift: parseMaybeNumber(row?.labels_per_shift),
      mc: String(row?.mc || ''),
      notes: String(row?.notes || ''),
      displayOrder: idx + 1,
      isChange: cfg.isChange,
    }));
  }

  return {
    scheduleDate,
    shift: Number(info.shift) || 1,
    lineSpeed: parseMaybeNumber(info.line_speed),
    totalPlannedPcs: parseMaybeNumber(info.total_planned_pcs),
    notes: String(info.note || ''),
    sections,
  };
}

function extractSchedulePayload(parsed) {
  if (parsed?.schedule_info) return parsed;
  if (parsed?.dailySchedules && typeof parsed.dailySchedules === 'object') {
    const e = Object.values(parsed.dailySchedules)[0];
    if (e && typeof e === 'object') return e;
  }
  return parsed;
}

function canonicalizeKeys(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const r = { ...raw };

  const sectionMap = {
    page1: 'page_1', page2: 'page_2',
    northBayChanges: 'north_bay_changes', southBayChanges: 'south_bay_changes',
    north_bay_change: 'north_bay_changes', south_bay_change: 'south_bay_changes',
  };
  for (const [alt, canon] of Object.entries(sectionMap)) {
    if (r[alt] !== undefined && r[canon] === undefined) { r[canon] = r[alt]; delete r[alt]; }
  }

  if (r.schedule_info && typeof r.schedule_info === 'object') {
    const info = { ...r.schedule_info };
    const infoMap = { scheduleDate: 'date', schedule_date: 'date', lineSpeed: 'line_speed', totalPlannedPcs: 'total_planned_pcs' };
    for (const [alt, canon] of Object.entries(infoMap)) {
      if (info[alt] !== undefined && info[canon] === undefined) info[canon] = info[alt];
    }
    r.schedule_info = info;
  }

  if (!r.schedule_info && (r.date || r.shift)) {
    r.schedule_info = { date: r.date || '', shift: r.shift || '', line_speed: '', total_planned_pcs: '', note: '' };
  }

  return r;
}

// ─── API calls through Cloudflare Worker ──────────────────────────────────

async function callOcr(workerUrl, pdfBytes, opts) {
  const base = workerUrl.replace(/\/+$/, '');
  switch (opts.engine) {
    case 'azure':
      return callAzureOcr(base, pdfBytes);
    case 'google':
      return callGoogleOcr(base, pdfBytes);
    default:
      return callDocumentAiOcr(base, pdfBytes, opts);
  }
}

async function callDocumentAiOcr(base, pdfBytes, opts) {
  const params = new URLSearchParams({
    projectId: opts.docaiProject, processorId: opts.docaiProcessor, location: opts.docaiLocation,
  });
  const res = await fetch(`${base}/api/ocr/document-ai?${params}`, { method: 'POST', body: pdfBytes });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Document AI OCR failed (${res.status})`);
  return (data.text || '').trim();
}

async function callAzureOcr(base, pdfBytes) {
  const res = await fetch(`${base}/api/ocr`, { method: 'POST', body: pdfBytes });
  const data = await res.json();
  if (!res.ok) throw new Error(data.details || data.error || `Azure OCR failed (${res.status})`);
  return (data.text || '').trim();
}

async function callGoogleOcr(base, pdfBytes) {
  if (!pdfjsLib) {
    try {
      pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    } catch {
      throw new Error('pdfjs-dist not installed. Run: npm install pdfjs-dist');
    }
  }

  const doc = await pdfjsLib.getDocument({ data: pdfBytes.buffer ? new Uint8Array(pdfBytes) : pdfBytes }).promise;
  const images = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = new OffscreenCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buffer = Buffer.from(await blob.arrayBuffer());
    images.push(buffer.toString('base64'));
  }

  const res = await fetch(`${base}/api/ocr/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      images,
      featureType: 'DOCUMENT_TEXT_DETECTION',
      maxResults: 1,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Google Vision OCR failed (${res.status})`);
  return (data.text || '').trim();
}

async function callDeepSeek(workerUrl, ocrText) {
  const url = `${workerUrl.replace(/\/+$/, '')}/api/ai/convert`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: ocrText }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.content || `DeepSeek failed (${res.status})`);
  return data;
}

// ─── Firestore Import ─────────────────────────────────────────────────────

async function importToFirestore(db, plantId, norm, dryRun) {
  const { scheduleDate, shift, lineSpeed, totalPlannedPcs, notes, sections } = norm;
  const dailyRef = db.doc(`plants/${plantId}/dailySchedules/${scheduleDate}`);

  if (dryRun) {
    const total = Object.values(sections).reduce((s, r) => s + r.length, 0);
    return total;
  }

  // Delete existing rows
  for (const cfg of SCHEDULE_SECTIONS) {
    const snap = await dailyRef.collection(cfg.section).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // Write parent doc
  const parentData = {
    scheduleDate, plantId, shift, lineSpeed, totalPlannedPcs,
    sourceFileName: `batch-import-${scheduleDate}`,
    sourceFileType: 'application/pdf',
    status: 'imported', notes,
    page1Count: sections.page1.length, page2Count: sections.page2.length,
    northBayChangesCount: sections.northBayChanges.length,
    southBayChangesCount: sections.southBayChanges.length,
    updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(),
  };

  const allOps = [];
  allOps.push({ ref: dailyRef, data: parentData });

  for (const cfg of SCHEDULE_SECTIONS) {
    for (const row of (sections[cfg.section] || [])) {
      allOps.push({
        ref: dailyRef.collection(cfg.section).doc(row.rowId),
        data: { ...row, scheduleDate, plantId, shift, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
      });
    }
  }

  for (let i = 0; i < allOps.length; i += 450) {
    const batch = db.batch();
    allOps.slice(i, i + 450).forEach(op => batch.set(op.ref, op.data, { merge: true }));
    await batch.commit();
  }

  return Object.values(sections).reduce((s, r) => s + r.length, 0);
}

// ─── Per-File Pipeline ────────────────────────────────────────────────────

async function processFile(db, opts, filePath) {
  const filename = parse(filePath).base;
  const result = { file: filename, date: null, status: 'failed', error: null, rows: 0 };

  try {
    const date = extractDateFromFilename(filename, opts);
    if (!date) { result.error = 'Could not extract date from filename'; return result; }
    result.date = date;

    if (opts.resume) {
      const existing = await db.doc(`plants/${opts.plant}/dailySchedules/${date}`).get();
      if (existing.exists) { result.status = 'skipped'; result.error = 'Already exists in Firestore'; return result; }
    }

    if (opts.verbose) console.log(`  → OCR: ${filename}`);
    const pdfBytes = readFileSync(filePath);
    const ocrText = await callOcr(opts.workerUrl, pdfBytes, opts);
    if (!ocrText) throw new Error('OCR returned empty text');

    if (opts.verbose) console.log(`  → DeepSeek: ${filename}`);
    const dsResult = await callDeepSeek(opts.workerUrl, ocrText);

    // Validate & normalize
    const canonical = canonicalizeKeys(dsResult);
    const payload = extractSchedulePayload(canonical);
    const norm = normalizeSchemaPayload(payload);

    // Override schedule date with filename-derived date (source of truth)
    norm.scheduleDate = date;
    for (const cfg of SCHEDULE_SECTIONS) {
      for (const row of (norm.sections[cfg.section] || [])) row.scheduleDate = date;
    }

    // Import to Firestore
    const rowCount = await importToFirestore(db, opts.plant, norm, opts.dryRun);
    result.rows = rowCount;
    result.status = opts.dryRun ? 'would_import' : 'imported';

    if (opts.verbose) console.log(`  ✓ ${date}: ${rowCount} rows`);
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  const missing = [];
  if (!opts.dir) missing.push('--dir');
  if (!opts.plant) missing.push('--plant');
  if (!opts.workerUrl) missing.push('--worker-url');
  if (opts.engine === 'document-ai') {
    if (!opts.docaiProject) missing.push('--docai-project');
    if (!opts.docaiProcessor) missing.push('--docai-processor');
  }
  if (missing.length) die(`Missing required arguments: ${missing.join(', ')}`);

  const dir = opts.dir.startsWith('~') ? join(homedir(), opts.dir.slice(1)) : resolve(opts.dir);
  if (!existsSync(dir)) die(`Directory not found: ${dir}`);

  // Validate date range args
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (opts.fromDate && !dateRe.test(opts.fromDate)) die(`--from-date must be YYYY-MM-DD, got: ${opts.fromDate}`);
  if (opts.toDate && !dateRe.test(opts.toDate)) die(`--to-date must be YYYY-MM-DD, got: ${opts.toDate}`);
  if (opts.fromDate && opts.toDate && opts.fromDate > opts.toDate) die(`--from-date (${opts.fromDate}) is after --to-date (${opts.toDate})`);

  const allFiles = readdirSync(dir)
    .filter(f => extname(f).toLowerCase() === '.pdf')
    .map(f => join(dir, f))
    .sort((a, b) => a.localeCompare(b));

  if (!allFiles.length) die(`No PDF files found in: ${dir}`);

  // Pre-scan dates from filenames to apply range filter
  const fileEntries = allFiles.map(f => ({
    path: f,
    name: parse(f).base,
    date: extractDateFromFilename(parse(f).base, opts),
  }));

  const toProcess = fileEntries.filter(e => {
    if (!e.date) return true; // let processFile report the error
    if (opts.fromDate && e.date < opts.fromDate) return false;
    if (opts.toDate && e.date > opts.toDate) return false;
    return true;
  });

  const skippedRange = allFiles.length - toProcess.length;
  const files = toProcess.map(e => e.path);

  if (!files.length) die(`No PDF files match the date range. Total: ${allFiles.length}, filtered out: ${skippedRange}`);

  const db = initFirebase();

  const rangeStr = opts.fromDate || opts.toDate
    ? `  Date range: ${opts.fromDate || '…'} → ${opts.toDate || '…'}`
    : '';

  console.log(`\nBatch Schedule Import`);
  console.log(`  Directory:  ${dir}`);
  console.log(`  Plant:      ${opts.plant}`);
  console.log(`  Worker:     ${opts.workerUrl}`);
  console.log(`  OCR engine: ${opts.engine}`);
  if (rangeStr) console.log(rangeStr);
  console.log(`  Files:      ${files.length} PDF(s)${skippedRange ? ` (${skippedRange} outside range)` : ''}`);
  console.log(`  Mode:       ${opts.dryRun ? 'DRY RUN (no Firestore writes)' : 'LIVE'}`);
  console.log(`  Resume:     ${opts.resume ? 'Skip existing' : 'Overwrite'}`);
  console.log(`  Concurrency: ${opts.concurrency}`);
  if (!opts.dryRun) console.log(`  ⚠  This WILL write to Firestore`);
  console.log('');

  // Process with concurrency pool
  const results = [];
  let idx = 0;
  const total = files.length;

  async function worker(file) {
    const result = await processFile(db, opts, file);
    results.push(result);
    const icon = result.status === 'imported' ? '✓' : result.status === 'would_import' ? '~' : result.status === 'skipped' ? '-' : '✗';
    const detail = result.date ? result.date : '??';
    const rowInfo = result.rows ? ` (${result.rows} rows)` : '';
    const errInfo = result.error ? `  ${result.error}` : '';
    const dryTag = result.status === 'would_import' ? ' [dry-run]' : '';
    console.log(`  ${icon} [${results.length}/${total}] ${detail}${rowInfo}${dryTag}${errInfo}`);
  }

  const pool = new Set();
  while (idx < files.length) {
    while (pool.size < opts.concurrency && idx < files.length) {
      const p = worker(files[idx++]).finally(() => pool.delete(p));
      pool.add(p);
    }
    if (pool.size > 0) await Promise.race(pool);
    if (idx < files.length && opts.delay > 0) await new Promise(r => setTimeout(r, opts.delay));
  }
  if (pool.size > 0) await Promise.all(pool);

  // Summary
  const imported = results.filter(r => r.status === 'imported' || r.status === 'would_import').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed = results.filter(r => r.status === 'failed').length;

  console.log(`\nSummary`);
  console.log(`  Total:            ${total}`);
  console.log(`  Imported:         ${imported}`);
  console.log(`  Skipped:          ${skipped}`);
  console.log(`  Outside range:    ${skippedRange}`);
  console.log(`  Failed:           ${failed}`);

  const logData = {
    timestamp: new Date().toISOString(),
    opts: { dir: opts.dir, plant: opts.plant, fromDate: opts.fromDate, toDate: opts.toDate, dryRun: opts.dryRun, resume: opts.resume },
    summary: { total, imported, skipped, skippedRange, failed },
    results,
  };
  writeFileSync(opts.logFile, JSON.stringify(logData, null, 2));
  console.log(`\n  Results saved: ${opts.logFile}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
