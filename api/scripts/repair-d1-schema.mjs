#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  executeD1Command,
  extractD1Rows,
  resolveD1DatabaseName,
  resolveD1ExecutionMode
} from './d1-cli.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const databaseName = resolveD1DatabaseName();
const mode = resolveD1ExecutionMode();
const isDryRun = process.argv.includes('--dry-run');

if (!databaseName) {
  console.error('Missing D1 database name. Pass --database <name> or set APTRACKER_D1_DATABASE_NAME.');
  process.exit(1);
}

function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function queryRows(sql) {
  const payload = await executeD1Command(databaseName, sql, { mode, workdir: repoRoot });
  return extractD1Rows(payload);
}

async function hasTable(tableName) {
  const rows = await queryRows(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${quoteSqlString(tableName)};`
  );
  return rows.some(row => row.name === tableName);
}

async function hasIndex(indexName) {
  const rows = await queryRows(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ${quoteSqlString(indexName)};`
  );
  return rows.some(row => row.name === indexName);
}

async function tableColumns(tableName) {
  const rows = await queryRows(`PRAGMA table_info(${tableName});`);
  return new Set(rows.map(row => String(row.name || '')));
}

const pendingStatements = [];

async function ensureTable(tableName, createSql) {
  if (!(await hasTable(tableName))) {
    pendingStatements.push({ label: `create table ${tableName}`, sql: createSql });
  }
}

async function ensureIndex(indexName, createSql) {
  if (!(await hasIndex(indexName))) {
    pendingStatements.push({ label: `create index ${indexName}`, sql: createSql });
  }
}

async function ensureColumn(tableName, columnName, alterSql) {
  const columns = await tableColumns(tableName);
  if (!columns.has(columnName)) {
    pendingStatements.push({ label: `add column ${tableName}.${columnName}`, sql: alterSql });
  }
}

await ensureColumn(
  'users',
  'theme_prefs_json',
  'ALTER TABLE users ADD COLUMN theme_prefs_json TEXT CHECK (theme_prefs_json IS NULL OR json_valid(theme_prefs_json));'
);
await ensureColumn(
  'users',
  'global_xp_spent',
  'ALTER TABLE users ADD COLUMN global_xp_spent INTEGER NOT NULL DEFAULT 0;'
);
await ensureColumn(
  'users',
  'inventory_json',
  'ALTER TABLE users ADD COLUMN inventory_json TEXT CHECK (inventory_json IS NULL OR json_valid(inventory_json));'
);
await ensureTable(
  'user_push_tokens',
  `CREATE TABLE user_push_tokens (
    uid TEXT NOT NULL,
    token_id TEXT NOT NULL,
    token TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'fcm',
    platform TEXT,
    user_agent TEXT,
    notification_permission TEXT,
    plant_ids_json TEXT CHECK (plant_ids_json IS NULL OR json_valid(plant_ids_json)),
    current_plant_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (uid, token_id),
    FOREIGN KEY (uid) REFERENCES users(uid)
  );`
);
await ensureIndex(
  'idx_user_push_tokens_provider',
  'CREATE INDEX idx_user_push_tokens_provider ON user_push_tokens(provider);'
);
await ensureColumn(
  'role_feed_alerts',
  'notification_delivery_json',
  'ALTER TABLE role_feed_alerts ADD COLUMN notification_delivery_json TEXT CHECK (notification_delivery_json IS NULL OR json_valid(notification_delivery_json));'
);
await ensureColumn(
  'conversation_messages',
  'notification_delivery_json',
  'ALTER TABLE conversation_messages ADD COLUMN notification_delivery_json TEXT CHECK (notification_delivery_json IS NULL OR json_valid(notification_delivery_json));'
);
await ensureColumn(
  'issues',
  'timer_enabled',
  'ALTER TABLE issues ADD COLUMN timer_enabled INTEGER NOT NULL DEFAULT 0 CHECK (timer_enabled IN (0, 1));'
);
await ensureColumn('issues', 'timer_started_at', 'ALTER TABLE issues ADD COLUMN timer_started_at TEXT;');
await ensureColumn('issues', 'timer_due_at', 'ALTER TABLE issues ADD COLUMN timer_due_at TEXT;');
await ensureColumn('issues', 'timer_due_at_ms', 'ALTER TABLE issues ADD COLUMN timer_due_at_ms INTEGER;');
await ensureColumn('issues', 'timer_duration_minutes', 'ALTER TABLE issues ADD COLUMN timer_duration_minutes INTEGER;');
await ensureColumn('issues', 'timer_notification_status', 'ALTER TABLE issues ADD COLUMN timer_notification_status TEXT;');
await ensureColumn('issues', 'timer_notification_owner_uid', 'ALTER TABLE issues ADD COLUMN timer_notification_owner_uid TEXT;');
await ensureColumn(
  'issues',
  'timer_notification_requested_by_json',
  'ALTER TABLE issues ADD COLUMN timer_notification_requested_by_json TEXT CHECK (timer_notification_requested_by_json IS NULL OR json_valid(timer_notification_requested_by_json));'
);
await ensureColumn(
  'issues',
  'timer_notification_delivery_json',
  'ALTER TABLE issues ADD COLUMN timer_notification_delivery_json TEXT CHECK (timer_notification_delivery_json IS NULL OR json_valid(timer_notification_delivery_json));'
);
await ensureColumn(
  'issues',
  'workflow_state_by_entry_history_json',
  'ALTER TABLE issues ADD COLUMN workflow_state_by_entry_history_json TEXT CHECK (workflow_state_by_entry_history_json IS NULL OR json_valid(workflow_state_by_entry_history_json));'
);
await ensureColumn(
  'issues',
  'workflow_state_by_status_json',
  'ALTER TABLE issues ADD COLUMN workflow_state_by_status_json TEXT CHECK (workflow_state_by_status_json IS NULL OR json_valid(workflow_state_by_status_json));'
);
await ensureColumn(
  'issues',
  'workflow_state_by_status_history_json',
  'ALTER TABLE issues ADD COLUMN workflow_state_by_status_history_json TEXT CHECK (workflow_state_by_status_history_json IS NULL OR json_valid(workflow_state_by_status_history_json));'
);
await ensureIndex(
  'ix_issues_timer_pending',
  `CREATE INDEX ix_issues_timer_pending
   ON issues (plant_id, timer_notification_status, timer_due_at_ms)
   WHERE timer_enabled = 1;`
);

if (!pendingStatements.length) {
  console.log(JSON.stringify({
    databaseName,
    mode,
    dryRun: isDryRun,
    applied: 0,
    pending: 0,
    message: 'D1 schema already includes all tracked post-core additions.'
  }, null, 2));
  process.exit(0);
}

if (isDryRun) {
  console.log(JSON.stringify({
    databaseName,
    mode,
    dryRun: true,
    applied: 0,
    pending: pendingStatements.length,
    statements: pendingStatements.map(item => item.label)
  }, null, 2));
  process.exit(0);
}

for (const statement of pendingStatements) {
  process.stdout.write(`Applying: ${statement.label}\n`);
  await executeD1Command(databaseName, statement.sql, { mode, workdir: repoRoot });
}

console.log(JSON.stringify({
  databaseName,
  mode,
  dryRun: false,
  applied: pendingStatements.length,
  statements: pendingStatements.map(item => item.label)
}, null, 2));
