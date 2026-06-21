export function initTodosTool({
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  plantTodosCol,
  plantTodoDoc,
  userTodosCol,
  userTodoDoc,
  getCurrentUser,
  getCurrentPlantId,
  currentActor,
  localDateStr,
  esc,
  toPressId,
  getOpenMachine,
  getOpenIssue,
  completeDemoGuideStep
}) {
  let todoUnsubPersonal = null;
  let todoUnsubShared = null;
  const state = {
    personal: [],
    shared: [],
    todos: [],
    scope: 'all',
    filter: 'open',
    search: '',
    activeKey: null,
    current: null,
    listening: false,
    error: ''
  };

  function todoKey(todo) {
    return `${todo?.scope || 'personal'}:${todo?.id || ''}`;
  }

  function todoRef(scope, id) {
    return scope === 'shared' ? plantTodoDoc(id) : userTodoDoc(id);
  }

  function todoTimestampMs(value) {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value === 'number') return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }

  function todoDisplayDate(value) {
    if (!value) return '';
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function normalizeTodo(raw, scope) {
    return {
      id: raw?.id || '',
      scope,
      title: String(raw?.title || '').trim() || 'Untitled Todo',
      notes: String(raw?.notes || ''),
      listName: String(raw?.listName || 'Inbox').trim() || 'Inbox',
      dueDate: String(raw?.dueDate || ''),
      priority: ['none', 'low', 'medium', 'high'].includes(raw?.priority) ? raw.priority : 'none',
      isCompleted: Boolean(raw?.isCompleted),
      pressId: raw?.pressId || '',
      machineCode: raw?.machineCode || '',
      issueId: raw?.issueId || '',
      ownerUid: raw?.ownerUid || raw?.createdBy?.uid || '',
      ownerName: raw?.ownerName || raw?.createdBy?.name || '',
      createdAt: raw?.createdAt || null,
      updatedAt: raw?.updatedAt || null,
      completedAt: raw?.completedAt || null
    };
  }

  function combineAndSort() {
    state.todos = [
      ...state.personal.map(t => normalizeTodo(t, 'personal')),
      ...state.shared.map(t => normalizeTodo(t, 'shared'))
    ].sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
      const aDue = a.dueDate || '9999-12-31';
      const bDue = b.dueDate || '9999-12-31';
      if (aDue !== bDue) return aDue.localeCompare(bDue);
      const rank = { high: 0, medium: 1, low: 2, none: 3 };
      if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
      return todoTimestampMs(b.updatedAt) - todoTimestampMs(a.updatedAt);
    });
  }

  function visibleTodos() {
    const today = localDateStr(new Date());
    const q = String(state.search || '').trim().toLowerCase();
    return state.todos.filter(todo => {
      if (state.scope === 'mine' && todo.scope !== 'personal') return false;
      if (state.scope === 'shared' && todo.scope !== 'shared') return false;
      if (state.filter === 'open' && todo.isCompleted) return false;
      if (state.filter === 'done' && !todo.isCompleted) return false;
      if (state.filter === 'today' && (todo.isCompleted || todo.dueDate !== today)) return false;
      if (!q) return true;
      return [todo.title, todo.notes, todo.listName, todo.machineCode, todo.issueId].join(' ').toLowerCase().includes(q);
    });
  }

  function syncFilterButtons() {
    document.querySelectorAll('[data-todo-scope]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.todoScope === state.scope);
    });
    document.querySelectorAll('[data-todo-filter]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.todoFilter === state.filter);
    });
  }

  function setError(message, err = null) {
    state.error = message || '';
    if (err) console.warn(message, err);
    renderList();
  }

  function contextText(todo) {
    if (todo?.issueId) return `Issue ${todo.machineCode || todo.issueId}`;
    if (todo?.machineCode) return `Press ${todo.machineCode}`;
    return 'Standalone todo';
  }

  function renderList() {
    combineAndSort();
    syncFilterButtons();
    const list = document.getElementById('todos-list');
    if (!list) return;
    const visible = visibleTodos();
    if (state.error) {
      list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">!</div><div class="empty-state-text">${esc(state.error)}</div></div>`;
      return;
    }
    if (!visible.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">☑</div><div class="empty-state-text">No todos here.</div></div>';
      return;
    }
    list.innerHTML = visible.map(todo => {
      const key = todoKey(todo);
      const active = key === state.activeKey;
      const overdue = todo.dueDate && !todo.isCompleted && todo.dueDate < localDateStr(new Date());
      const badges = [
        `<span class="notes-list-badge ${todo.scope === 'shared' ? 'linked' : 'pinned'}">${todo.scope === 'shared' ? 'Shared' : 'Mine'}</span>`,
        todo.priority !== 'none' ? `<span class="notes-list-badge priority-${todo.priority}">${todo.priority}</span>` : '',
        todo.dueDate ? `<span class="notes-list-badge${overdue ? ' overdue' : ''}">${todoDisplayDate(todo.dueDate)}</span>` : '',
        todo.machineCode || todo.issueId ? `<span class="notes-list-badge linked">${esc(contextText(todo))}</span>` : ''
      ].filter(Boolean).join('');
      return `<div class="todo-item note-card${active ? ' active' : ''}${todo.isCompleted ? ' completed' : ''}" data-todo-key="${esc(key)}">
        <button class="todo-check" type="button" data-todo-toggle="${esc(key)}" aria-label="${todo.isCompleted ? 'Mark open' : 'Mark done'}">${todo.isCompleted ? '✓' : ''}</button>
        <div class="todo-item-main" data-todo-open="${esc(key)}">
          <div class="note-title"><span>${esc(todo.title)}</span></div>
          ${todo.notes ? `<div class="note-preview">${esc(todo.notes)}</div>` : ''}
          <div class="note-meta">
            <div class="tags">${badges}</div>
            <span class="timestamp">${esc(todo.listName)}</span>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  function setEditorVisible(visible) {
    const editor = document.getElementById('todo-editor');
    if (editor) editor.style.display = visible ? '' : 'none';
  }

  function renderEditor(todo) {
    state.current = todo ? { ...todo } : null;
    state.activeKey = todo ? todoKey(todo) : null;
    setEditorVisible(Boolean(todo));
    if (!todo) {
      renderList();
      return;
    }
    document.getElementById('todo-title').value = todo.title || '';
    document.getElementById('todo-notes').value = todo.notes || '';
    document.getElementById('todo-list-name').value = todo.listName || 'Inbox';
    document.getElementById('todo-due-date').value = todo.dueDate || '';
    document.getElementById('todo-priority').value = todo.priority || 'none';
    document.getElementById('todo-visibility').value = todo.scope || 'personal';
    const context = document.getElementById('todo-context-summary');
    if (context) context.textContent = contextText(todo);
    const doneBtn = document.getElementById('todo-toggle-complete-btn');
    if (doneBtn) doneBtn.textContent = todo.isCompleted ? 'Mark Open' : 'Mark Done';
    renderList();
  }

  function readEditor() {
    const todo = state.current || {};
    return {
      ...todo,
      title: String(document.getElementById('todo-title')?.value || '').trim() || 'Untitled Todo',
      notes: String(document.getElementById('todo-notes')?.value || '').trim(),
      listName: String(document.getElementById('todo-list-name')?.value || '').trim() || 'Inbox',
      dueDate: String(document.getElementById('todo-due-date')?.value || ''),
      priority: String(document.getElementById('todo-priority')?.value || 'none'),
      scope: String(document.getElementById('todo-visibility')?.value || 'personal') === 'shared' ? 'shared' : 'personal'
    };
  }

  function todoPayload(todo, { creating = false } = {}) {
    const user = getCurrentUser();
    const searchText = [todo.title, todo.notes, todo.listName, todo.machineCode, todo.issueId].join(' ').toLowerCase();
    return {
      title: todo.title,
      notes: todo.notes || '',
      listName: todo.listName || 'Inbox',
      dueDate: todo.dueDate || '',
      priority: todo.priority || 'none',
      isCompleted: Boolean(todo.isCompleted),
      completedAt: todo.isCompleted ? (todo.completedAt || serverTimestamp()) : null,
      plantId: getCurrentPlantId() || '',
      pressId: todo.pressId || '',
      machineCode: todo.machineCode || '',
      issueId: todo.issueId || '',
      ownerUid: todo.ownerUid || user?.uid || '',
      ownerName: todo.ownerName || user?.displayName || user?.email || '',
      searchText,
      updatedAt: serverTimestamp(),
      updatedBy: currentActor(),
      schemaVersion: 1,
      ...(creating ? { createdAt: serverTimestamp(), createdBy: currentActor() } : {})
    };
  }

  async function saveTodo(todo, { creating = false, oldScope = null, activate = true } = {}) {
    if (!getCurrentUser() || !getCurrentPlantId()) return null;
    const scope = todo.scope === 'shared' ? 'shared' : 'personal';
    const id = todo.id || doc(scope === 'shared' ? plantTodosCol() : userTodosCol()).id;
    const normalized = normalizeTodo({ ...todo, id }, scope);
    const createsTargetDoc = creating || !todo.id || (oldScope && oldScope !== scope);
    await setDoc(todoRef(scope, id), todoPayload(normalized, { creating: createsTargetDoc }), { merge: true });
    if (oldScope && oldScope !== scope && todo.id) await deleteDoc(todoRef(oldScope, todo.id));
    if (activate) state.activeKey = `${scope}:${id}`;
    return { ...normalized, id, scope };
  }

  async function createFromQuick() {
    const input = document.getElementById('todo-quick-title');
    const title = String(input?.value || '').trim();
    if (!title) return;
    const scope = state.scope === 'shared' ? 'shared' : 'personal';
    input.value = '';
    try {
      const saved = await saveTodo({ title, notes: '', listName: 'Inbox', dueDate: '', priority: 'none', isCompleted: false, scope }, { creating: true, activate: false });
      if (saved) {
        state.error = '';
        renderEditor(null);
      }
    } catch (err) {
      if (input) input.value = title;
      setError(`Could not create ${scope === 'shared' ? 'shared' : 'personal'} todo: ${err?.message || 'permission denied'}`, err);
    }
  }

  async function saveFromEditor() {
    if (!state.current?.id) return;
    const priorScope = state.current.scope || 'personal';
    try {
      const saved = await saveTodo(readEditor(), { oldScope: priorScope });
      if (saved) {
        state.error = '';
        renderEditor(saved);
      }
    } catch (err) {
      setError(`Could not save todo: ${err?.message || 'permission denied'}`, err);
    }
  }

  async function toggleTodo(todo) {
    try {
      await updateDoc(todoRef(todo.scope, todo.id), {
        isCompleted: !todo.isCompleted,
        completedAt: !todo.isCompleted ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
        updatedBy: currentActor()
      });
      state.error = '';
      if (state.activeKey === todoKey(todo)) {
        renderEditor({ ...todo, isCompleted: !todo.isCompleted });
      }
    } catch (err) {
      setError(`Could not update todo: ${err?.message || 'permission denied'}`, err);
    }
  }

  async function deleteCurrent() {
    const todo = state.current;
    if (!todo?.id) return;
    if (!confirm(`Delete "${todo.title || 'Untitled Todo'}"?`)) return;
    try {
      await deleteDoc(todoRef(todo.scope, todo.id));
      state.error = '';
      renderEditor(null);
    } catch (err) {
      setError(`Could not delete todo: ${err?.message || 'permission denied'}`, err);
    }
  }

  function findByKey(key) {
    return state.todos.find(todo => todoKey(todo) === key) || null;
  }

  async function startListeners() {
    if (!getCurrentUser() || !getCurrentPlantId() || state.listening) return;
    state.listening = true;
    state.error = '';
    todoUnsubPersonal = onSnapshot(query(userTodosCol(), orderBy('updatedAt', 'desc')), snap => {
      const plantId = getCurrentPlantId();
      state.personal = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => t.plantId === plantId);
      renderList();
    }, err => {
      console.warn('personal todos listener error', err);
      state.error = `Could not load personal todos: ${err?.message || 'permission denied'}`;
      renderList();
    });
    todoUnsubShared = onSnapshot(query(plantTodosCol(), orderBy('updatedAt', 'desc')), snap => {
      state.shared = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderList();
    }, err => {
      console.warn('shared todos listener error', err);
      state.error = `Could not load shared todos: ${err?.message || 'permission denied'}`;
      renderList();
    });
  }

  function stopListeners() {
    if (todoUnsubPersonal) todoUnsubPersonal();
    if (todoUnsubShared) todoUnsubShared();
    todoUnsubPersonal = null;
    todoUnsubShared = null;
    state.listening = false;
  }

  function resetState() {
    stopListeners();
    state.personal = [];
    state.shared = [];
    state.todos = [];
    state.scope = 'all';
    state.filter = 'open';
    state.search = '';
    state.activeKey = null;
    state.current = null;
    state.error = '';
    const search = document.getElementById('todo-search');
    if (search) search.value = '';
    setEditorVisible(false);
  }

  async function linkOpenPress() {
    if (!state.current) return;
    const machine = getOpenMachine();
    if (!machine) return;
    state.current.machineCode = machine;
    state.current.pressId = toPressId(machine);
    renderEditor(state.current);
    await saveFromEditor();
  }

  async function linkOpenIssue() {
    if (!state.current) return;
    const issue = getOpenIssue();
    if (!issue) return;
    state.current.issueId = issue.id;
    state.current.machineCode = issue.machine || state.current.machineCode || '';
    state.current.pressId = issue.machine ? toPressId(issue.machine) : (state.current.pressId || '');
    renderEditor(state.current);
    await saveFromEditor();
  }

  function clearLinks() {
    if (!state.current) return;
    state.current.issueId = '';
    state.current.machineCode = '';
    state.current.pressId = '';
    renderEditor(state.current);
  }

  async function open(options = {}) {
    if (!getCurrentUser() || !getCurrentPlantId()) return;
    document.getElementById('todos-modal')?.classList.add('visible');
    document.body.classList.add('notes-open');
    completeDemoGuideStep('tools');
    await startListeners();
    renderList();
  }

  function close(options = {}) {
    if (_todoSearchTimer) { clearTimeout(_todoSearchTimer); _todoSearchTimer = null; }
    document.getElementById('todos-modal')?.classList.remove('visible');
    document.body.classList.remove('notes-open');
    if (!options.preserveState) resetState();
  }

  function hasState() {
    return Boolean(state.todos.length || state.activeKey || state.search || state.scope !== 'all' || state.filter !== 'open');
  }

  function bindEvents() {
    document.getElementById('todo-quick-add-btn')?.addEventListener('click', () => void createFromQuick());
    document.getElementById('todo-quick-title')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void createFromQuick();
      }
    });
    let _todoSearchTimer = null;
    document.getElementById('todo-search')?.addEventListener('input', e => {
      state.search = String(e.target.value || '');
      if (_todoSearchTimer) clearTimeout(_todoSearchTimer);
      _todoSearchTimer = setTimeout(() => {
        _todoSearchTimer = null;
        renderList();
      }, 150);
    });
    document.querySelectorAll('[data-todo-scope]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.scope = btn.dataset.todoScope || 'all';
        renderList();
      });
    });
    document.querySelectorAll('[data-todo-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.filter = btn.dataset.todoFilter || 'open';
        renderList();
      });
    });
    document.getElementById('todos-list')?.addEventListener('click', e => {
      const toggleKey = e.target.closest?.('[data-todo-toggle]')?.dataset?.todoToggle;
      if (toggleKey) {
        const todo = findByKey(toggleKey);
        if (todo) void toggleTodo(todo);
        return;
      }
      const openKey = e.target.closest?.('[data-todo-open]')?.dataset?.todoOpen || e.target.closest?.('[data-todo-key]')?.dataset?.todoKey;
      if (openKey) {
        const todo = findByKey(openKey);
        if (todo) renderEditor(todo);
      }
    });
    document.getElementById('todo-save-btn')?.addEventListener('click', () => void saveFromEditor());
    document.getElementById('todo-delete-btn')?.addEventListener('click', () => void deleteCurrent());
    document.getElementById('todo-editor-close-btn')?.addEventListener('click', () => renderEditor(null));
    document.getElementById('todo-toggle-complete-btn')?.addEventListener('click', () => {
      const todo = state.current;
      if (todo) void toggleTodo(todo);
    });
    document.getElementById('todo-link-press-btn')?.addEventListener('click', linkOpenPress);
    document.getElementById('todo-link-issue-btn')?.addEventListener('click', linkOpenIssue);
    document.getElementById('todo-clear-links-btn')?.addEventListener('click', clearLinks);
  }

  bindEvents();
  return { open, close, hasState, state };
}
