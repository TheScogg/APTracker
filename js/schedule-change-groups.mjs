function normalizedIdentity(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function uniqueValues(rows, field) {
  const seen = new Set();
  const values = [];
  for (const row of rows) {
    const value = String(row?.[field] || '').trim();
    const key = normalizedIdentity(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return values;
}

function mergeChangeRows(rows) {
  const first = rows[0];
  const partNumbers = uniqueValues(rows, 'partNumber');
  const descriptions = uniqueValues(rows, 'description');
  const cavities = uniqueValues(rows, 'cavity');
  const notes = uniqueValues(rows, 'notes');
  const moldCodes = uniqueValues(rows, 'mc');

  return {
    ...first,
    rowIds: uniqueValues(rows, 'rowId'),
    partNumbers,
    descriptions,
    cavities,
    partNumber: partNumbers.join(', '),
    description: descriptions.join(' / '),
    cavity: cavities.join(', '),
    notes: notes.join(' / '),
    mc: moldCodes.join(', ')
  };
}

/**
 * Schedule extraction keeps one row per part/cavity. Issue creation instead
 * needs one row per physical mold change. A section + press + mold code is the
 * best available mold identity; when the schedule omits a mold code, the press
 * is the fallback because each change section represents one change per press.
 */
export function groupScheduleChangeRows(rows = []) {
  const pressBuckets = new Map();

  for (const row of rows) {
    const press = normalizedIdentity(row?.press);
    if (!press) continue;
    const section = normalizedIdentity(row?.section);
    const key = `${section}\u0000${press}`;
    if (!pressBuckets.has(key)) pressBuckets.set(key, []);
    pressBuckets.get(key).push(row);
  }

  const groups = [];
  for (const pressRows of pressBuckets.values()) {
    const knownMolds = new Set(
      pressRows.map(row => normalizedIdentity(row?.mc)).filter(Boolean)
    );

    // A single known mold (or no mold value at all) means split rows are the
    // separate parts/cavities of the same physical changeover.
    if (knownMolds.size <= 1) {
      groups.push(mergeChangeRows(pressRows));
      continue;
    }

    // Preserve genuinely distinct mold changes when the source explicitly
    // provides more than one mold code for the same press.
    const moldBuckets = new Map();
    for (const row of pressRows) {
      const mold = normalizedIdentity(row?.mc);
      const key = mold || `unknown:${row?.rowId || moldBuckets.size}`;
      if (!moldBuckets.has(key)) moldBuckets.set(key, []);
      moldBuckets.get(key).push(row);
    }
    for (const moldRows of moldBuckets.values()) groups.push(mergeChangeRows(moldRows));
  }

  return groups;
}
