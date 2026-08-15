import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __testOnly,
  serializeIssue,
  serializeIssueAttachment,
  serializeIssueEvent,
  serializePlant,
  serializePressConfig,
  serializeStatusConfig,
  serializeUserContextRows,
  serializeTodo
} from './serializers.js';

test('serializeUserContextRows groups memberships under one user', () => {
  const result = serializeUserContextRows([
    {
      uid: 'u1',
      email: 'person@example.com',
      display_name: 'Pat',
      photo_url: 'https://example.com/pat.png',
      last_plant_id: 'p2',
      language_prefs_json: '{"locale":"fr","schemaVersion":1}',
      plant_id: 'p1',
      plant_name: 'Plant 1',
      role: 'admin',
      is_active: 1,
      permissions_json: '{"canViewPlant":true}'
    },
    {
      uid: 'u1',
      email: 'person@example.com',
      display_name: 'Pat',
      photo_url: 'https://example.com/pat.png',
      last_plant_id: 'p2',
      plant_id: 'p2',
      plant_name: 'Plant 2',
      role: 'member',
      is_active: 1,
      permissions_json: '{"canViewPlant":true,"canEditIssue":false}'
    }
  ]);

  assert.equal(result.user.uid, 'u1');
  assert.deepEqual(result.user.languagePrefs, { locale: 'fr', schemaVersion: 1 });
  assert.equal(result.plants.length, 2);
  assert.deepEqual(result.plants[1].permissions, {
    canViewPlant: true,
    canEditIssue: false
  });
});

test('serializeIssue parses flags, dates, and JSON fields', () => {
  const createdAt = new Date('2026-06-06T12:00:00.000Z');
  const result = serializeIssue({
    issue_id: 'i1',
    plant_id: 'p1',
    high_priority: 1,
    is_open: 1,
    is_resolved: 0,
    serial_required: 1,
    serial_captured: 0,
    tags_json: '["alpha","beta"]',
    workflow_state_by_entry_json: '{"entry":"triage"}',
    workflow_state_by_entry_history_json: '{"entry":{"called":{"at":"2026-06-06T12:00:00.000Z"}}}',
    workflow_state_by_status_json: '{"maintenance":"accepted"}',
    workflow_state_by_status_history_json: '{"maintenance":{"accepted":{"at":"2026-06-06T12:01:00.000Z"}}}',
    workflow_state_history_json: '[{"state":"triage"}]',
    legacy_status_history_json: '[{"label":"Open"}]',
    quality_defect_json: '{"key":"flash","label":"Flash / burrs"}',
    created_at: createdAt,
    updated_at: createdAt,
    schema_version: 2
  });

  assert.equal(result.issueId, 'i1');
  assert.equal(result.highPriority, true);
  assert.deepEqual(result.tags, ['alpha', 'beta']);
  assert.deepEqual(result.workflowStateByEntry, { entry: 'triage' });
  assert.deepEqual(result.workflowStateByEntryHistory, {
    entry: { called: { at: '2026-06-06T12:00:00.000Z' } }
  });
  assert.deepEqual(result.workflowStateByStatus, { maintenance: 'accepted' });
  assert.deepEqual(result.workflowStateByStatusHistory, {
    maintenance: { accepted: { at: '2026-06-06T12:01:00.000Z' } }
  });
  assert.deepEqual(result.qualityDefect, { key: 'flash', label: 'Flash / burrs' });
  assert.equal(result.createdAt, '2026-06-06T12:00:00.000Z');
});

test('serializeEvent and attachment parse timestamps and payloads', () => {
  const resultEvent = serializeIssueEvent({
    event_id: 'e1',
    issue_id: 'i1',
    plant_id: 'p1',
    event_type: 'status_changed',
    event_at: '2026-06-06T12:00:00.000Z',
    payload_json: '{"status":"closed"}',
    created_at: '2026-06-06T12:01:00.000Z'
  });
  const resultAttachment = serializeIssueAttachment({
    attachment_id: 'a1',
    issue_id: 'i1',
    plant_id: 'p1',
    storage_path: 'plants/p1/issues/i1/photo.jpg',
    uploaded_at: '2026-06-06T12:02:00.000Z',
    schema_version: 1
  });

  assert.deepEqual(resultEvent.payload, { status: 'closed' });
  assert.equal(resultAttachment.uploadedAt, '2026-06-06T12:02:00.000Z');
});

test('config serializers parse JSON and normalize dates', () => {
  const updatedAt = '2026-06-06T12:03:00.000Z';

  assert.equal(serializePlant({
    plant_id: 'p1',
    name: 'Plant 1',
    is_active: 1,
    created_at: updatedAt,
    updated_at: updatedAt,
    schema_version: 1
  }).isActive, true);

  assert.deepEqual(serializeStatusConfig({
    plant_id: 'p1',
    statuses_json: '{"open":{"label":"Open"}}',
    subcategory_routes_json: '{"qa":["inspection"]}',
    updated_at: updatedAt
  }).statuses, { open: { label: 'Open' } });

  assert.deepEqual(serializePressConfig({
    plant_id: 'p1',
    presses_json: '[{"id":"p-1"}]',
    updated_at: updatedAt
  }).presses, [{ id: 'p-1' }]);
});

test('test helpers fall back safely on bad JSON and dates', () => {
  assert.equal(__testOnly.toIso('not-a-date'), null);
  assert.deepEqual(__testOnly.parseJson('{bad}', []), []);
});

test('serializeTodo correctly serializes todo D1 rows', () => {
  const result = serializeTodo({
    todo_id: 't1',
    scope: 'personal',
    plant_id: 'p1',
    owner_uid: 'u1',
    title: 'Buy groceries',
    notes: 'Milk and bread',
    list_name: 'Inbox',
    due_date: '2026-07-02',
    priority: 'high',
    is_completed: 1,
    completed_at: '2026-07-02T12:00:00.000Z',
    press_id: 'press-1',
    machine_code: '1.02',
    issue_id: 'issue-123',
    search_text: 'buy groceries milk and bread inbox 1.02 issue-123',
    created_by_json: '{"uid":"u1","name":"Pat"}',
    updated_by_json: '{"uid":"u1","name":"Pat"}',
    created_at: '2026-07-02T11:00:00.000Z',
    updated_at: '2026-07-02T11:30:00.000Z'
  });

  assert.equal(result.id, 't1');
  assert.equal(result.scope, 'personal');
  assert.equal(result.isCompleted, true);
  assert.deepEqual(result.createdBy, { uid: 'u1', name: 'Pat' });
  assert.equal(result.completedAt, '2026-07-02T12:00:00.000Z');
  assert.equal(result.dueDate, '2026-07-02');
});
