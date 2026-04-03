import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs';

const fileInput = document.getElementById('pdfFile');
const parseBtn = document.getElementById('parseBtn');
const copyJsonBtn = document.getElementById('copyJsonBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const statusEl = document.getElementById('status');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const resultsWrap = document.getElementById('resultsWrap');
const rawText = document.getElementById('rawText');

let parsedEntries = [];

const dayRegex = /\b(Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:rs(?:day)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b/i;
const timeRangeRegex = /(\d{1,2}(?::\d{2})?\s?(?:AM|PM|A\.M\.|P\.M\.)?)\s?[-–—]\s?(\d{1,2}(?::\d{2})?\s?(?:AM|PM|A\.M\.|P\.M\.)?)/i;
const pressRegex = /\b(?:press\s*[:#-]?\s*)?(\d{1,3}(?:\.\d{1,3})?)\b/i;
const partNumberLabeledRegex = /\b(?:part(?:\s*(?:no|num|number|#))?|pn)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-/.]{1,})\b/i;
const partNumberGenericRegex = /\b([A-Z]{1,4}\d{2,}[A-Z0-9\-/.]*)\b/;
const cavityRegex = /\b(?:cav(?:ity)?|cvty?)\s*[:#-]?\s*(\d{1,3})\b/i;
const descriptionRegex = /\b(?:desc|description)\s*[:\-]\s*([A-Z0-9][^|;]{2,})/i;
const notesRegex = /\b(?:notes?|comment(?:s)?)\s*[:\-]\s*(.+)$/i;

parseBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];

  if (!file && !rawText.value.trim()) {
    setStatus('Please choose a PDF first or paste OCR text manually.', 'err');
    return;
  }

  parseBtn.disabled = true;
  copyJsonBtn.disabled = true;
  downloadCsvBtn.disabled = true;
  progressWrap.classList.remove('hidden');
  setProgress(0);

  try {
    let textToParse = rawText.value.trim();

    if (file) {
      setStatus('Reading PDF and extracting page images...');
      const pageCanvases = await renderPdfToCanvases(file);
      setStatus(`Running OCR on ${pageCanvases.length} page(s)...`);
      textToParse = await runOcr(pageCanvases);
      rawText.value = textToParse;
    }

    setStatus('Parsing schedule entries...');
    parsedEntries = parseScheduleText(textToParse);
    renderEntries(parsedEntries);

    copyJsonBtn.disabled = parsedEntries.length === 0;
    downloadCsvBtn.disabled = parsedEntries.length === 0;

    if (parsedEntries.length) {
      setStatus(`Done. Parsed ${parsedEntries.length} schedule entries.`, 'ok');
    } else {
      setStatus('No entries matched expected schedule patterns. You may need a cleaner scan or manual text edits.', 'err');
    }
  } catch (err) {
    console.error(err);
    setStatus(`Failed: ${err.message}`, 'err');
  } finally {
    parseBtn.disabled = false;
  }
});

copyJsonBtn.addEventListener('click', async () => {
  if (!parsedEntries.length) return;
  await navigator.clipboard.writeText(JSON.stringify(parsedEntries, null, 2));
  setStatus('Copied parsed entries as JSON to clipboard.', 'ok');
});

downloadCsvBtn.addEventListener('click', () => {
  if (!parsedEntries.length) return;
  const headers = ['day', 'startTime', 'endTime', 'pressNumber', 'partNumber', 'partDescription', 'cavity', 'notes', 'sourceLine'];
  const lines = [headers.join(',')];

  for (const entry of parsedEntries) {
    lines.push(headers.map((h) => csvEscape(entry[h] || '')).join(','));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'parsed-daily-schedule.csv';
  link.click();
  URL.revokeObjectURL(url);
  setStatus('Downloaded CSV.', 'ok');
});

async function renderPdfToCanvases(file) {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  const canvases = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.1 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;
    canvases.push(canvas);
    setProgress(Math.round((i / pdf.numPages) * 20));
  }

  return canvases;
}

async function runOcr(canvases) {
  const chunks = [];

  for (let i = 0; i < canvases.length; i++) {
    const canvas = canvases[i];
    const { data } = await Tesseract.recognize(canvas, 'eng', {
      logger: ({ progress, status }) => {
        if (!Number.isFinite(progress)) return;
        const base = 20 + ((i + progress) / canvases.length) * 75;
        setProgress(Math.min(98, Math.round(base)));
        setStatus(`OCR page ${i + 1}/${canvases.length}: ${status || 'working'} (${Math.round(progress * 100)}%)`);
      }
    });

    chunks.push(data.text);
  }

  setProgress(100);
  return chunks.join('\n\n---- PAGE BREAK ----\n\n');
}

function parseScheduleText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const entries = [];
  let currentDay = '';

  for (const line of lines) {
    const dayMatch = line.match(dayRegex);
    if (dayMatch) {
      currentDay = normalizeDay(dayMatch[1]);
    }

    const timeMatch = line.match(timeRangeRegex);
    const parsedDetail = parseLineDetails(line);
    if (!timeMatch && !parsedDetail.pressNumber && !parsedDetail.partNumber) continue;

    const startTime = timeMatch ? normalizeTime(timeMatch[1]) : '';
    const endTime = timeMatch ? normalizeTime(timeMatch[2]) : '';

    entries.push({
      day: currentDay || inferNearbyDay(lines, line) || 'Unknown',
      startTime,
      endTime,
      pressNumber: parsedDetail.pressNumber || '',
      partNumber: parsedDetail.partNumber || '',
      partDescription: parsedDetail.partDescription || '',
      cavity: parsedDetail.cavity || '',
      notes: parsedDetail.notes || '',
      sourceLine: line
    });
  }

  return entries;
}

function inferNearbyDay(lines, targetLine) {
  const idx = lines.indexOf(targetLine);
  if (idx === -1) return '';

  for (let i = idx - 1; i >= Math.max(0, idx - 4); i--) {
    const m = lines[i].match(dayRegex);
    if (m) return normalizeDay(m[1]);
  }
  return '';
}

function normalizeDay(day) {
  const key = day.toLowerCase().slice(0, 3);
  const map = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
    fri: 'Friday', sat: 'Saturday', sun: 'Sunday'
  };
  return map[key] || day;
}

function normalizeTime(t) {
  return t
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function parseLineDetails(line) {
  const pressMatch = line.match(pressRegex);
  const partLabeledMatch = line.match(partNumberLabeledRegex);
  const partGenericMatch = line.match(partNumberGenericRegex);
  const cavityMatch = line.match(cavityRegex);
  const descriptionMatch = line.match(descriptionRegex);
  const notesMatch = line.match(notesRegex);

  const pressNumber = pressMatch ? pressMatch[1] : '';
  const partNumber = partLabeledMatch?.[1] || partGenericMatch?.[1] || '';
  const cavity = cavityMatch ? cavityMatch[1] : '';
  const notes = notesMatch ? notesMatch[1].trim() : '';

  let partDescription = descriptionMatch ? descriptionMatch[1].trim() : '';
  if (!partDescription) {
    partDescription = inferDescription(line, { pressNumber, partNumber, notes });
  }

  return { pressNumber, partNumber, partDescription, cavity, notes };
}

function inferDescription(line, knownValues) {
  let cleaned = line
    .replace(dayRegex, ' ')
    .replace(timeRangeRegex, ' ')
    .replace(pressRegex, ' ')
    .replace(partNumberLabeledRegex, ' ')
    .replace(cavityRegex, ' ')
    .replace(notesRegex, ' ')
    .replace(/\b(?:part(?:\s*(?:no|num|number|#))?|pn|press|cav(?:ity)?|cvty?)\b/gi, ' ')
    .replace(/[|;,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (knownValues.partNumber) cleaned = cleaned.replace(knownValues.partNumber, '').trim();
  if (knownValues.pressNumber) cleaned = cleaned.replace(knownValues.pressNumber, '').trim();
  if (knownValues.notes) cleaned = cleaned.replace(knownValues.notes, '').trim();

  return cleaned;
}

function renderEntries(entries) {
  if (!entries.length) {
    resultsWrap.innerHTML = '<p class="sub" style="margin:0;">No parsed entries found.</p>';
    return;
  }

  const rows = entries.map((entry, idx) => `
    <tr>
      <td><span class="pill">#${idx + 1}</span></td>
      <td>${escapeHtml(entry.day)}</td>
      <td>${escapeHtml(entry.startTime)}</td>
      <td>${escapeHtml(entry.endTime)}</td>
      <td>${escapeHtml(entry.pressNumber)}</td>
      <td>${escapeHtml(entry.partNumber)}</td>
      <td>${escapeHtml(entry.partDescription)}</td>
      <td>${escapeHtml(entry.cavity)}</td>
      <td>${escapeHtml(entry.notes)}</td>
      <td><code style="font-family:'Share Tech Mono',monospace;font-size:11px;">${escapeHtml(entry.sourceLine)}</code></td>
    </tr>
  `).join('');

  resultsWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Day</th>
          <th>Start</th>
          <th>End</th>
          <th>Press</th>
          <th>Part #</th>
          <th>Part Description</th>
          <th>Cavity</th>
          <th>Notes</th>
          <th>Source line</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function csvEscape(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function setProgress(value) {
  progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function setStatus(message, tone = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${tone}`.trim();
}

function escapeHtml(input) {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
