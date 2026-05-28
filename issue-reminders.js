const ISSUE_REMINDER_STORAGE_KEY = 'aptracker_issue_reminders_v1';
const AUTO_CRITICAL_GRACE_MS = 30 * 1000;

export function initIssueReminders(deps) {
  const {
    getIssues,
    parseTimerMinutes,
    showGameToast,
    renderIssues,
    updateDoc,
    addDoc,
    plantDoc,
    issueEventsCol,
    serverTimestamp,
    currentActor
  } = deps;

  let reminderMap = {};
  const notified = new Set();
  const escalated = new Set();
  let modalIssueId = null;
  const wheelValue = { hours: 0, mins: 0, secs: 0 };

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ISSUE_REMINDER_STORAGE_KEY) || '{}');
      reminderMap = (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (error) {
      reminderMap = {};
    }
  }

  function save() {
    try {
      localStorage.setItem(ISSUE_REMINDER_STORAGE_KEY, JSON.stringify(reminderMap));
    } catch (error) {}
  }

  function clear(issueId) {
    if (!issueId) return;
    delete reminderMap[issueId];
    save();
  }

  function set(issueId, minutes) {
    const parsedMinutes = parseTimerMinutes(minutes);
    if (!issueId || !parsedMinutes) return false;
    const now = Date.now();
    reminderMap[issueId] = {
      minutes: parsedMinutes,
      setAt: now,
      dueAt: now + parsedMinutes * 60 * 1000
    };
    save();
    return true;
  }

  function state(issueId, nowMs = Date.now()) {
    const reminder = reminderMap?.[issueId];
    if (!reminder?.dueAt) return null;
    const dueAt = Number(reminder.dueAt || 0);
    if (!Number.isFinite(dueAt) || dueAt <= 0) return null;
    const remainingMs = dueAt - nowMs;
    const absMin = Math.max(1, Math.ceil(Math.abs(remainingMs) / 60000));
    return {
      dueAt,
      minutes: Number(reminder.minutes || 0),
      isOverdue: remainingMs <= 0,
      remainingMs,
      label: remainingMs > 0 ? `⏱ Remind in ${absMin}m` : `⏰ Reminder due ${absMin}m`
    };
  }

  function getReminderMinutes(issueId) {
    return parseTimerMinutes(reminderMap?.[issueId]?.minutes);
  }

  function formatClock(reminderState) {
    if (!reminderState) return '00:00';
    const seconds = Math.max(0, Math.floor(Math.abs(Number(reminderState.remainingMs || 0)) / 1000));
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function buildWheel(elId, max, key) {
    const wheel = document.getElementById(elId);
    if (!wheel) return;
    wheel.innerHTML = '';
    for (let i = 0; i <= max; i++) {
      const item = document.createElement('div');
      item.className = 'timer-wheel-item';
      item.textContent = String(i);
      item.dataset.value = String(i);
      wheel.appendChild(item);
    }
    const updateValue = () => {
      const itemHeight = 42;
      const idx = Math.max(0, Math.min(max, Math.round(wheel.scrollTop / itemHeight)));
      wheelValue[key] = idx;
      wheel.querySelectorAll('.timer-wheel-item').forEach((el, i) => el.classList.toggle('active', i === idx));
    };
    wheel.onscroll = updateValue;
    setTimeout(() => updateValue(), 0);
  }

  function setWheelValue(elId, val) {
    const wheel = document.getElementById(elId);
    if (!wheel) return;
    wheel.scrollTop = Math.max(0, Number(val || 0)) * 42;
  }

  function openModal(issueId) {
    const issue = getIssues().find(item => item.id === issueId);
    if (!issue) return;
    modalIssueId = issueId;
    const current = state(issueId);
    const minutes = Math.max(0, Number(current?.minutes || 0));
    buildWheel('issue-reminder-hours-wheel', 23, 'hours');
    buildWheel('issue-reminder-mins-wheel', 59, 'mins');
    buildWheel('issue-reminder-secs-wheel', 59, 'secs');
    setWheelValue('issue-reminder-hours-wheel', Math.floor(minutes / 60));
    setWheelValue('issue-reminder-mins-wheel', minutes % 60);
    setWheelValue('issue-reminder-secs-wheel', 0);
    wheelValue.hours = Math.floor(minutes / 60);
    wheelValue.mins = minutes % 60;
    wheelValue.secs = 0;
    const sub = document.getElementById('issue-reminder-modal-subtitle');
    if (sub) sub.textContent = `Press ${issue.machine || 'Unknown'} • pick a timer`;
    document.getElementById('issue-reminder-modal')?.classList.add('visible');
  }

  function closeModal() {
    document.getElementById('issue-reminder-modal')?.classList.remove('visible');
    modalIssueId = null;
  }

  function setFromModal(minutes) {
    if (!modalIssueId) return;
    set(modalIssueId, minutes);
    showGameToast(`⏱ Reminder set for ${minutes}m.`);
    closeModal();
    renderIssues();
  }

  function setFromModalCustom() {
    const h = Number(wheelValue.hours || 0);
    const m = Number(wheelValue.mins || 0);
    const s = Number(wheelValue.secs || 0);
    const total = Math.floor((h * 60) + m + (s / 60));
    if (total <= 0) {
      showGameToast('Pick a time greater than 0 minutes.');
      return;
    }
    setFromModal(total);
  }

  function clearFromModal() {
    if (!modalIssueId) return;
    clear(modalIssueId);
    showGameToast('Reminder cleared.');
    closeModal();
    renderIssues();
  }

  function setFromCard(issueId) {
    const minutes = parseTimerMinutes(document.getElementById(`issue-reminder-minutes-${issueId}`)?.value);
    if (!minutes) {
      showGameToast('Select a reminder time first.');
      return;
    }
    if (!set(issueId, minutes)) return;
    showGameToast(`⏱ Reminder set for ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    renderIssues();
  }

  function setQuick(issueId, minutes) {
    const parsedMinutes = parseTimerMinutes(minutes);
    if (!parsedMinutes) return;
    const sel = document.getElementById(`issue-reminder-minutes-${issueId}`);
    if (sel) sel.value = String(parsedMinutes);
    set(issueId, parsedMinutes);
    showGameToast(`⏱ Reminder set for ${parsedMinutes} minute${parsedMinutes === 1 ? '' : 's'}.`);
    renderIssues();
  }

  function clearFromCard(issueId) {
    clear(issueId);
    showGameToast('Reminder cleared.');
    renderIssues();
  }

  async function autoEscalateToCritical(issue, reminderState) {
    if (!issue?.id || !reminderState?.dueAt) return;
    if (issue.highPriority === true && issue.priority === 'critical') return;
    const graceThreshold = Number(reminderState.dueAt) + AUTO_CRITICAL_GRACE_MS;
    if (!Number.isFinite(graceThreshold) || Date.now() < graceThreshold) return;
    const dedupeKey = `${issue.id}:${reminderState.dueAt}`;
    if (escalated.has(dedupeKey)) return;
    escalated.add(dedupeKey);
    try {
      await updateDoc(plantDoc('issues', issue.id), {
        highPriority: true,
        priority: 'critical',
        priorityChangedAt: serverTimestamp(),
        priorityChangedBy: currentActor()
      });
      await addDoc(issueEventsCol(issue.id), {
        eventType: 'issue_priority_changed',
        actor: currentActor(),
        note: 'Auto-escalated to critical after timer expiry.',
        metadata: {
          fromHighPriority: !!issue.highPriority,
          fromPriority: issue.priority || null,
          toHighPriority: true,
          toPriority: 'critical',
          escalationReason: 'timer_expired_unacknowledged',
          reminderDueAt: Number(reminderState.dueAt)
        },
        eventAt: serverTimestamp()
      });
      showGameToast(`🚨 Auto-critical: Press ${issue.machine || 'Unknown'}`);
    } catch (error) {
      escalated.delete(dedupeKey);
      console.warn('Issue reminder escalation failed', error);
    }
  }

  async function maybeNotify(issueList = getIssues()) {
    if (!Array.isArray(issueList) || issueList.length === 0) return;
    for (const issue of issueList) {
      const reminderState = state(issue.id);
      if (!reminderState?.isOverdue) continue;
      const dedupeKey = `${issue.id}:${reminderState.dueAt}`;
      if (!notified.has(dedupeKey)) {
        notified.add(dedupeKey);
        showGameToast(`⏰ Reminder: check Press ${issue.machine || 'Unknown'}`);
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          try {
            navigator.vibrate([200, 120, 200, 120, 300]);
          } catch (error) {
            console.warn('Issue reminder vibration failed', error);
          }
        }
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(`Reminder — Press ${issue.machine || 'Unknown'}`, {
              body: issue.note || 'Go back and check the issue.'
            });
          } catch (error) {
            console.warn('Issue reminder notification failed', error);
          }
        }
      }
      try {
        await autoEscalateToCritical(issue, reminderState);
      } catch (error) {
        console.warn('Issue reminder auto-critical check failed', error);
      }
    }
  }

  function refreshClocksInDom() {
    document.querySelectorAll('[data-reminder-id]').forEach(el => {
      const issueId = el.getAttribute('data-reminder-id');
      if (!issueId) return;
      const reminderState = state(issueId);
      if (!reminderState) return;
      el.textContent = formatClock(reminderState);
    });
  }

  load();

  return {
    clear,
    set,
    state,
    getReminderMinutes,
    formatClock,
    openModal,
    closeModal,
    setFromModal,
    setFromModalCustom,
    clearFromModal,
    setFromCard,
    setQuick,
    clearFromCard,
    maybeNotify,
    refreshClocksInDom
  };
}
