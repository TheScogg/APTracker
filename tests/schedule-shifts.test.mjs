import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ascertainScheduleShift,
  findScheduleShifts,
  normalizeScheduleShift,
  requireScheduleShift,
  scheduleShiftIssueKey
} from '../js/schedule-shifts.mjs';

test('normalizes supported schedule shift labels', () => {
  assert.equal(normalizeScheduleShift('1'), '1');
  assert.equal(normalizeScheduleShift('Shift #2'), '2');
  assert.equal(normalizeScheduleShift('3rd Shift'), '3');
  assert.equal(normalizeScheduleShift('second'), '2');
});

test('detects a shift from common schedule headers', () => {
  assert.deepEqual(findScheduleShifts('Daily Production Schedule\nSHIFT: 2\nJuly 30, 2026'), ['2']);
  assert.deepEqual(findScheduleShifts('3rd Shift Production Schedule'), ['3']);
  assert.equal(ascertainScheduleShift({ text: 'Schedule - Shift No. 1' }), '1');
});

test('uses converted JSON only when the OCR text has no shift', () => {
  assert.equal(ascertainScheduleShift({ text: 'Daily production schedule', reportedShift: 'third' }), '3');
});

test('rejects missing, conflicting, and ambiguous shifts', () => {
  assert.throws(() => requireScheduleShift(''), /must identify Shift 1, 2, or 3/);
  assert.throws(
    () => ascertainScheduleShift({ text: 'SHIFT: 1', reportedShift: '2' }),
    /header indicates Shift 1/
  );
  assert.throws(
    () => ascertainScheduleShift({ text: 'Shift 1 schedule copied from Shift 2 schedule' }),
    /Multiple shifts/
  );
});

test('maps production schedule shifts to issue filter keys', () => {
  assert.equal(scheduleShiftIssueKey('1'), 'first');
  assert.equal(scheduleShiftIssueKey('2'), 'second');
  assert.equal(scheduleShiftIssueKey('3'), 'third');
});
