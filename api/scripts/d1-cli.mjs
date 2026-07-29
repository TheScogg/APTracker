import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

export function hasFlag(flag) {
  return process.argv.includes(flag);
}

export function resolveD1DatabaseName() {
  return String(
    argValue('--database')
      || argValue('--db')
      || process.env.APTRACKER_D1_DATABASE_NAME
      || process.env.D1_DATABASE_NAME
      || ''
  ).trim();
}

export function resolveD1ExecutionMode() {
  if (hasFlag('--remote')) return 'remote';
  if (hasFlag('--local')) return 'local';
  return 'local';
}

export function normalizeSqlValue(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return String(value);
}

function sqlLiteral(value) {
  const normalized = normalizeSqlValue(value);
  if (normalized == null) return 'NULL';
  if (typeof normalized === 'number') return String(normalized);
  return `'${String(normalized).replace(/'/g, "''")}'`;
}

export function buildD1UpsertStatement(tableSpec, row) {
  const columns = tableSpec.columns.map(([column]) => column);
  const valueList = columns.map(column => sqlLiteral(row[column])).join(', ');
  const keySet = new Set(tableSpec.keys);
  const updateAssignments = columns
    .filter(column => !keySet.has(column))
    .map(column => `${column} = excluded.${column}`)
    .join(', ');

  return [
    `INSERT INTO ${tableSpec.name} (${columns.join(', ')})`,
    `VALUES (${valueList})`,
    `ON CONFLICT (${tableSpec.keys.join(', ')}) DO UPDATE SET ${updateAssignments};`
  ].join('\n');
}

function formatExecError(error) {
  const stdout = String(error?.stdout || '').trim();
  const stderr = String(error?.stderr || '').trim();
  const parts = [error?.message || 'Wrangler command failed'];
  if (stderr) parts.push(`stderr:\n${stderr}`);
  if (stdout) parts.push(`stdout:\n${stdout}`);
  return new Error(parts.join('\n\n'));
}

export async function runWranglerD1(args, { workdir } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('npx', ['wrangler', 'd1', ...args], {
      cwd: workdir,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024
    });
    return { stdout, stderr };
  } catch (error) {
    throw formatExecError(error);
  }
}

export async function executeD1Command(databaseName, sqlCommand, { mode = 'local', workdir } = {}) {
  const args = ['execute', databaseName, `--${mode}`, '--json', '--command', sqlCommand];
  const { stdout } = await runWranglerD1(args, { workdir });
  return parseWranglerJson(stdout);
}

export async function executeD1File(databaseName, sqlText, { mode = 'local', workdir } = {}) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'aptracker-d1-'));
  const sqlPath = path.join(tmpDir, 'import.sql');
  try {
    await writeFile(sqlPath, sqlText, 'utf8');
    const args = ['execute', databaseName, `--${mode}`, '--json', '--file', sqlPath];
    const { stdout } = await runWranglerD1(args, { workdir });
    return parseWranglerJson(stdout);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export function parseWranglerJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('[');
    const objectStart = text.indexOf('{');
    const candidateStart = start >= 0 ? start : objectStart;
    if (candidateStart < 0) {
      throw new Error('Unable to parse Wrangler JSON output.');
    }
    return JSON.parse(text.slice(candidateStart));
  }
}

export function extractD1Rows(payload) {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const rows = extractD1Rows(item);
      if (rows) return rows;
    }
  }
  if (payload && Array.isArray(payload.results)) return payload.results;
  if (payload?.result && Array.isArray(payload.result.results)) return payload.result.results;
  if (payload?.response && Array.isArray(payload.response.results)) return payload.response.results;
  return [];
}

export async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}
