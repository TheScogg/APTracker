export function initNotesTool(deps) {
  const {
    getCurrentUser, getCurrentPlantId, getIssues,
    getCurrentOpenMachine, getCurrentOpenIssue, currentActor,
    toPressId, esc, localDateStr,
    completeDemoGuideStep, readFileAsDataUrl, uploadAttachmentToPreferredStorage,
    deleteStoredAttachmentBlob, _relativeTime, _bindToolModalShellNavigation,
    closeUserMenus, closeSortDropdown,
    shouldUseSqlStagingReads, requireSqlRead, dataApi,
    doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
    onSnapshot, query, where, orderBy, limit, serverTimestamp, writeBatch, increment,
    notesCol, noteDoc, noteAttachmentsCol, noteStoragePrefix,
    db,
    normalizeChecklistItems, _noteTextFromHtml, sanitizeNoteHtml
  } = deps;

let _notesLoadToken = 0;
let _notesSaveTimer = null;
let _notesUnsubscribe = null;
let _notesPollTimer = null;
let _notesAttachmentsCache = [];
let _notesContext = { pressId: null, issueId: null, label: 'Plant-wide' };
const _notesState = {
  notes: [],
  activeNoteId: null,
  view: 'list',
  filter: 'all',
  search: '',
  saving: false,
  lastSavedAt: null,
  draftChecklistId: 1,
  dirty: false,
  creating: false,
  previewMode: false,
  lockContext: false,
  error: '',
  currentNote: null
};

function _notesIsMobileLayout() {
  return window.innerWidth <= 860;
}

function _notesSyncLayout() {
  const modal = document.getElementById('notes-modal');
  if (!modal) return;
  const isEditor = _notesState.view === 'editor' && !!_notesState.currentNote?.id;
  const isNarrow = window.innerWidth <= 860;
  if (isNarrow) {
    modal.classList.toggle('notes-mobile-list', !isEditor);
    modal.classList.toggle('notes-mobile-editor', isEditor);
  } else {
    modal.classList.remove('notes-mobile-list', 'notes-mobile-editor');
  }
}

window.closeNotesEditorModal = function () {
  _notesSetView('list');
  _notesRenderEditor(null);
  _notesRenderList();
};

function _notesSetView(view) {
  _notesState.view = view === 'editor' ? 'editor' : 'list';
  _notesSyncLayout();
}

// ── NOTES MODAL ──
function _notesContextTitle(context = _notesContext) {
  if (!context) return 'Plant-wide';
  if (context.issueId) return context.label || 'Issue notes';
  if (context.pressId) return context.label || 'Press notes';
  return context.label || 'Plant-wide';
}

function _notesOpenPressContext() {
  if (_notesContext.pressId) {
    return {
      pressId: _notesContext.pressId,
      machineCode: _notesContext.machineCode || _notesContext.label?.replace(/^Press\s*[·-]?\s*/i, '') || ''
    };
  }
  const issue = getCurrentOpenIssue();
  const machineCode = issue?.machine || getCurrentOpenMachine();
  const pressId = issue?.pressId || (machineCode ? toPressId(machineCode) : '');
  return pressId ? { pressId, machineCode } : null;
}

function _notesOpenIssueContext() {
  if (_notesContext.issueId) {
    const issue = getIssues().find(i => i.id === _notesContext.issueId) || null;
    const machineCode = issue?.machine || _notesContext.machineCode || '';
    const pressId = issue?.pressId || _notesContext.pressId || (machineCode ? toPressId(machineCode) : '');
    return { issueId: _notesContext.issueId, pressId, machineCode };
  }
  const issue = getCurrentOpenIssue();
  if (!issue?.id) return null;
  const machineCode = issue.machine || '';
  return {
    issueId: issue.id,
    pressId: issue.pressId || (machineCode ? toPressId(machineCode) : ''),
    machineCode
  };
}

function _notesNormalizeDoc(note = {}) {
  const checklistItems = normalizeChecklistItems(note.checklistItems);
  const tags = Array.isArray(note.tags)
    ? note.tags.map(tag => String(tag || '').trim()).filter(Boolean)
    : String(note.tags || '').split(',').map(tag => tag.trim()).filter(Boolean);
  const bodyHtml = sanitizeNoteHtml(note.bodyHtml || note.body || '');
  const bodyText = String(note.bodyText || _noteTextFromHtml(bodyHtml) || '').trim();
  const machineCode = String(note.machineCode || '').trim();
  const pressId = String(note.pressId || '').trim();
  const issueId = String(note.issueId || '').trim();
  return {
    id: note.id,
    title: String(note.title || 'Untitled Note').trim() || 'Untitled Note',
    bodyHtml,
    bodyText,
    checklistItems,
    tags,
    pressId,
    machineCode,
    issueId,
    isPinned: Boolean(note.isPinned),
    isArchived: Boolean(note.isArchived),
    photoCount: Number(note.photoCount || 0),
    searchText: String(note.searchText || '').toLowerCase(),
    createdBy: note.createdBy || null,
    createdAt: note.createdAt || null,
    updatedBy: note.updatedBy || null,
    updatedAt: note.updatedAt || null,
    schemaVersion: Number(note.schemaVersion || 1)
  };
}

function _notesSortValue(note) {
  const updatedAt = note?.updatedAt?.toMillis?.()
    ?? note?.updatedAt?.seconds * 1000
    ?? (note?.updatedAt ? new Date(note.updatedAt).getTime() : 0);
  return {
    pinned: note?.isPinned ? 1 : 0,
    archived: note?.isArchived ? 1 : 0,
    updatedAt,
    title: String(note?.title || '').toLowerCase()
  };
}

function _notesCreateClientId(prefix = 'note') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function _notesCompare(a, b) {
  const pa = _notesSortValue(a);
  const pb = _notesSortValue(b);
  if (pa.pinned !== pb.pinned) return pb.pinned - pa.pinned;
  if (pa.archived !== pb.archived) return pa.archived - pb.archived;
  if (pa.updatedAt !== pb.updatedAt) return pb.updatedAt - pa.updatedAt;
  return pa.title.localeCompare(pb.title);
}

function _notesCurrentContextMatches(note) {
  if (!note) return false;
  if (_notesContext.issueId) {
    const issueMatch = note.issueId === _notesContext.issueId;
    const pressMatch = _notesContext.pressId ? note.pressId === _notesContext.pressId : false;
    return issueMatch || pressMatch;
  }
  if (_notesContext.pressId) return note.pressId === _notesContext.pressId;
  return true;
}

function _notesMatchesFilter(note) {
  if (!note) return false;
  const filter = _notesState.filter;
  if (filter === 'pinned' && !note.isPinned) return false;
  if (filter === 'archived' && !note.isArchived) return false;
  if (filter === 'linked') {
    if (_notesContext.pressId || _notesContext.issueId) return _notesCurrentContextMatches(note);
    if (!note.pressId && !note.issueId) return false;
  }
  const q = String(_notesState.search || '').trim().toLowerCase();
  if (!q) return true;
  const issue = note.issueId ? getIssues().find(i => i.id === note.issueId) : null;
  const haystack = [
    note.title,
    note.bodyText,
    note.tags.join(' '),
    note.checklistItems.map(item => item.text).join(' '),
    note.pressId,
    note.machineCode,
    note.issueId,
    issue?.machine || '',
    issue?.note || ''
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

function _notesVisibleNotes() {
  return (_notesState.notes || []).filter(_notesMatchesFilter).sort(_notesCompare);
}

function _notesDisplayTime(ts) {
  return _relativeTime(ts) || 'just now';
}

function _notesDisplayContextChip(note) {
  if (!note) return '';
  if (note.issueId) {
    const issue = getIssues().find(i => i.id === note.issueId);
    return issue
      ? `Issue · ${issue.machine || issue.pressId || issue.id}`
      : `Issue · ${note.issueId}`;
  }
  if (note.pressId) {
    return `Press · ${note.machineCode || note.pressId}`;
  }
  return '';
}

function _notesContextLabelForModal() {
  return _notesContextTitle(_notesContext);
}

function _notesSplitTags(value = '') {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map(tag => tag.trim().replace(/^#/, ''))
      .filter(Boolean)
  ));
}

function _notesKnownTags() {
  const tags = new Set();
  (_notesState.notes || []).forEach(note => {
    (note?.tags || []).forEach(tag => {
      const clean = String(tag || '').trim().replace(/^#/, '');
      if (clean) tags.add(clean);
    });
  });
  (_notesState.currentNote?.tags || []).forEach(tag => {
    const clean = String(tag || '').trim().replace(/^#/, '');
    if (clean) tags.add(clean);
  });
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

function _notesTagQuery() {
  const tagsEl = document.getElementById('notes-tags');
  if (!tagsEl) return '';
  const raw = String(tagsEl.value || '');
  const parts = raw.split(',');
  return String(parts[parts.length - 1] || '').trim().replace(/^#/, '');
}

function _notesRenderTagChips(note = _notesState.currentNote) {
  const wrap = document.getElementById('notes-tag-chips');
  if (!wrap) return;
  wrap.innerHTML = '';
  const tags = Array.isArray(note?.tags) ? note.tags : [];
  if (!tags.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-tag-empty';
    empty.textContent = 'No tags yet. Add one below or type # in the note body.';
    wrap.appendChild(empty);
    return;
  }
  tags.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'notes-tag-chip';
    const label = document.createElement('span');
    label.textContent = `#${tag}`;
    chip.appendChild(label);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = `Remove ${tag}`;
    remove.addEventListener('click', () => {
      if (!_notesState.currentNote) return;
      const tagsEl = document.getElementById('notes-tags');
      const current = _notesSplitTags(tagsEl?.value || '');
      const next = current.filter(item => item.toLowerCase() !== String(tag).toLowerCase());
      _notesState.currentNote.tags = next;
      if (tagsEl) tagsEl.value = next.map(t => `#${t}`).join(', ');
      _notesRenderTagChips(_notesState.currentNote);
      _notesRenderTagSuggestions(_notesState.currentNote);
      _notesState.dirty = true;
      _notesQueueAutosave();
      _notesRenderList();
    });
    chip.appendChild(remove);
    wrap.appendChild(chip);
  });
}

function _notesRenderTagSuggestions(note = _notesState.currentNote) {
  const wrap = document.getElementById('notes-tag-suggestions');
  if (!wrap) return;
  wrap.innerHTML = '';
  const currentTags = new Set((note?.tags || []).map(tag => String(tag || '').trim().replace(/^#/, '')).filter(Boolean).map(tag => tag.toLowerCase()));
  const query = _notesTagQuery().toLowerCase();
  const known = _notesKnownTags().filter(tag => !currentTags.has(tag.toLowerCase()));
  const filtered = query
    ? known.filter(tag => tag.toLowerCase().includes(query))
    : known.slice(0, 6);
  if (!filtered.length) {
    const hint = document.createElement('div');
    hint.className = 'notes-tag-empty';
    hint.textContent = query ? 'No matching tags.' : 'Suggested tags will appear here as you use them.';
    wrap.appendChild(hint);
    return;
  }
  filtered.slice(0, 8).forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notes-tag-suggestion';
    btn.textContent = `#${tag}`;
    btn.addEventListener('click', () => {
      if (!_notesState.currentNote) return;
      const tagsEl = document.getElementById('notes-tags');
      if (!tagsEl) return;
      const existing = _notesSplitTags(tagsEl.value);
      if (!existing.includes(tag)) existing.push(tag);
      tagsEl.value = existing.map(t => `#${t}`).join(', ');
      _notesState.currentNote.tags = existing;
      _notesRenderTagChips(_notesState.currentNote);
      _notesRenderTagSuggestions(_notesState.currentNote);
      _notesState.dirty = true;
      _notesQueueAutosave();
      _notesRenderList();
    });
    wrap.appendChild(btn);
  });
}

function _notesTemplateData(templateKey = 'blank') {
  switch (templateKey) {
    case 'follow_up':
      return {
        title: 'Follow-up',
        bodyHtml: '<p>Follow up on the open item after the next run.</p>',
        tags: ['follow-up'],
        checklistItems: [
          { id: `chk_${Date.now()}_a`, text: 'Confirm next check-in', done: false }
        ]
      };
    case 'parts_needed':
      return {
        title: 'Parts Needed',
        bodyHtml: '<p>List the parts, consumables, or approvals needed before this can move.</p>',
        tags: ['parts', 'materials'],
        checklistItems: [
          { id: `chk_${Date.now()}_b`, text: 'Confirm part number', done: false },
          { id: `chk_${Date.now()}_c`, text: 'Check availability', done: false }
        ]
      };
    case 'shift_handoff':
      return {
        title: 'Shift Handoff',
        bodyHtml: '<p>Summarize status, blockers, and the next shift action.</p>',
        tags: ['handoff', 'shift'],
        checklistItems: [
          { id: `chk_${Date.now()}_d`, text: 'Leave status for the next shift', done: false }
        ]
      };
    case 'issue_summary':
      return {
        title: 'Issue Summary',
        bodyHtml: '<p>Summarize the issue, impact, and next step.</p>',
        tags: ['summary', 'issue'],
        checklistItems: [
          { id: `chk_${Date.now()}_e`, text: 'Capture current impact', done: false },
          { id: `chk_${Date.now()}_f`, text: 'Capture next action', done: false }
        ]
      };
    default:
      return { title: '', bodyHtml: '', tags: [], checklistItems: [] };
  }
}

function _notesSetMenuOpen(menuId, open) {
  const menu = document.getElementById(menuId);
  const btn = document.getElementById('notes-actions-menu-btn');
  if (!menu || !btn) return;
  menu.classList.toggle('visible', !!open);
  btn.classList.toggle('open', !!open);
  btn.setAttribute('aria-expanded', String(!!open));
}

function _notesCloseMenus(exceptMenuId = null) {
  if (exceptMenuId !== 'notes-actions-menu') _notesSetMenuOpen('notes-actions-menu', false);
}

function _notesSetPreviewMode(on) {
  _notesState.previewMode = !!on;
  const card = document.querySelector('.notes-editor-card-main');
  const btn = document.getElementById('notes-preview-btn');
  const body = document.getElementById('notes-body');
  const preview = document.getElementById('notes-body-preview');
  if (card) card.classList.toggle('previewing', _notesState.previewMode);
  if (btn) {
    btn.classList.toggle('active', _notesState.previewMode);
    btn.setAttribute('aria-pressed', String(_notesState.previewMode));
  }
  if (body) body.hidden = _notesState.previewMode;
  if (preview) preview.hidden = !_notesState.previewMode;
}

function _notesRenderBodyPreview(note = _notesState.currentNote) {
  const wrap = document.getElementById('notes-body-preview');
  if (!wrap) return;
  const html = sanitizeNoteHtml(note?.bodyHtml || '');
  const text = _noteTextFromHtml(html);
  wrap.innerHTML = html || '<div class="notes-body-preview-empty">Preview appears here when enabled.</div>';
  wrap.classList.toggle('empty', !text);
}

function _notesSyncEditorHeaderTitle(noteTitle = '') {
  const headerTitleEl = document.getElementById('notes-editor-title');
  if (!headerTitleEl) return;
  const title = String(noteTitle || '').trim();
  headerTitleEl.textContent = title || 'New Note';
}

function _notesRenderContextSummary(note = _notesState.currentNote) {
  const summaryEl = document.getElementById('notes-context-summary');
  const helpEl = document.getElementById('notes-context-help');
  const pressBtn = document.getElementById('notes-link-press-btn');
  const issueBtn = document.getElementById('notes-link-issue-btn');
  if (!summaryEl) return;
  if (note?.issueId) {
    const issue = getIssues().find(i => i.id === note.issueId);
    summaryEl.textContent = `Linked to issue ${issue?.machine || note.issueId}`;
    if (helpEl) helpEl.textContent = 'This note is attached to the selected issue.';
    if (pressBtn) pressBtn.textContent = _notesContext.pressId ? 'Relink to Open Press' : 'Link Open Press';
    if (issueBtn) issueBtn.textContent = 'Linked to Issue';
    return;
  }
  if (note?.pressId) {
    const matchesCurrentPress = Boolean(_notesContext.pressId && note.pressId === _notesContext.pressId);
    summaryEl.textContent = matchesCurrentPress
      ? `Linked to the open press ${note.machineCode || note.pressId}`
      : `Linked to press ${note.machineCode || note.pressId}`;
    if (helpEl) helpEl.textContent = matchesCurrentPress
      ? 'The note will stay attached to the press you are viewing.'
      : 'This note is linked to a different press than the one currently open.';
    if (pressBtn) pressBtn.textContent = matchesCurrentPress ? 'Keep Open Press Link' : 'Relink to Open Press';
    if (issueBtn) issueBtn.textContent = _notesContext.issueId ? 'Link Open Issue' : 'Issue Not Open';
    return;
  }
  if (_notesContext.pressId || _notesContext.issueId) {
    summaryEl.textContent = `${_notesContextTitle(_notesContext)} note`;
    if (helpEl) helpEl.textContent = 'Attach this note to the current press or issue if it belongs with the floor work.';
    if (pressBtn) pressBtn.textContent = 'Link Open Press';
    if (issueBtn) issueBtn.textContent = 'Link Open Issue';
    return;
  }
  summaryEl.textContent = 'Plant-wide note';
  if (helpEl) helpEl.textContent = 'Use this note without attaching it to a press or issue.';
  if (pressBtn) pressBtn.textContent = 'Link Open Press';
  if (issueBtn) issueBtn.textContent = 'Link Open Issue';
}

function _notesApplyTemplate(templateKey = 'blank') {
  if (!_notesState.currentNote) return;
  const template = _notesTemplateData(templateKey);
  const titleEl = document.getElementById('notes-title');
  const tagsEl = document.getElementById('notes-tags');
  const bodyEl = document.getElementById('notes-body');
  const currentTitle = String(titleEl?.value || '').trim();
  const currentBody = String(bodyEl?.innerHTML || '').trim();
  if (titleEl && (!currentTitle || templateKey !== 'blank')) titleEl.value = template.title || currentTitle;
  if (tagsEl) {
    const tags = _notesSplitTags(tagsEl.value);
    template.tags.forEach(tag => { if (!tags.includes(tag)) tags.push(tag); });
    tagsEl.value = tags.map(tag => `#${tag}`).join(', ');
    _notesState.currentNote.tags = tags;
  }
  if (bodyEl && (!currentBody || templateKey !== 'blank')) bodyEl.innerHTML = template.bodyHtml || '';
  if (_notesState.currentNote) {
    const nextTitle = titleEl?.value || _notesState.currentNote.title;
    _notesState.currentNote.title = nextTitle;
    _notesState.currentNote.bodyHtml = sanitizeNoteHtml(bodyEl?.innerHTML || '');
    _notesState.currentNote.bodyText = _noteTextFromHtml(_notesState.currentNote.bodyHtml);
    _notesState.currentNote.checklistItems = template.checklistItems.length
      ? template.checklistItems.map(item => ({ ...item }))
      : normalizeChecklistItems(_notesState.currentNote.checklistItems);
    _notesSyncEditorHeaderTitle(nextTitle);
  }
  _notesRenderTagChips(_notesState.currentNote);
  _notesRenderTagSuggestions(_notesState.currentNote);
  _notesRenderChecklist(_notesState.currentNote);
  _notesRenderBodyPreview(_notesState.currentNote);
  _notesState.dirty = true;
  _notesQueueAutosave();
  _notesRenderList();
}

function _notesRenderList() {
  const listEl = document.getElementById('notes-list');
  if (!listEl) return;
  const visibleNotes = _notesVisibleNotes();
  if (!visibleNotes.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-list-empty';
    if (_notesState.error) {
      empty.textContent = 'Notes are unavailable for this plant right now.';
    } else {
      empty.textContent = _notesState.search || _notesState.filter !== 'all'
        ? 'No notes match this filter yet.'
        : 'No notes yet. Tap New Note to start your notebook.';
    }
    listEl.innerHTML = '';
    listEl.appendChild(empty);
    return;
  }
  listEl.innerHTML = '';
  visibleNotes.forEach(note => {
    const btn = document.createElement('div');
    btn.className = `note-card ${note.id === _notesState.activeNoteId ? 'active' : ''}`;
    btn.addEventListener('click', () => {
      void _notesSelectNote(note.id);
    });

    const top = document.createElement('div');
    top.className = 'note-title';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = note.title || 'Untitled Note';
    top.appendChild(titleSpan);

    if (note.isPinned) {
      const pinIcon = document.createElement('span');
      pinIcon.className = 'pin-icon';
      pinIcon.textContent = '📌';
      top.appendChild(pinIcon);
    }

    const preview = document.createElement('div');
    preview.className = 'note-preview';
    const bodyPreview = note.bodyText || note.checklistItems.map(item => item.text).filter(Boolean).join(' • ');
    preview.textContent = bodyPreview || 'No content yet.';

    const meta = document.createElement('div');
    meta.className = 'note-meta';

    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'tags';

    // Add context/badge tags to the tags list as well
    if (note.pressId || note.issueId) {
      const linkedTag = document.createElement('span');
      linkedTag.className = 'tag';
      linkedTag.textContent = note.issueId ? '#issue' : '#press';
      tagsDiv.appendChild(linkedTag);
    }
    if (note.isArchived) {
      const archTag = document.createElement('span');
      archTag.className = 'tag';
      archTag.textContent = '#archived';
      tagsDiv.appendChild(archTag);
    }
    if (Array.isArray(note.tags)) {
      note.tags.forEach(t => {
        const tagSpan = document.createElement('span');
        tagSpan.className = 'tag';
        tagSpan.textContent = `#${t}`;
        tagsDiv.appendChild(tagSpan);
      });
    }

    const time = document.createElement('div');
    time.className = 'timestamp';
    time.textContent = _notesDisplayTime(note.updatedAt);

    meta.appendChild(tagsDiv);
    meta.appendChild(time);

    btn.appendChild(top);
    btn.appendChild(preview);
    btn.appendChild(meta);
    listEl.appendChild(btn);
  });
}

function _notesSetStatus(message, updatedMessage = '') {
  const statusEl = document.getElementById('notes-editor-save-state');
  const updatedEl = document.getElementById('notes-editor-updated');
  if (statusEl) statusEl.textContent = message || '';
  if (updatedEl) updatedEl.textContent = updatedMessage || '';
  if (statusEl) {
    const isSaving = /saving/i.test(message || '');
    const isError = /could not|failed|unavailable/i.test(message || '');
    const isOffline = !navigator.onLine && !isSaving && !isError;
    statusEl.classList.toggle('is-saving', isSaving);
    statusEl.classList.toggle('is-error', isError);
    statusEl.classList.toggle('is-offline', isOffline);
  }
}

function _notesRenderContextChips(note = _notesState.currentNote) {
  const wrap = document.getElementById('notes-context-chips');
  if (!wrap) return;
  wrap.innerHTML = '';
  const chips = [];
  if (_notesContext.pressId || _notesContext.issueId) {
    chips.push({
      label: _notesContextLabelForModal(),
      removable: false
    });
  }
  if (note?.pressId) {
    chips.push({
      label: `Press · ${note.machineCode || note.pressId}`,
      removable: true,
      onRemove: () => {
        note.pressId = '';
        note.machineCode = '';
        void _notesSaveActiveNote({ immediate: true });
      }
    });
  }
  if (note?.issueId) {
    const issue = getIssues().find(i => i.id === note.issueId);
    chips.push({
      label: `Issue · ${issue?.machine || note.issueId}`,
      removable: true,
      onRemove: () => {
        note.issueId = '';
        void _notesSaveActiveNote({ immediate: true });
      }
    });
  }
  if (!chips.length) {
    const chip = document.createElement('span');
    chip.className = 'notes-context-chip';
    chip.textContent = 'No linked context';
    wrap.appendChild(chip);
    return;
  }
  chips.forEach(item => {
    const chip = document.createElement('span');
    chip.className = 'notes-context-chip';
    const label = document.createElement('span');
    label.textContent = item.label;
    chip.appendChild(label);
    if (item.removable) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '✕';
      remove.addEventListener('click', () => item.onRemove?.());
      chip.appendChild(remove);
    }
    wrap.appendChild(chip);
  });
}

function _notesRenderChecklist(note = _notesState.currentNote) {
  const wrap = document.getElementById('notes-checklist');
  if (!wrap) return;
  wrap.innerHTML = '';
  const items = normalizeChecklistItems(note?.checklistItems || []);
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-checklist-empty';
    empty.textContent = 'Add quick checkboxes for follow-ups, parts, or reminders.';
    wrap.appendChild(empty);
    return;
  }
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'notes-check-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = Boolean(item.done);
    cb.addEventListener('change', () => {
      const current = _notesState.currentNote?.checklistItems || [];
      const next = current.map(chk => chk.id === item.id ? { ...chk, done: cb.checked } : chk);
      if (_notesState.currentNote) _notesState.currentNote.checklistItems = next;
      void _notesSaveActiveNote({ immediate: false });
    });
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'notes-check-text';
    input.value = item.text || '';
    input.placeholder = 'Checklist item';
    input.addEventListener('input', () => {
      const current = _notesState.currentNote?.checklistItems || [];
      const next = current.map(chk => chk.id === item.id ? { ...chk, text: input.value } : chk);
      if (_notesState.currentNote) _notesState.currentNote.checklistItems = next;
      _notesState.dirty = true;
      _notesQueueAutosave();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'notes-check-remove';
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
      const current = _notesState.currentNote?.checklistItems || [];
      const next = current.filter(chk => chk.id !== item.id);
      if (_notesState.currentNote) _notesState.currentNote.checklistItems = next;
      _notesRenderChecklist(_notesState.currentNote);
      _notesState.dirty = true;
      _notesQueueAutosave();
    });
    row.appendChild(cb);
    row.appendChild(input);
    row.appendChild(remove);
    wrap.appendChild(row);
  });
}

function _notesRenderAttachments() {
  const wrap = document.getElementById('notes-attachments');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!_notesAttachmentsCache.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-checklist-empty';
    empty.textContent = 'Attachments will appear here after upload.';
    wrap.appendChild(empty);
    return;
  }
  _notesAttachmentsCache.forEach((att, idx) => {
    const tile = document.createElement('div');
    tile.className = 'notes-attachment';
    const img = document.createElement('img');
    img.className = 'notes-attachment-thumb';
    img.src = att.url || att.downloadURL || '';
    img.alt = att.fileName || `Attachment ${idx + 1}`;
    img.addEventListener('click', () => {
      const photos = _notesAttachmentsCache.map(a => ({
        url: a.url || a.downloadURL || '',
        uploadedAt: a.uploadedAt || a.createdAt || ''
      })).filter(a => a.url);
      openLightbox(idx, photos);
    });
    const label = document.createElement('div');
    label.className = 'notes-attachment-label';
    label.textContent = att.fileName || att.caption || `Attachment ${idx + 1}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'notes-attachment-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => void _notesDeleteAttachment(att.id));
    tile.appendChild(img);
    tile.appendChild(label);
    tile.appendChild(remove);
    wrap.appendChild(tile);
  });
}

function _notesRenderEditor(note = null) {
  const titleEl = document.getElementById('notes-title');
  const tagsEl = document.getElementById('notes-tags');
  const bodyEl = document.getElementById('notes-body');
  const previewEl = document.getElementById('notes-body-preview');
  const pinBtn = document.getElementById('notes-pin-btn');
  const archiveBtn = document.getElementById('notes-archive-btn');
  const deleteBtn = document.getElementById('notes-delete-btn');
  const backBtn = document.getElementById('notes-back-btn');
  if (!titleEl || !tagsEl || !bodyEl || !pinBtn || !archiveBtn || !deleteBtn) return;

  const prevNoteId = _notesState.currentNote?.id || null;
  const activeEl = document.activeElement;
  const titleFocused = activeEl === titleEl;
  const tagsFocused = activeEl === tagsEl;
  const bodyFocused = activeEl === bodyEl;
  const sameActiveNote = Boolean(note?.id) && note.id === prevNoteId;

  _notesState.currentNote = note ? { ...note, checklistItems: normalizeChecklistItems(note.checklistItems) } : null;
  if (!note) _notesAttachmentsCache = [];
  if (!sameActiveNote) _notesState.previewMode = false;
  _notesState.dirty = false;
  _notesSetStatus(note ? 'Saved' : 'Select a note to begin.', note ? `Updated ${_notesDisplayTime(note.updatedAt)}` : '');
  _notesSyncEditorHeaderTitle(note?.title || '');

  const nextTitle = note?.title || '';
  const nextTags = Array.isArray(note?.tags) ? note.tags.join(', ') : '';
  const nextBodyHtml = note?.bodyHtml || '';

  if (!sameActiveNote || !titleFocused) titleEl.value = nextTitle;
  if (!sameActiveNote || !tagsFocused) tagsEl.value = nextTags;
  if (!sameActiveNote || !bodyFocused) bodyEl.innerHTML = nextBodyHtml;
  bodyEl.classList.toggle('empty', !note?.bodyHtml);
  if (previewEl) previewEl.hidden = !_notesState.previewMode;
  _notesSyncEditorHeaderTitle(titleEl.value || nextTitle);
  pinBtn.textContent = note?.isPinned ? 'Unpin' : 'Pin';
  archiveBtn.textContent = note?.isArchived ? 'Unarchive' : 'Archive';
  deleteBtn.disabled = !note?.id;
  titleEl.disabled = !note?.id;
  tagsEl.disabled = !note?.id;
  bodyEl.contentEditable = note?.id ? 'true' : 'false';
  bodyEl.dataset.placeholder = note?.id ? 'Write something useful...' : 'Select a note to begin.';
  if (backBtn) backBtn.disabled = !note?.id;
  document.getElementById('notes-checklist-btn')?.toggleAttribute('disabled', !note?.id);
  document.getElementById('notes-add-checklist-btn')?.toggleAttribute('disabled', !note?.id);
  document.getElementById('notes-add-checklist-inline-btn')?.toggleAttribute('disabled', !note?.id);
  document.getElementById('notes-checklist-input')?.toggleAttribute('disabled', !note?.id);
  document.getElementById('notes-photo-btn')?.toggleAttribute('disabled', !note?.id);
  document.getElementById('notes-link-press-btn')?.toggleAttribute('disabled', !note?.id || !_notesOpenPressContext());
  document.getElementById('notes-link-issue-btn')?.toggleAttribute('disabled', !note?.id || !_notesOpenIssueContext());
  _notesRenderTagChips(note);
  _notesRenderTagSuggestions(note);
  _notesRenderContextChips(note);
  _notesRenderContextSummary(note);
  _notesRenderChecklist(note);
  _notesRenderAttachments();
  _notesRenderBodyPreview(note);
  _notesSetPreviewMode(_notesState.previewMode && !!note?.id);
  _notesSyncLayout();
}

function _notesFocusBody() {
  const bodyEl = document.getElementById('notes-body');
  if (!bodyEl) return;
  const sel = window.getSelection();
  const hasBodySelection = Boolean(sel && sel.rangeCount > 0 && bodyEl.contains(sel.anchorNode));
  bodyEl.focus();
  if (hasBodySelection) return;
  const range = document.createRange();
  range.selectNodeContents(bodyEl);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function _notesFocusTitle() {
  const titleEl = document.getElementById('notes-title');
  if (!titleEl) return;
  titleEl.focus();
  titleEl.select?.();
}

function _notesDetectFormats() {
  const sel = window.getSelection();
  const fmts = { bold: false, italic: false, underline: false, bullet: false };
  if (!sel || !sel.rangeCount) return fmts;
  function walk(node) {
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      const t = node.tagName;
      if (t === 'B' || t === 'STRONG') fmts.bold = true;
      if (t === 'I' || t === 'EM') fmts.italic = true;
      if (t === 'U') fmts.underline = true;
      if (t === 'UL' || t === 'OL') fmts.bullet = true;
      if (t === 'BODY') break;
      node = node.parentElement;
    }
  }
  for (let i = 0; i < sel.rangeCount; i++) {
    const r = sel.getRangeAt(i);
    if (r.collapsed) { walk(r.startContainer); }
    else { walk(r.startContainer); walk(r.endContainer); }
  }
  return fmts;
}

function _notesIsInTag(tagName) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const tag = tagName.toUpperCase();
  for (let i = 0; i < sel.rangeCount; i++) {
    const r = sel.getRangeAt(i);
    const check = node => {
      while (node && node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === tag) return true;
        if (node.tagName === 'BODY') break;
        node = node.parentElement;
      }
      return false;
    };
    if (r.collapsed) { if (check(r.startContainer)) return true; }
    else { if (check(r.startContainer) || check(r.endContainer)) return true; }
  }
  return false;
}

function _notesWrapFormat(tagName) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const frag = range.extractContents();
  const wrapper = document.createElement(tagName);
  wrapper.appendChild(frag);
  range.insertNode(wrapper);
  sel.removeAllRanges();
  const nr = document.createRange();
  nr.selectNodeContents(wrapper);
  sel.addRange(nr);
}

function _notesUnwrapFormat(tagName) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const bodyEl = document.getElementById('notes-body');
  if (!bodyEl) return;
  const frag = range.extractContents();
  function stripTag(node, tag) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return node;
    if (node.tagName === tag) {
      const df = document.createDocumentFragment();
      Array.from(node.childNodes).forEach(c => df.appendChild(stripTag(c, tag)));
      return df;
    }
    const clone = node.cloneNode(false);
    Array.from(node.childNodes).forEach(c => clone.appendChild(stripTag(c, tag)));
    return clone;
  }
  const cleaned = stripTag(frag, tagName.toUpperCase());
  range.insertNode(cleaned);
  _notesCleanupEmptyTags(bodyEl);
  sel.removeAllRanges();
  bodyEl.focus();
}

function _notesCleanupEmptyTags(root) {
  if (!root) return;
  root.querySelectorAll('b, i, u, strong, em').forEach(el => {
    if (!el.textContent.trim() && !el.children.length) {
      el.parentNode?.removeChild(el);
    }
  });
}

function _notesApplyInlineFormat(tagName) {
  const bodyEl = document.getElementById('notes-body');
  const sel = window.getSelection();
  if (!bodyEl || !sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!bodyEl.contains(range.commonAncestorContainer)) return;
  if (range.collapsed) {
    const cmdMap = { B: 'bold', I: 'italic', U: 'underline' };
    try { document.execCommand('styleWithCSS', false, false); } catch (_) { }
    document.execCommand(cmdMap[tagName] || 'bold', false, null);
    return;
  }
  if (_notesIsInTag(tagName)) {
    _notesUnwrapFormat(tagName);
  } else {
    _notesWrapFormat(tagName);
  }
}

function _notesToolbarCommand(command) {
  const bodyEl = document.getElementById('notes-body');
  if (!bodyEl) return;
  bodyEl.focus();
  const inlineTags = { bold: 'B', italic: 'I', underline: 'U' };
  const tag = inlineTags[command];
  if (tag) {
    _notesApplyInlineFormat(tag);
  } else {
    try { document.execCommand('styleWithCSS', false, false); } catch (_) { }
    document.execCommand(command, false, null);
  }
  _notesSyncFormatButtons();
  _notesState.dirty = true;
  _notesQueueAutosave();
}

function _notesSyncFormatButtons() {
  const boldBtn = document.getElementById('notes-bold-btn');
  const italicBtn = document.getElementById('notes-italic-btn');
  const underlineBtn = document.getElementById('notes-underline-btn');
  const bulletBtn = document.getElementById('notes-bullet-btn');
  if (!boldBtn || !italicBtn) return;
  const bodyEl = document.getElementById('notes-body');
  const sel = window.getSelection();
  const inBody = Boolean(sel && sel.rangeCount > 0 && bodyEl && bodyEl.contains(sel.anchorNode));
  if (!inBody) {
    [boldBtn, italicBtn, underlineBtn, bulletBtn].forEach(b => {
      if (!b) return;
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    return;
  }
  const fmts = _notesDetectFormats();
  const sync = (btn, val) => {
    if (!btn) return;
    btn.classList.toggle('active', val);
    btn.setAttribute('aria-pressed', String(val));
  };
  sync(boldBtn, fmts.bold);
  sync(italicBtn, fmts.italic);
  sync(underlineBtn, fmts.underline);
  sync(bulletBtn, fmts.bullet);
}

async function _notesLoadAttachments(noteId) {
  _notesAttachmentsCache = [];
  const noteAttachmentsEl = document.getElementById('notes-attachments');
  if (!noteId || !noteAttachmentsEl) {
    _notesRenderAttachments();
    return [];
  }
  if (shouldUseSqlStagingReads(getCurrentPlantId())) {
    const payload = await requireSqlRead(
      `note attachments ${noteId}`,
      () => dataApi.listNoteAttachments(getCurrentPlantId(), noteId),
      `Note attachments are missing in D1 for note ${noteId}.`
    );
    _notesAttachmentsCache = Array.isArray(payload?.attachments) ? payload.attachments.map(att => ({
      ...att,
      id: att.id || att.attachmentId || ''
    })) : [];
    _notesRenderAttachments();
    return _notesAttachmentsCache;
  }
  const snap = await getDocs(query(noteAttachmentsCol(noteId), orderBy('uploadedAt', 'desc')));
  _notesAttachmentsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  _notesRenderAttachments();
  return _notesAttachmentsCache;
}

async function _notesDeleteAttachment(attachmentId) {
  if (!_notesState.currentNote?.id || !attachmentId) return;
  const noteId = _notesState.currentNote.id;
  const att = _notesAttachmentsCache.find(item => item.id === attachmentId);
  if (!att) return;
  if (!confirm('Remove this attachment?')) return;
  try {
    await deleteStoredAttachmentBlob(getCurrentPlantId(), att);
    if (shouldUseSqlStagingReads(getCurrentPlantId())) {
      await dataApi.deleteNoteAttachment(getCurrentPlantId(), noteId, attachmentId);
    } else {
      await deleteDoc(doc(noteAttachmentsCol(noteId), attachmentId));
    }
    _notesAttachmentsCache = _notesAttachmentsCache.filter(item => item.id !== attachmentId);
    if (_notesState.currentNote) _notesState.currentNote.photoCount = _notesAttachmentsCache.length;
    _notesRenderAttachments();
    await _notesSaveActiveNote({ immediate: true });
  } catch (e) {
    console.warn('delete note attachment failed', e);
    showGameToast(`Could not remove attachment: ${e?.message || 'error'}`);
  }
}

function _notesQueueAutosave() {
  if (!_notesState.currentNote?.id) return;
  _notesState.dirty = true;
  _notesState.saving = true;
  _notesSetStatus('Saving…', '');
  if (_notesSaveTimer) clearTimeout(_notesSaveTimer);
  _notesSaveTimer = setTimeout(() => {
    void _notesSaveActiveNote({ immediate: false });
  }, 650);
}

function _notesBuildPayload(note, { persistCreatedAt = false } = {}) {
  const titleEl = document.getElementById('notes-title');
  const tagsEl = document.getElementById('notes-tags');
  const bodyEl = document.getElementById('notes-body');
  const title = String(titleEl?.value || note?.title || '').trim() || 'Untitled Note';
  const bodyHtml = sanitizeNoteHtml(String(bodyEl?.innerHTML || note?.bodyHtml || ''));
  const bodyText = _noteTextFromHtml(bodyHtml);
  const tags = _notesSplitTags(tagsEl?.value || '');
  const checklistItems = normalizeChecklistItems(note?.checklistItems || []);
  const actor = currentActor();
  const searchText = [
    title,
    bodyText,
    tags.join(' '),
    checklistItems.map(item => item.text).join(' '),
    note?.pressId || '',
    note?.machineCode || '',
    note?.issueId || ''
  ].join(' ').toLowerCase();
  const useSql = shouldUseSqlStagingReads(getCurrentPlantId());
  return {
    id: note?.id || '',
    noteId: note?.id || '',
    title,
    bodyHtml,
    bodyText,
    tags,
    checklistItems,
    pressId: note?.pressId || '',
    machineCode: note?.machineCode || '',
    issueId: note?.issueId || '',
    isPinned: Boolean(note?.isPinned),
    isArchived: Boolean(note?.isArchived),
    photoCount: Number(note?.photoCount || 0),
    searchText,
    updatedAt: useSql ? new Date().toISOString() : serverTimestamp(),
    updatedBy: actor,
    schemaVersion: 1,
    ...(persistCreatedAt ? {
      createdAt: note?.createdAt || (useSql ? new Date().toISOString() : serverTimestamp()),
      createdBy: note?.createdBy || actor
    } : {})
  };
}

async function _notesSaveActiveNote({ immediate = false } = {}) {
  if (!_notesState.currentNote?.id || !getCurrentPlantId()) return;
  const note = _notesState.currentNote;
  const payload = _notesBuildPayload(note, { persistCreatedAt: !note.createdAt });
  try {
    if (_notesSaveTimer) {
      clearTimeout(_notesSaveTimer);
      _notesSaveTimer = null;
    }
    if (immediate) _notesSetStatus('Saving…', '');
    if (shouldUseSqlStagingReads(getCurrentPlantId())) {
      const response = await dataApi.updateNote(getCurrentPlantId(), note.id, payload);
      if (response?.note) {
        _notesState.currentNote = _notesNormalizeDoc(response.note);
        _notesState.notes = (_notesState.notes || [])
          .filter(item => item.id !== note.id)
          .concat(_notesState.currentNote)
          .sort(_notesCompare);
      }
    } else {
      await setDoc(noteDoc(note.id), payload, { merge: true });
    }
    _notesState.dirty = false;
    _notesState.saving = false;
    _notesState.lastSavedAt = new Date();
    _notesSetStatus('Saved', `Updated ${_notesDisplayTime(_notesState.lastSavedAt)}`);
    _notesRenderList();
  } catch (e) {
    _notesState.saving = false;
    _notesSetStatus('Could not save note', e?.message || '');
    console.warn('note save failed', e);
  }
}

async function _notesSetContextLink(kind) {
  if (!_notesState.currentNote?.id) return;
  if (kind === 'press') {
    const context = _notesOpenPressContext();
    if (!context) return;
    _notesState.currentNote.pressId = context.pressId || '';
    _notesState.currentNote.machineCode = context.machineCode || '';
  } else if (kind === 'issue') {
    const context = _notesOpenIssueContext();
    if (!context) return;
    _notesState.currentNote.issueId = context.issueId || '';
    _notesState.currentNote.pressId = context.pressId || _notesState.currentNote.pressId || '';
    _notesState.currentNote.machineCode = context.machineCode || _notesState.currentNote.machineCode || '';
  }
  _notesState.dirty = true;
  await _notesSaveActiveNote({ immediate: true });
  _notesRenderEditor(_notesState.currentNote);
}

async function _notesTogglePin() {
  if (!_notesState.currentNote?.id) return;
  _notesState.currentNote.isPinned = !_notesState.currentNote.isPinned;
  await _notesSaveActiveNote({ immediate: true });
  _notesRenderEditor(_notesState.currentNote);
}

async function _notesToggleArchive() {
  if (!_notesState.currentNote?.id) return;
  _notesState.currentNote.isArchived = !_notesState.currentNote.isArchived;
  await _notesSaveActiveNote({ immediate: true });
  _notesRenderEditor(_notesState.currentNote);
}

async function _notesCreateNewNote(templateKey = 'blank') {
  if (!getCurrentPlantId() || !_notesState.notes) return;
  const noteId = shouldUseSqlStagingReads(getCurrentPlantId()) ? _notesCreateClientId('note') : doc(notesCol()).id;
  const pressId = _notesContext.pressId || '';
  const issueId = _notesContext.issueId || '';
  const issue = issueId ? getIssues().find(i => i.id === issueId) : null;
  const machineCode = issue?.machine || _notesContext.label?.replace(/^Press\s+/i, '') || '';
  const template = _notesTemplateData(templateKey);
  const contextLabel = _notesContext.issueId
    ? `Issue ${machineCode || issueId}`
    : (_notesContext.pressId ? `Press ${machineCode || pressId}` : '');
  const title = contextLabel
    ? (template.title ? `${template.title} · ${contextLabel}` : contextLabel)
    : (template.title || 'New Note');
  const tags = Array.from(new Set([
    ...(template.tags || []),
    ...(pressId ? ['press'] : []),
    ...(issueId ? ['issue'] : [])
  ]));
  const draft = {
    id: noteId,
    title,
    bodyHtml: template.bodyHtml || '',
    bodyText: _noteTextFromHtml(template.bodyHtml || ''),
    checklistItems: normalizeChecklistItems(template.checklistItems || []),
    tags,
    pressId,
    machineCode,
    issueId,
    isPinned: false,
    isArchived: false,
    photoCount: 0,
    searchText: title.toLowerCase(),
    createdAt: shouldUseSqlStagingReads(getCurrentPlantId()) ? new Date().toISOString() : serverTimestamp(),
    createdBy: currentActor(),
    updatedAt: shouldUseSqlStagingReads(getCurrentPlantId()) ? new Date().toISOString() : serverTimestamp(),
    updatedBy: currentActor(),
    schemaVersion: 1
  };
  _notesState.creating = true;
  _notesState.activeNoteId = noteId;
  _notesSetView('editor');
  _notesRenderEditor(_notesNormalizeDoc(draft));
  queueMicrotask(_notesFocusTitle);
  if (shouldUseSqlStagingReads(getCurrentPlantId())) {
    const response = await dataApi.createNote(getCurrentPlantId(), draft);
    const saved = _notesNormalizeDoc(response?.note || draft);
    _notesState.notes = (_notesState.notes || []).filter(note => note.id !== saved.id).concat(saved).sort(_notesCompare);
    _notesState.currentNote = saved;
  } else {
    await setDoc(noteDoc(noteId), draft);
  }
  await _notesLoadAttachments(noteId);
  _notesState.creating = false;
  _notesRenderList();
  _notesSetStatus('Saved', 'New note created');
}

async function _deleteDocsInBatches(colRef) {
  while (true) {
    const snap = await getDocs(query(colRef, limit(400)));
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 400) return;
  }
}

async function _notesDeleteActiveNote() {
  if (!_notesState.currentNote?.id) return;
  const note = _notesState.currentNote;
  const ok = confirm(`Delete "${note.title || 'Untitled Note'}"? This will remove the note and its attachments.`);
  if (!ok) return;
  try {
    const attachments = shouldUseSqlStagingReads(getCurrentPlantId())
      ? (_notesAttachmentsCache || [])
      : (await getDocs(noteAttachmentsCol(note.id))).docs.map(d => d.data() || {});
    await Promise.allSettled(attachments.map(async att => {
      await deleteStoredAttachmentBlob(getCurrentPlantId(), att);
    }));
    if (shouldUseSqlStagingReads(getCurrentPlantId())) {
      await dataApi.deleteNote(getCurrentPlantId(), note.id);
      _notesState.notes = (_notesState.notes || []).filter(item => item.id !== note.id);
    } else {
      await _deleteDocsInBatches(noteAttachmentsCol(note.id));
      await deleteDoc(noteDoc(note.id));
    }
    _notesState.activeNoteId = null;
    _notesRenderEditor(null);
    _notesRenderList();
  } catch (e) {
    console.warn('delete note failed', e);
    showGameToast(`Could not delete note: ${e?.message || 'error'}`);
  }
}

async function _notesUploadAttachments(files) {
  const noteId = _notesState.currentNote?.id;
  if (!noteId || !files || !files.length) return;
  const uploaded = [];
  try {
    for (const file of files) {
      if (!file?.type?.startsWith('image/')) continue;
      const attId = `att_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const ext = String(file.name || '').split('.').pop() || 'jpg';
      const dataUrl = await readFileAsDataUrl(file);
      let uploadedBlob = await uploadAttachmentToPreferredStorage(getCurrentPlantId(), {
        scope: 'note',
        noteId,
        fileName: file.name || `attachment_${uploaded.length + 1}.${ext}`,
        contentType: file.type || 'image/jpeg',
        dataUrl
      });
      if (!uploadedBlob?.storagePath) {
        throw new Error('R2 upload returned no storage path.');
      }
      const attDoc = {
        id: attId,
        attachmentId: attId,
        storagePath: uploadedBlob.storagePath,
        storageBucket: uploadedBlob.storageBucket || '',
        url: uploadedBlob.downloadUrl || uploadedBlob.url || '',
        fileName: uploadedBlob.fileName || file.name || `attachment_${uploaded.length + 1}.${ext}`,
        contentType: uploadedBlob.contentType || file.type || 'image/jpeg',
        sizeBytes: Number(uploadedBlob.sizeBytes || file.size || 0),
        uploadedBy: currentActor(),
        uploadedAt: uploadedBlob.uploadedAt || (shouldUseSqlStagingReads(getCurrentPlantId()) ? new Date().toISOString() : serverTimestamp()),
        schemaVersion: 1
      };
      if (shouldUseSqlStagingReads(getCurrentPlantId())) {
        const response = await dataApi.createNoteAttachment(getCurrentPlantId(), noteId, attDoc);
        uploaded.push(response?.attachment ? {
          ...response.attachment,
          id: response.attachment.id || response.attachment.attachmentId || attId
        } : attDoc);
      } else {
        await setDoc(doc(noteAttachmentsCol(noteId), attId), attDoc);
        uploaded.push(attDoc);
      }
    }
    _notesAttachmentsCache = [..._notesAttachmentsCache, ...uploaded];
    if (_notesState.currentNote) _notesState.currentNote.photoCount = _notesAttachmentsCache.length;
    _notesRenderAttachments();
    const current = _notesState.currentNote;
    if (current) current.photoCount = _notesAttachmentsCache.length;
    await _notesSaveActiveNote({ immediate: true });
  } catch (e) {
    console.warn('note attachment upload failed', e);
    showGameToast(`Could not attach photo: ${e?.message || 'error'}`);
  }
}

function _notesSyncFilterButtons() {
  document.querySelectorAll('[data-notes-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-notes-filter') === _notesState.filter);
  });
}

async function _notesSelectNote(noteId) {
  if (!noteId) {
    _notesState.activeNoteId = null;
    _notesRenderEditor(null);
    _notesRenderList();
    return;
  }
  if (_notesState.currentNote?.id && _notesState.dirty) {
    await _notesSaveActiveNote({ immediate: true });
  }
  const note = _notesState.notes.find(n => n.id === noteId) || null;
  if (!note) return;
  _notesState.activeNoteId = noteId;
  _notesSetView('editor');
  _notesState.currentNote = { ...note, checklistItems: normalizeChecklistItems(note.checklistItems) };
  _notesAttachmentsCache = [];
  _notesRenderEditor(_notesState.currentNote);
  await _notesLoadAttachments(noteId);
  _notesRenderList();
  const editorPanel = document.querySelector('.notes-editor-panel');
  if (editorPanel && window.innerWidth <= 860) {
    editorPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function _notesEnsureActiveSelection() {
  const visible = _notesVisibleNotes();
  if (_notesState.activeNoteId && visible.some(note => note.id === _notesState.activeNoteId)) return;
  if (_notesIsMobileLayout()) {
    _notesState.activeNoteId = null;
    _notesRenderEditor(null);
    _notesSyncLayout();
    return;
  }
  const firstVisible = visible[0] || null;
  if (firstVisible) {
    void _notesSelectNote(firstVisible.id);
    return;
  }
  _notesState.activeNoteId = null;
  _notesRenderEditor(null);
}

function _notesSetVisible(isVisible) {
  const modal = document.getElementById('notes-modal');
  if (!modal) return;
  modal.classList.toggle('visible', !!isVisible);
  document.body.classList.toggle('notes-open', !!isVisible);
  if (!isVisible) {
    _notesCloseMenus();
    _notesSetDropActive(false);
    _notesDragDepth = 0;
  }
  if (isVisible) _notesSyncLayout();
}

function _notesResetState() {
  if (_notesSaveTimer) clearTimeout(_notesSaveTimer);
  _notesSaveTimer = null;
  if (_notesSearchTimer) { clearTimeout(_notesSearchTimer); _notesSearchTimer = null; }
  _notesAttachmentsCache = [];
  _notesState.notes = [];
  _notesState.activeNoteId = null;
  _notesState.view = 'list';
  _notesState.search = '';
  _notesState.filter = 'all';
  _notesState.saving = false;
  _notesState.dirty = false;
  _notesState.currentNote = null;
  _notesState.creating = false;
  _notesState.previewMode = false;
  _notesState.error = '';
  _notesCloseMenus();
  _notesSetDropActive(false);
  _notesDragDepth = 0;
  _notesSyncLayout();
}

async function _notesStartListener() {
  if (_notesUnsubscribe) {
    _notesUnsubscribe();
    _notesUnsubscribe = null;
  }
  if (_notesPollTimer) {
    clearTimeout(_notesPollTimer);
    _notesPollTimer = null;
  }
  if (!getCurrentPlantId() || !getCurrentUser()?.uid) {
    _notesRenderList();
    _notesRenderEditor(null);
    return;
  }
  if (shouldUseSqlStagingReads(getCurrentPlantId())) {
    const token = ++_notesLoadToken;
    let active = true;
    _notesUnsubscribe = () => {
      active = false;
      if (_notesPollTimer) {
        clearTimeout(_notesPollTimer);
        _notesPollTimer = null;
      }
      _notesUnsubscribe = null;
    };
    const poll = async () => {
      if (!active || token !== _notesLoadToken || !getCurrentPlantId()) return;
      try {
        const payload = await requireSqlRead(
          `notes ${getCurrentPlantId()}`,
          () => dataApi.listNotes(getCurrentPlantId(), { includeArchived: true }),
          `Notes are missing in D1 for plant ${getCurrentPlantId()}.`
        );
        _notesState.error = '';
        _notesState.notes = (payload.notes || []).map(note => _notesNormalizeDoc(note)).sort(_notesCompare);
        _notesRenderList();
        _notesSyncFilterButtons();
        if (_notesState.activeNoteId) {
          const activeNote = _notesState.notes.find(note => note.id === _notesState.activeNoteId) || null;
          if (activeNote && !_notesState.dirty) {
            _notesRenderEditor(activeNote);
          } else if (!activeNote) {
            _notesState.activeNoteId = null;
            _notesRenderEditor(null);
          }
        }
        _notesEnsureActiveSelection();
      } catch (err) {
        console.warn('notes SQL poll error', err);
        _notesState.error = String(err?.message || '');
        _notesRenderList();
        _notesSetStatus('Could not load notes', err?.message || '');
      }
      if (active) _notesPollTimer = setTimeout(poll, 5000);
    };
    await poll();
    return;
  }
  const token = ++_notesLoadToken;
  const q = query(notesCol());
  _notesUnsubscribe = onSnapshot(q, snap => {
    if (token !== _notesLoadToken) return;
    _notesState.error = '';
    _notesState.notes = snap.docs.map(d => _notesNormalizeDoc({ id: d.id, ...d.data() }));
    _notesState.notes.sort(_notesCompare);
    _notesRenderList();
    _notesSyncFilterButtons();
    if (_notesState.activeNoteId) {
      const active = _notesState.notes.find(note => note.id === _notesState.activeNoteId) || null;
      if (active && !_notesState.dirty) {
        _notesRenderEditor(active);
      } else if (!active) {
        _notesState.activeNoteId = null;
        _notesRenderEditor(null);
      }
    }
    _notesEnsureActiveSelection();
  }, err => {
    console.warn('notes listener error', err);
    _notesState.error = String(err?.message || '');
    _notesRenderList();
    _notesSetStatus('Could not load notes', err?.message || '');
  });
}

window.closeNotesModal = async (options = {}) => {
  if (_notesUnsubscribe) {
    _notesUnsubscribe();
    _notesUnsubscribe = null;
  }
  if (options.preserveState) {
    if (_notesState.currentNote?.id && _notesState.dirty) {
      await _notesSaveActiveNote({ immediate: true });
    }
    _notesSetVisible(false);
    return;
  }
  _notesResetState();
  _notesSetVisible(false);
};

window.openNotesModal = async function (context = {}, options = {}) {
  if (!getCurrentPlantId()) return;
  _bindToolModalShellNavigation();
  const preserveState = !!options.preserveState;
  closeUserMenus();
  closeSortDropdown();
  window.closeExportDropdown?.();
  window.closeMessagingModal?.();
  window.closePressWikiModal?.();
  if (_notesUnsubscribe) {
    _notesUnsubscribe();
    _notesUnsubscribe = null;
  }
  if (!preserveState) {
    const pressId = String(context.pressId || '').trim();
    const issueId = String(context.issueId || '').trim();
    const issue = issueId ? getIssues().find(i => i.id === issueId) : null;
    const machineCode = String(context.machineCode || issue?.machine || '').trim();
    const linkedPressId = pressId || (issue?.pressId ? String(issue.pressId).trim() : '') || (machineCode ? toPressId(machineCode) : '');
    const label = String(context.label || '').trim() || (issueId
      ? `Issue · ${machineCode || issueId}`
      : (linkedPressId ? `Press · ${machineCode || linkedPressId}` : 'Plant-wide'));
    _notesContext = { pressId: linkedPressId, issueId, machineCode, label };
    _notesState.filter = context.filter || (linkedPressId || issueId ? 'linked' : 'all');
    _notesState.search = '';
    _notesState.activeNoteId = null;
    _notesState.view = 'list';
    _notesState.currentNote = null;
    _notesState.error = '';
    _notesState.previewMode = false;
    _notesAttachmentsCache = [];
  }
  _notesCloseMenus();
  _notesSetDropActive(false);
  _notesDragDepth = 0;
  _notesSetVisible(true);
  completeDemoGuideStep('tools');
  _notesSyncLayout();
  if (!preserveState) {
    _notesSetStatus('Loading notes…', _notesContextTitle(_notesContext));
    const contextEl = document.getElementById('notes-modal-context');
    if (contextEl) contextEl.textContent = _notesContextTitle(_notesContext);
    const subtitleEl = document.getElementById('notes-modal-subtitle');
    if (subtitleEl) subtitleEl.textContent = _notesContext.pressId || _notesContext.issueId
      ? 'Linked notes stay separate from the wiki, but open straight from the floor.'
      : 'Quick capture, mobile first, Apple Notes inspired.';
  }
  _notesSyncFilterButtons();
  await _notesStartListener();
  _notesRenderList();
  if (_notesState.currentNote?.id) {
    _notesRenderEditor(_notesState.currentNote);
  } else {
    _notesRenderEditor(null);
  }
  if (!_notesState.notes.length) {
    _notesSetStatus('No notes yet', 'Tap New Note to create one.');
  }
};

window.openNotesModalFromPress = function (pressOrMachineCode) {
  const machineCode = typeof pressOrMachineCode === 'string'
    ? pressOrMachineCode
    : String(pressOrMachineCode?.machine || pressOrMachineCode?.machineCode || pressOrMachineCode?.pressId || '').trim();
  const pressId = toPressId(machineCode || '');
  return window.openNotesModal?.({
    pressId,
    machineCode,
    label: machineCode ? `Press · ${machineCode}` : 'Press notes'
  });
};

window.openNotesModalFromIssue = function (issueOrId) {
  const issueId = typeof issueOrId === 'string' ? issueOrId : String(issueOrId?.id || '').trim();
  const issue = getIssues().find(i => i.id === issueId) || (typeof issueOrId === 'object' ? issueOrId : null);
  const pressId = issue?.pressId || toPressId(issue?.machine || '');
  return window.openNotesModal?.({
    issueId,
    pressId,
    machineCode: String(issue?.machine || '').trim(),
    label: issue ? `Issue · ${issue.machine || issue.id}` : 'Issue notes'
  });
};

document.getElementById('notes-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('notes-modal')) closeNotesModal();
});
let _notesSearchTimer = null;
document.getElementById('notes-search')?.addEventListener('input', e => {
  _notesState.search = String(e.target.value || '');
  if (_notesSearchTimer) clearTimeout(_notesSearchTimer);
  _notesSearchTimer = setTimeout(() => {
    _notesSearchTimer = null;
    _notesRenderList();
  }, 150);
});
document.getElementById('notes-title')?.addEventListener('input', () => {
  if (_notesState.currentNote) {
    const title = document.getElementById('notes-title')?.value || '';
    _notesState.currentNote.title = title;
    _notesSyncEditorHeaderTitle(title);
    _notesQueueAutosave();
    _notesRenderList();
  }
});
document.getElementById('notes-title')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    _notesFocusBody();
  }
});
document.getElementById('notes-tags')?.addEventListener('input', () => {
  if (_notesState.currentNote) {
    _notesState.currentNote.tags = _notesSplitTags(document.getElementById('notes-tags')?.value || '');
    _notesRenderTagChips(_notesState.currentNote);
    _notesRenderTagSuggestions(_notesState.currentNote);
    _notesQueueAutosave();
    _notesRenderList();
  }
});
document.getElementById('notes-body')?.addEventListener('input', () => {
  if (_notesState.currentNote) {
    _notesState.currentNote.bodyHtml = sanitizeNoteHtml(document.getElementById('notes-body')?.innerHTML || '');
    _notesState.currentNote.bodyText = _noteTextFromHtml(_notesState.currentNote.bodyHtml);
    const tagMatches = Array.from(new Set(
      (String(_notesState.currentNote.bodyText || '').match(/#[a-z0-9][a-z0-9_-]*/gi) || [])
        .map(tag => tag.slice(1))
    ));
    if (tagMatches.length) {
      const tagsEl = document.getElementById('notes-tags');
      const merged = Array.from(new Set([...(_notesState.currentNote.tags || []), ...tagMatches]));
      _notesState.currentNote.tags = merged;
      if (tagsEl) tagsEl.value = merged.map(tag => `#${tag}`).join(', ');
      _notesRenderTagChips(_notesState.currentNote);
      _notesRenderTagSuggestions(_notesState.currentNote);
    }
    _notesSyncFormatButtons();
    _notesRenderBodyPreview(_notesState.currentNote);
    _notesQueueAutosave();
    _notesRenderList();
  }
});
document.getElementById('notes-body')?.addEventListener('blur', () => {
  if (_notesState.currentNote) {
    _notesState.currentNote.bodyHtml = sanitizeNoteHtml(document.getElementById('notes-body')?.innerHTML || '');
    _notesState.currentNote.bodyText = _noteTextFromHtml(_notesState.currentNote.bodyHtml);
    _notesQueueAutosave();
  }
});
document.getElementById('notes-body')?.addEventListener('keydown', e => {
  const cmd = e.metaKey || e.ctrlKey;
  if (!cmd) return;
  const key = String(e.key || '').toLowerCase();
  if (key === 'b') {
    e.preventDefault();
    _notesToolbarCommand('bold');
  } else if (key === 'i') {
    e.preventDefault();
    _notesToolbarCommand('italic');
  } else if (key === 'u') {
    e.preventDefault();
    _notesToolbarCommand('underline');
  } else if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('notes-checklist-input')?.focus();
  }
});
document.getElementById('notes-create-btn')?.addEventListener('click', () => {
  void _notesCreateNewNote();
});
document.getElementById('notes-new-btn')?.addEventListener('click', e => {
  e.preventDefault();
  void _notesCreateNewNote();
});
document.getElementById('notes-actions-menu-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  const menu = document.getElementById('notes-actions-menu');
  const isOpen = menu?.classList.contains('visible');
  _notesCloseMenus(isOpen ? null : 'notes-actions-menu');
  _notesSetMenuOpen('notes-actions-menu', !isOpen);
});
document.getElementById('notes-actions-menu')?.querySelectorAll('[data-note-template]')?.forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    _notesCloseMenus();
    const templateKey = btn.getAttribute('data-note-template') || 'blank';
    if (templateKey === 'blank' && _notesState.currentNote?.id) return;
    if (_notesState.currentNote?.id) {
      _notesApplyTemplate(templateKey);
    } else {
      void _notesCreateNewNote(templateKey);
    }
  });
});
document.getElementById('notes-actions-menu')?.querySelectorAll('button[role="menuitem"]')?.forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    _notesCloseMenus();
    if (btn.id === 'notes-actions-pin-btn') void _notesTogglePin();
    if (btn.id === 'notes-actions-archive-btn') void _notesToggleArchive();
    if (btn.id === 'notes-actions-delete-btn') void _notesDeleteActiveNote();
  });
});
document.getElementById('notes-back-btn')?.addEventListener('click', () => {
  _notesSetView('list');
  _notesRenderEditor(null);
  _notesRenderList();
});
document.getElementById('notes-pin-btn')?.addEventListener('click', () => {
  void _notesTogglePin();
});
document.getElementById('notes-archive-btn')?.addEventListener('click', () => {
  void _notesToggleArchive();
});
document.getElementById('notes-delete-btn')?.addEventListener('click', () => {
  void _notesDeleteActiveNote();
});
document.getElementById('notes-photo-btn')?.addEventListener('click', () => {
  document.getElementById('notes-photo-input')?.click();
});
document.getElementById('notes-photo-input')?.addEventListener('change', async e => {
  await _notesUploadAttachments(e.target.files);
  e.target.value = '';
});
document.getElementById('notes-bold-btn')?.addEventListener('click', () => _notesToolbarCommand('bold'));
document.getElementById('notes-italic-btn')?.addEventListener('click', () => _notesToolbarCommand('italic'));
document.getElementById('notes-underline-btn')?.addEventListener('click', () => _notesToolbarCommand('underline'));
document.getElementById('notes-bullet-btn')?.addEventListener('click', () => _notesToolbarCommand('insertUnorderedList'));
document.getElementById('notes-checklist-btn')?.addEventListener('click', () => {
  if (!_notesState.currentNote) return;
  const note = _notesState.currentNote;
  note.checklistItems = normalizeChecklistItems(note.checklistItems);
  note.checklistItems.push({ id: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text: '', done: false });
  _notesRenderChecklist(note);
  _notesQueueAutosave();
});
document.getElementById('notes-add-checklist-btn')?.addEventListener('click', () => {
  document.getElementById('notes-checklist-input')?.focus();
});
document.getElementById('notes-add-checklist-inline-btn')?.addEventListener('click', () => {
  const inp = document.getElementById('notes-checklist-input');
  const text = String(inp?.value || '').trim();
  if (!_notesState.currentNote || !text) return;
  const note = _notesState.currentNote;
  note.checklistItems = normalizeChecklistItems(note.checklistItems);
  note.checklistItems.push({ id: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text, done: false });
  if (inp) inp.value = '';
  _notesRenderChecklist(note);
  _notesQueueAutosave();
});
document.getElementById('notes-checklist-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('notes-add-checklist-inline-btn')?.click();
  }
});
document.getElementById('notes-link-press-btn')?.addEventListener('click', () => {
  void _notesSetContextLink('press');
});
document.getElementById('notes-link-issue-btn')?.addEventListener('click', () => {
  void _notesSetContextLink('issue');
});
document.getElementById('notes-preview-btn')?.addEventListener('click', () => {
  if (!_notesState.currentNote?.id) return;
  _notesSetPreviewMode(!_notesState.previewMode);
  _notesRenderBodyPreview(_notesState.currentNote);
});
document.getElementById('notes-filter-all')?.addEventListener('click', () => {
  _notesState.filter = 'all';
  _notesSyncFilterButtons();
  _notesRenderList();
});
document.getElementById('notes-filter-pinned')?.addEventListener('click', () => {
  _notesState.filter = 'pinned';
  _notesSyncFilterButtons();
  _notesRenderList();
});
document.getElementById('notes-filter-linked')?.addEventListener('click', () => {
  _notesState.filter = 'linked';
  _notesSyncFilterButtons();
  _notesRenderList();
});
document.getElementById('notes-filter-archived')?.addEventListener('click', () => {
  _notesState.filter = 'archived';
  _notesSyncFilterButtons();
  _notesRenderList();
});
document.querySelectorAll('.notes-toolbar-btn').forEach(btn => {
  btn.addEventListener('mousedown', e => {
    e.preventDefault();
  });
});
document.addEventListener('click', e => {
  if (!document.getElementById('notes-modal')?.classList.contains('visible')) return;
  const actionsWrap = document.getElementById('notes-actions-menu-btn')?.parentElement;
  if (actionsWrap && !actionsWrap.contains(e.target)) _notesSetMenuOpen('notes-actions-menu', false);
});
document.addEventListener('keydown', e => {
  if (!document.getElementById('notes-modal')?.classList.contains('visible')) return;
  const cmd = e.metaKey || e.ctrlKey;
  const key = String(e.key || '').toLowerCase();
  if (e.key === 'Escape') {
    if (document.getElementById('notes-actions-menu')?.classList.contains('visible')) {
      _notesCloseMenus();
      return;
    }
    closeNotesModal();
    return;
  }
  if (cmd && key === 's') {
    e.preventDefault();
    void _notesSaveActiveNote({ immediate: true });
    return;
  }
  if (cmd && key === 'enter') {
    e.preventDefault();
    void _notesSaveActiveNote({ immediate: true });
  }
});
document.getElementById('notes-body')?.addEventListener('mouseup', _notesSyncFormatButtons);
document.getElementById('notes-body')?.addEventListener('keyup', _notesSyncFormatButtons);
let _notesSelChangeRaf = null;
document.addEventListener('selectionchange', () => {
  if (_notesState.view !== 'editor' || !document.getElementById('notes-modal')?.classList.contains('visible')) return;
  if (_notesSelChangeRaf) cancelAnimationFrame(_notesSelChangeRaf);
  _notesSelChangeRaf = requestAnimationFrame(_notesSyncFormatButtons);
});
let _notesBodyObserver = null;
function _notesInitBodyObserver() {
  const bodyEl = document.getElementById('notes-body');
  if (!bodyEl || _notesBodyObserver) return;
  _notesBodyObserver = new MutationObserver(() => {
    if (_notesState.view !== 'editor' || !document.getElementById('notes-modal')?.classList.contains('visible')) return;
    _notesSyncFormatButtons();
  });
  _notesBodyObserver.observe(bodyEl, { childList: true, subtree: true, characterData: true });
}
_notesInitBodyObserver();
let _notesDragDepth = 0;
function _notesSetDropActive(active) {
  const shell = document.querySelector('#notes-phone-frame');
  const hint = document.getElementById('notes-drop-hint');
  shell?.classList.toggle('drop-active', !!active);
  if (hint) hint.textContent = active ? 'Drop images to attach them here.' : 'Drag images here, or paste screenshots directly into the note.';
}
document.addEventListener('dragenter', e => {
  if (!document.getElementById('notes-modal')?.classList.contains('visible')) return;
  const hasFiles = Array.from(e.dataTransfer?.items || []).some(item => item.kind === 'file' && item.type.startsWith('image/'));
  if (!hasFiles) return;
  e.preventDefault();
  _notesDragDepth += 1;
  _notesSetDropActive(true);
});
document.addEventListener('dragover', e => {
  if (!document.getElementById('notes-modal')?.classList.contains('visible')) return;
  const hasFiles = Array.from(e.dataTransfer?.items || []).some(item => item.kind === 'file');
  if (!hasFiles) return;
  e.preventDefault();
  _notesSetDropActive(true);
});
document.addEventListener('dragleave', e => {
  if (!document.getElementById('notes-modal')?.classList.contains('visible')) return;
  const hasFiles = Array.from(e.dataTransfer?.items || []).some(item => item.kind === 'file');
  if (!hasFiles) return;
  _notesDragDepth = Math.max(0, _notesDragDepth - 1);
  if (_notesDragDepth === 0) _notesSetDropActive(false);
});
document.addEventListener('drop', async e => {
  if (!document.getElementById('notes-modal')?.classList.contains('visible')) return;
  const files = Array.from(e.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  _notesDragDepth = 0;
  _notesSetDropActive(false);
  await _notesUploadAttachments(files);
});
document.addEventListener('paste', e => {
  if (!document.getElementById('notes-modal')?.classList.contains('visible')) return;
  const files = Array.from(e.clipboardData?.items || [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter(Boolean);
  if (!files.length) return;
  e.preventDefault();
  void _notesUploadAttachments(files);
});
window.addEventListener('resize', () => {
  if (document.getElementById('notes-modal')?.classList.contains('visible')) {
    _notesSyncLayout();
    _notesEnsureActiveSelection();
  }
});


  return {
    open: openNotesModal,
    close: closeNotesModal,
    openFromPress: openNotesModalFromPress,
    openFromIssue: openNotesModalFromIssue,
    closeEditor: closeNotesEditorModal,
    hasState: () => Boolean(
      _notesState.notes.length || _notesState.currentNote?.id ||
      _notesState.activeNoteId || _notesState.view === 'editor' ||
      _notesState.search || _notesState.filter !== 'all' ||
      _notesState.previewMode
    ),
    context: _notesContext,
    state: _notesState
  };
}
