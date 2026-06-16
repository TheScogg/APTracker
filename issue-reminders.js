const ISSUE_REMINDER_STORAGE_KEY = 'aptracker_issue_reminders_v1';
const AUTO_HOT_GRACE_MS = 0;

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
    currentActor,
    ensurePushEnabled,
    autoHotIssue
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
    const previousTimer = applyLocalTimer(issueId, null);
    delete reminderMap[issueId];
    save();
    persistTimerClear(issueId, previousTimer);
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
    const payload = timerPayload(reminderMap[issueId]);
    const previousTimer = applyLocalTimer(issueId, payload);
    save();
    persistTimerSet(issueId, payload, previousTimer);
    requestPushRegistration();
    return true;
  }

  function applyLocalTimer(issueId, timer) {
    const issue = getIssues().find(item => item?.id === issueId);
    if (!issue) return null;
    const previousTimer = issue.timer || null;
    issue.timer = timer ? { ...timer } : null;
    return previousTimer;
  }

  function issueTimerReminder(issueId) {
    const issue = getIssues().find(item => item?.id === issueId);
    if (!issue) return null;
    const timer = issue.timer || null;
    if (!timer?.enabled || !timer?.dueAtMs) return null;
    const dueAt = Number(timer.dueAtMs || 0);
    if (!Number.isFinite(dueAt) || dueAt <= 0) return null;
    return {
      minutes: parseTimerMinutes(timer.minutes),
      setAt: Number(timer.startedAtMs || 0),
      dueAt
    };
  }

  function reminderForIssue(issueId) {
    return issueTimerReminder(issueId) || reminderMap?.[issueId] || null;
  }

  function state(issueId, nowMs = Date.now()) {
    const reminder = reminderForIssue(issueId);
    if (!reminder?.dueAt) return null;
    const dueAt = Number(reminder.dueAt || 0);
    if (!Number.isFinite(dueAt) || dueAt <= 0) return null;
    const remainingMs = dueAt - nowMs;
    return {
      dueAt,
      minutes: Number(reminder.minutes || 0),
      isOverdue: remainingMs <= 0,
      remainingMs,
      label: remainingMs > 0
        ? `Remind in ${formatDurationCompact(remainingMs)}`
        : `Due ${formatDurationCompact(Math.abs(remainingMs))}`
    };
  }

  function getReminderMinutes(issueId) {
    return parseTimerMinutes(reminderForIssue(issueId)?.minutes);
  }

  function timerPayload(reminder) {
    const actor = currentActor();
    const dueAt = Number(reminder?.dueAt || 0);
    const minutes = parseTimerMinutes(reminder?.minutes);
    const startedAtMs = Number(reminder?.setAt || 0) || Date.now();
    return {
      enabled: true,
      minutes,
      startedAtMs,
      dueAtMs: dueAt,
      notificationStatus: 'pending',
      notificationRequestedAtMs: Date.now(),
      notificationRequestedBy: actor,
      notificationOwnerUid: actor?.uid || '',
      notificationDelivery: null
    };
  }

  function persistTimerSet(issueId, timer, previousTimer = null) {
    if (!issueId || !timer?.dueAtMs || typeof updateDoc !== 'function' || typeof plantDoc !== 'function') return;
    updateDoc(plantDoc('issues', issueId), { timer })
      .catch(error => {
        applyLocalTimer(issueId, previousTimer);
        console.warn('Issue reminder timer sync failed', error);
      });
  }

  function persistTimerClear(issueId, previousTimer = null) {
    if (!issueId || typeof updateDoc !== 'function' || typeof plantDoc !== 'function') return;
    updateDoc(plantDoc('issues', issueId), { timer: null })
      .catch(error => {
        applyLocalTimer(issueId, previousTimer);
        console.warn('Issue reminder timer clear sync failed', error);
      });
  }

  function requestPushRegistration() {
    if (typeof ensurePushEnabled !== 'function') return;
    ensurePushEnabled().catch(error => console.warn('Issue reminder push registration failed', error));
  }

  function formatClock(reminderState) {
    if (!reminderState) return '00:00';
    const seconds = Math.max(0, Math.floor(Math.abs(Number(reminderState.remainingMs || 0)) / 1000));
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function formatDurationCompact(ms) {
    const totalSeconds = Math.max(1, Math.ceil(Math.abs(Number(ms || 0)) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    return `${secs}s`;
  }

  function formatTimerMinutes(minutes) {
    const totalSeconds = Math.max(1, Math.round(Number(minutes || 0) * 60));
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) return `${hours}h${mins ? ` ${mins}m` : ''}`;
    if (mins > 0) return `${mins} minute${mins === 1 ? '' : 's'}${secs ? ` ${secs}s` : ''}`;
    return `${secs} second${secs === 1 ? '' : 's'}`;
  }

  function formatSelectedClock(totalSeconds) {
    const seconds = Math.max(0, Math.round(Number(totalSeconds || 0)));
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function selectedWheelSeconds() {
    return (Number(wheelValue.hours || 0) * 3600)
      + (Number(wheelValue.mins || 0) * 60)
      + Number(wheelValue.secs || 0);
  }

  function updateTimerPreview() {
    const preview = document.getElementById('issue-reminder-preview');
    if (!preview) return;
    const seconds = selectedWheelSeconds();
    preview.textContent = formatSelectedClock(seconds);
    preview.classList.toggle('empty', seconds <= 0);
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
      updateTimerPreview();
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
    const totalSeconds = Math.round(minutes * 60);
    buildWheel('issue-reminder-hours-wheel', 23, 'hours');
    buildWheel('issue-reminder-mins-wheel', 59, 'mins');
    buildWheel('issue-reminder-secs-wheel', 59, 'secs');
    setWheelValue('issue-reminder-hours-wheel', Math.floor(totalSeconds / 3600));
    setWheelValue('issue-reminder-mins-wheel', Math.floor((totalSeconds % 3600) / 60));
    setWheelValue('issue-reminder-secs-wheel', totalSeconds % 60);
    wheelValue.hours = Math.floor(totalSeconds / 3600);
    wheelValue.mins = Math.floor((totalSeconds % 3600) / 60);
    wheelValue.secs = totalSeconds % 60;
    updateTimerPreview();
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
    const parsedMinutes = parseTimerMinutes(minutes);
    if (!set(modalIssueId, parsedMinutes)) return;
    showGameToast(`⏱ Reminder set for ${formatTimerMinutes(parsedMinutes)}.`);
    closeModal();
    renderIssues();
  }

  function setFromModalCustom() {
    const h = Number(wheelValue.hours || 0);
    const m = Number(wheelValue.mins || 0);
    const s = Number(wheelValue.secs || 0);
    const total = parseTimerMinutes((h * 60) + m + (s / 60));
    if (total <= 0) {
      showGameToast('Pick a time greater than 0 seconds.');
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
    showGameToast(`⏱ Reminder set for ${formatTimerMinutes(minutes)}.`);
    renderIssues();
  }

  function setQuick(issueId, minutes) {
    const parsedMinutes = parseTimerMinutes(minutes);
    if (!parsedMinutes) return;
    const sel = document.getElementById(`issue-reminder-minutes-${issueId}`);
    if (sel) sel.value = String(parsedMinutes);
    set(issueId, parsedMinutes);
    showGameToast(`⏱ Reminder set for ${formatTimerMinutes(parsedMinutes)}.`);
    renderIssues();
  }

  function clearFromCard(issueId) {
    clear(issueId);
    showGameToast('Reminder cleared.');
    renderIssues();
  }

  async function autoEscalateToHot(issue, reminderState) {
    if (!issue?.id || !reminderState?.dueAt) return;
    const graceThreshold = Number(reminderState.dueAt) + AUTO_HOT_GRACE_MS;
    if (!Number.isFinite(graceThreshold) || Date.now() < graceThreshold) return;
    const dedupeKey = `${issue.id}:${reminderState.dueAt}`;
    if (escalated.has(dedupeKey)) return;
    escalated.add(dedupeKey);
    try {
      if (typeof autoHotIssue === 'function') {
        await autoHotIssue(issue, reminderState);
      } else {
        await updateDoc(plantDoc('issues', issue.id), {
          highPriority: true,
          priority: 'critical',
          priorityChangedAt: serverTimestamp(),
          priorityChangedBy: currentActor()
        });
        await addDoc(issueEventsCol(issue.id), {
          eventType: 'issue_priority_changed',
          actor: currentActor(),
          note: 'Auto-escalated after timer expiry.',
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
      }
      issue.highPriority = true;
      issue.priority = 'critical';
      renderIssues();
      showGameToast(`🚨 Hot: Press ${issue.machine || 'Unknown'}`);
    } catch (error) {
      escalated.delete(dedupeKey);
      console.warn('Issue reminder hot status escalation failed', error);
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
        renderIssues();
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
        await autoEscalateToHot(issue, reminderState);
      } catch (error) {
        console.warn('Issue reminder auto-hot check failed', error);
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
