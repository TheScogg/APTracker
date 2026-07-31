const SHIFT_ALIASES = new Map([
  ['1', '1'],
  ['1st', '1'],
  ['first', '1'],
  ['one', '1'],
  ['2', '2'],
  ['2nd', '2'],
  ['second', '2'],
  ['two', '2'],
  ['3', '3'],
  ['3rd', '3'],
  ['third', '3'],
  ['three', '3']
]);

export function normalizeScheduleShift(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  const compact = raw
    .replace(/^shift\s*(?:number|no\.?|#)?\s*[:#-]?\s*/i, '')
    .replace(/\s*shift$/i, '')
    .trim();
  return SHIFT_ALIASES.get(compact) || '';
}

export function requireScheduleShift(value, fieldName = 'schedule_info.shift') {
  const shift = normalizeScheduleShift(value);
  if (!shift) {
    throw Object.assign(
      new Error(`${fieldName} must identify Shift 1, 2, or 3.`),
      { status: 400 }
    );
  }
  return shift;
}

export function findScheduleShifts(text) {
  const source = String(text || '');
  const matches = new Set();
  const patterns = [
    /\bshift\s*(?:number|no\.?|#)?\s*[:#-]?\s*(1st|2nd|3rd|[123]|first|second|third|one|two|three)\b/gi,
    /\b(1st|2nd|3rd|first|second|third)\s+shift\b/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const shift = normalizeScheduleShift(match[1]);
      if (shift) matches.add(shift);
    }
  }
  return [...matches].sort();
}

export function ascertainScheduleShift({ text = '', reportedShift = '', override = '' } = {}) {
  if (String(override || '').trim()) {
    return requireScheduleShift(override, 'Shift override');
  }

  const detected = findScheduleShifts(text);
  const reported = normalizeScheduleShift(reportedShift);
  if (detected.length > 1) {
    throw Object.assign(
      new Error(`Multiple shifts were found in the schedule text (${detected.join(', ')}). Import one shift schedule at a time.`),
      { status: 400 }
    );
  }
  if (detected.length === 1) {
    if (reported && reported !== detected[0]) {
      throw Object.assign(
        new Error(`The schedule header indicates Shift ${detected[0]}, but the converted JSON indicates Shift ${reported}. Review the schedule before importing.`),
        { status: 400 }
      );
    }
    return detected[0];
  }
  if (reported) return reported;
  throw Object.assign(
    new Error('Could not ascertain the schedule shift. The schedule must clearly identify Shift 1, 2, or 3.'),
    { status: 400 }
  );
}

export function scheduleShiftIssueKey(value) {
  const shift = requireScheduleShift(value, 'Schedule shift');
  return shift === '1' ? 'first' : shift === '2' ? 'second' : 'third';
}

export function scheduleShiftLabel(value) {
  const shift = requireScheduleShift(value, 'Schedule shift');
  return `Shift ${shift}`;
}
