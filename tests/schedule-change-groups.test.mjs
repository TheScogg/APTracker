import test from 'node:test';
import assert from 'node:assert/strict';

import { groupScheduleChangeRows } from '../js/schedule-change-groups.mjs';

test('combines separate part/cavity rows for the same press and mold', () => {
  const groups = groupScheduleChangeRows([
    { section: 'northBayChanges', rowId: '4_09', press: '4.09', mc: 'M-100', partNumber: '265-A', description: 'Left', cavity: '1-4' },
    { section: 'northBayChanges', rowId: '4_09_cav58', press: '4.09', mc: 'M-100', partNumber: '265-B', description: 'Right', cavity: '5-8' }
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].rowId, '4_09');
  assert.deepEqual(groups[0].rowIds, ['4_09', '4_09_cav58']);
  assert.equal(groups[0].partNumber, '265-A, 265-B');
  assert.deepEqual(groups[0].partNumbers, ['265-A', '265-B']);
  assert.equal(groups[0].cavity, '1-4, 5-8');
});

test('uses press as the mold identity fallback when mold code is omitted', () => {
  const groups = groupScheduleChangeRows([
    { section: 'southBayChanges', rowId: '7_01', press: '7.01', partNumber: 'A' },
    { section: 'southBayChanges', rowId: '7_01_2', press: '7.01', partNumber: 'B' }
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].partNumbers, ['A', 'B']);
});

test('keeps explicitly different molds on the same press as separate issues', () => {
  const groups = groupScheduleChangeRows([
    { section: 'northBayChanges', rowId: '5_01', press: '5.01', mc: 'M-100', partNumber: 'A' },
    { section: 'northBayChanges', rowId: '5_01_2', press: '5.01', mc: 'M-200', partNumber: 'B' }
  ]);

  assert.equal(groups.length, 2);
});

test('does not combine identical presses from different change sections', () => {
  const groups = groupScheduleChangeRows([
    { section: 'northBayChanges', rowId: '4_09', press: '4.09', mc: 'M-100', partNumber: 'A' },
    { section: 'southBayChanges', rowId: '4_09', press: '4.09', mc: 'M-100', partNumber: 'B' }
  ]);

  assert.equal(groups.length, 2);
});
