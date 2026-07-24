import test from 'node:test';
import assert from 'node:assert/strict';
import { __testOnly } from '../../server/d1-api.js';

test('similar-fix candidate query excludes its source issue', () => {
  const query = __testOnly.similarFixesCandidateQuery('plant-a', 'issue-42');

  assert.match(query.sql, /AND issue_id != \?/);
  assert.deepEqual(query.params, ['plant-a', 'issue-42']);
});

test('new-issue similar-fix candidate query has no source exclusion', () => {
  const query = __testOnly.similarFixesCandidateQuery('plant-a');

  assert.doesNotMatch(query.sql, /AND issue_id != \?/);
  assert.deepEqual(query.params, ['plant-a']);
});

test('similar-fix fallback returns scored internal evidence when the model omits matches', () => {
  const matches = __testOnly.fallbackInternalMatches([
    { issueId: 'same-press', machineCode: '4.11', sameMachine: true, matchedTerms: ['feeder'], resolution: 'Reset the feeder.' },
    { issueId: 'unrelated', machineCode: '5.01', sameMachine: false, matchedTerms: ['sensor'], resolution: 'Replace the sensor.' }
  ], '4.11');

  assert.deepEqual(matches, [{
    issueId: 'same-press',
    whySimilar: 'Same press: 4.11. Matching terms: feeder.',
    fix: 'Reset the feeder.'
  }]);
});

test('similar-fix terms use whole meaningful words, not substrings', () => {
  assert.deepEqual(__testOnly.similarFixesTerms('Hot runner photo and the current draw'), ['hot', 'runner', 'photo', 'current', 'draw']);
});

test('similar-fix status history retains categories and comments for matching', () => {
  assert.deepEqual(__testOnly.normalizeSimilarFixesStatusHistory([
    { statusKey: 'maintenance', subStatusKey: 'Hydraulic leak', comment: 'Oil under the clamp.' }
  ]), [{
    status: 'maintenance',
    subStatus: 'Hydraulic leak',
    note: 'Oil under the clamp.'
  }]);
});
