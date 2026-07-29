const ISSUE_REMINDER_STORAGE_KEY = 'aptracker_issue_reminders_v1';
const AUTO_HOT_GRACE_MS = 0;
const TIMER_SCRUBBER_MAX_SECONDS = 30 * 60;
const TIMER_SCRUBBER_STEP_SECONDS = 30;
const TIMER_SCRUBBER_TICK_COUNT = (TIMER_SCRUBBER_MAX_SECONDS / TIMER_SCRUBBER_STEP_SECONDS) + 1;

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
    autoHotIssue,
    persistTimer,
    isDemoMode
  } = deps;

  let reminderMap = {};
  const notified = new Set();
  const escalated = new Set();
  let modalIssueId = null;
  let selectedSeconds = 0;
  let scrubberPointerBound = false;
  let modalClockTimer = null;

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
      dueAt: now + parsedMinutes * 60 * 1000,
      visualDurationMs: parsedMinutes * 60 * 1000,
      visualElapsedMs: 0,
      visualStartedAtMs: now
    };
    const payload = timerPayload(reminderMap[issueId]);
    const previousTimer = applyLocalTimer(issueId, payload);
    save();
    persistTimerSet(issueId, payload, previousTimer);
    requestPushRegistration();
    return true;
  }

  function setReminderState(issueId, reminder) {
    if (!issueId || !reminder?.dueAt) return false;
    reminderMap[issueId] = {
      minutes: parseTimerMinutes(reminder.minutes),
      setAt: Number(reminder.setAt || 0) || Date.now(),
      dueAt: Number(reminder.dueAt || 0),
      paused: Boolean(reminder.paused),
      pausedAtMs: Number(reminder.pausedAtMs || 0) || null,
      pausedRemainingMs: Math.max(0, Number(reminder.pausedRemainingMs || 0)) || null,
      visualDurationMs: Math.max(0, Number(reminder.visualDurationMs || 0)) || null,
      visualElapsedMs: Math.max(0, Number(reminder.visualElapsedMs || 0)) || 0,
      visualStartedAtMs: Number(reminder.visualStartedAtMs || 0) || null
    };
    const payload = timerPayload(reminderMap[issueId]);
    const previousTimer = applyLocalTimer(issueId, payload);
    save();
    persistTimerSet(issueId, payload, previousTimer);
    if (!payload.paused) requestPushRegistration();
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
    const pauseMeta = timer.notificationDelivery?.__pauseMeta || null;
    return {
      minutes: parseTimerMinutes(timer.minutes ?? timer.durationMinutes),
      setAt: Number(timer.startedAtMs || 0),
      dueAt,
      paused: Boolean(timer.paused ?? pauseMeta?.paused),
      pausedAtMs: Number(timer.pausedAtMs ?? pauseMeta?.pausedAtMs ?? 0),
      pausedRemainingMs: Number(timer.pausedRemainingMs ?? pauseMeta?.pausedRemainingMs ?? 0),
      visualDurationMs: Number(timer.visualDurationMs || 0),
      visualElapsedMs: Number(timer.visualElapsedMs || 0),
      visualStartedAtMs: Number(timer.visualStartedAtMs || 0)
    };
  }

  function reminderForIssue(issueId) {
    const localReminder = reminderMap?.[issueId] || null;
    // A resume immediately reschedules the server timer. Keep the local visual
    // baseline authoritative while that write and its snapshot catch up; otherwise
    // the prior server snapshot can briefly reset the perimeter to zero.
    if (localReminder?.paused || localReminder?.visualDurationMs) return localReminder;
    return issueTimerReminder(issueId) || localReminder;
  }

  function state(issueId, nowMs = Date.now()) {
    const reminder = reminderForIssue(issueId);
    if (!reminder?.dueAt) return null;
    const dueAt = Number(reminder.dueAt || 0);
    if (!Number.isFinite(dueAt) || dueAt <= 0) return null;
    const isPaused = Boolean(reminder.paused);
    const pausedRemainingMs = Number(reminder.pausedRemainingMs || 0);
    const remainingMs = isPaused ? pausedRemainingMs : dueAt - nowMs;
    const configuredDurationMs = Math.max(0, Number(reminder.minutes || 0) * 60 * 1000);
    const storedSetAt = Number(reminder.setAt || 0);
    const startedAt = Number.isFinite(storedSetAt) && storedSetAt > 0
      ? storedSetAt
      : dueAt - configuredDurationMs;
    const fallbackDurationMs = Math.max(0, dueAt - startedAt) || configuredDurationMs;
    const durationMs = Math.max(0, Number(reminder.visualDurationMs || 0)) || fallbackDurationMs;
    const visualStartedAtMs = Number(reminder.visualStartedAtMs || 0) || startedAt;
    const visualElapsedBaseMs = Math.max(0, Number(reminder.visualElapsedMs || 0));
    const elapsedMs = isPaused
      ? visualElapsedBaseMs
      : Math.min(durationMs, visualElapsedBaseMs + Math.max(0, nowMs - visualStartedAtMs));
    const elapsedProgress = durationMs > 0 ? Math.min(1, Math.max(0, elapsedMs / durationMs)) : 0;
    return {
      dueAt,
      minutes: Number(reminder.minutes || 0),
      startedAt,
      durationMs,
      elapsedMs,
      elapsedProgress,
      isPaused,
      isOverdue: !isPaused && remainingMs <= 0,
      remainingMs,
      label: remainingMs > 0
        ? `${isPaused ? 'Paused at' : 'Remind in'} ${formatDurationCompact(remainingMs)}`
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
      notificationStatus: reminder?.paused ? 'paused' : 'pending',
      notificationRequestedAtMs: Date.now(),
      notificationRequestedBy: actor,
      notificationOwnerUid: actor?.uid || '',
      notificationDelivery: null,
      paused: Boolean(reminder?.paused),
      pausedAtMs: Number(reminder?.pausedAtMs || 0) || null,
      pausedRemainingMs: Math.max(0, Number(reminder?.pausedRemainingMs || 0)) || null,
      visualDurationMs: Math.max(0, Number(reminder?.visualDurationMs || 0)) || null,
      visualElapsedMs: Math.max(0, Number(reminder?.visualElapsedMs || 0)) || 0,
      visualStartedAtMs: Number(reminder?.visualStartedAtMs || 0) || null
    };
  }

  function persistTimerSet(issueId, timer, previousTimer = null) {
    if (isDemoMode) return;
    if (typeof persistTimer === 'function') {
      persistTimer(issueId, timer)
        .catch(error => {
          applyLocalTimer(issueId, previousTimer);
          console.warn('Issue reminder timer sync failed', error);
        });
      return;
    }
    if (!issueId || !timer?.dueAtMs || typeof updateDoc !== 'function' || typeof plantDoc !== 'function') return;
    updateDoc(plantDoc('issues', issueId), { timer })
      .catch(error => {
        applyLocalTimer(issueId, previousTimer);
        console.warn('Issue reminder timer sync failed', error);
      });
  }

  function persistTimerClear(issueId, previousTimer = null) {
    if (isDemoMode) return;
    if (typeof persistTimer === 'function') {
      persistTimer(issueId, null)
        .catch(error => {
          applyLocalTimer(issueId, previousTimer);
          console.warn('Issue reminder timer clear sync failed', error);
        });
      return;
    }
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

  function _timerPreviewInputs() {
    return {
      mins: document.getElementById('issue-reminder-preview-mins'),
      secs: document.getElementById('issue-reminder-preview-secs')
    };
  }

  function _timerPreviewInputValue(input) {
    const maxDigits = input?.id === 'issue-reminder-preview-mins' ? 3 : 2;
    return String(input?.value || '').replace(/\D+/g, '').slice(0, maxDigits);
  }

  function syncTimerPreviewInputs(force = false) {
    const { mins, secs } = _timerPreviewInputs();
    const totalSeconds = Math.max(0, Math.round(Number(selectedSeconds || 0)));
    const displayMinutes = Math.floor(totalSeconds / 60);
    const displaySeconds = totalSeconds % 60;
    if (mins && (force || document.activeElement !== mins)) mins.value = String(displayMinutes).padStart(2, '0');
    if (secs && (force || document.activeElement !== secs)) secs.value = String(displaySeconds).padStart(2, '0');
  }

  function updateTimerPreview() {
    const preview = document.getElementById('issue-reminder-preview');
    if (!preview) return;
    preview.classList.toggle('empty', selectedSeconds <= 0);
    syncTimerPreviewInputs();
  }

  function liveSyncTimerPreviewInputs() {
    const { mins, secs } = _timerPreviewInputs();
    if (!mins || !secs) return;
    const parsedMinutes = Math.max(0, Math.min(120, Number(_timerPreviewInputValue(mins) || 0)));
    const parsedSeconds = Math.max(0, Math.min(59, Number(_timerPreviewInputValue(secs) || 0)));
    setSelectedSeconds((parsedMinutes * 60) + parsedSeconds);
  }

  function commitTimerPreviewInputs({ keepFocus = false } = {}) {
    const { mins, secs } = _timerPreviewInputs();
    if (!mins || !secs) return;
    const parsedMinutes = Math.max(0, Math.min(120, Number(_timerPreviewInputValue(mins) || 0)));
    const parsedSeconds = Math.max(0, Math.min(59, Number(_timerPreviewInputValue(secs) || 0)));
    mins.value = String(parsedMinutes).padStart(2, '0');
    secs.value = String(parsedSeconds).padStart(2, '0');
    setSelectedSeconds((parsedMinutes * 60) + parsedSeconds);
    if (!keepFocus) {
      mins.classList.remove('is-editing');
      secs.classList.remove('is-editing');
    }
  }

  function bindTimerPreviewInputs() {
    const { mins, secs } = _timerPreviewInputs();
    if (!mins || mins.dataset.bound === 'true' || !secs) return;
    mins.dataset.bound = 'true';
    secs.dataset.bound = 'true';
    const inputs = [mins, secs];
    inputs.forEach(input => {
      input.addEventListener('focus', () => {
        input.classList.add('is-editing');
        input.select();
      });
      input.addEventListener('blur', () => {
        commitTimerPreviewInputs();
      });
      input.addEventListener('input', () => {
        input.value = _timerPreviewInputValue(input);
        liveSyncTimerPreviewInputs();
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
          return;
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const isSeconds = input === secs;
          const raw = Number(_timerPreviewInputValue(input) || 0);
          const next = event.key === 'ArrowUp' ? raw + 1 : raw - 1;
          const max = isSeconds ? 59 : 120;
          input.value = String(Math.max(0, Math.min(max, next))).padStart(2, '0');
          commitTimerPreviewInputs({ keepFocus: true });
          return;
        }
        if (event.key === 'ArrowRight' && input === mins && input.selectionStart === input.value.length) {
          event.preventDefault();
          secs.focus();
          return;
        }
        if (event.key === 'ArrowLeft' && input === secs && input.selectionStart === 0) {
          event.preventDefault();
          mins.focus();
        }
      });
    });
    syncTimerPreviewInputs(true);
  }

  function updateScrubberLabels() {
    const scale = document.getElementById('issue-reminder-scale-labels');
    if (!scale || scale.childElementCount) return;
    [5, 10, 15, 20, 25, 30].forEach(minute => {
      const label = document.createElement('span');
      label.className = 'timer-scrubber-scale-label';
      if (minute >= 30) label.classList.add('edge-end');
      label.textContent = String(minute);
      label.style.left = `${(minute / 30) * 100}%`;
      scale.appendChild(label);
    });
  }

  function updateScrubberAria() {
    const lane = document.getElementById('issue-reminder-scrubber');
    if (!lane) return;
    lane.setAttribute('aria-valuenow', String(Math.max(0, Math.round(selectedSeconds))));
    lane.setAttribute('aria-valuetext', formatSelectedClock(selectedSeconds));
  }

  function renderScrubberBars() {
    const barsWrap = document.getElementById('issue-reminder-bars');
    const pointer = document.querySelector('#issue-reminder-scrubber .timer-scrubber-pointer');
    if (!barsWrap) return;
    if (!barsWrap.childElementCount) {
      for (let i = 0; i < TIMER_SCRUBBER_TICK_COUNT; i++) {
        const bar = document.createElement('div');
        const isMajorTick = i > 0 && i % 10 === 0;
        bar.className = `timer-scrubber-bar${isMajorTick ? ' major' : ''}`;
        if (i === 0) bar.classList.add('edge-start');
        if (i === TIMER_SCRUBBER_TICK_COUNT - 1) bar.classList.add('edge-end');
        bar.dataset.index = String(i);
        bar.dataset.seconds = String(i * TIMER_SCRUBBER_STEP_SECONDS);
        bar.style.left = `${(i / (TIMER_SCRUBBER_TICK_COUNT - 1)) * 100}%`;
        barsWrap.appendChild(bar);
      }
    }
    const clampedSeconds = Math.max(0, Math.min(TIMER_SCRUBBER_MAX_SECONDS, selectedSeconds));
    const activeIndex = Math.round(clampedSeconds / TIMER_SCRUBBER_STEP_SECONDS);
    barsWrap.querySelectorAll('.timer-scrubber-bar').forEach((bar, index) => {
      bar.classList.toggle('active', index <= activeIndex);
      bar.classList.toggle('future', index > activeIndex);
      bar.classList.toggle('current', index === activeIndex);
    });
    if (pointer) {
      const activeBar = barsWrap.children[activeIndex];
      if (activeBar) {
        pointer.style.left = `${activeBar.offsetLeft + (activeBar.offsetWidth / 2)}px`;
      }
    }
    updateScrubberAria();
  }

  function setSelectedSeconds(totalSeconds) {
    selectedSeconds = Math.max(0, Math.round(Number(totalSeconds || 0)));
    updateTimerPreview();
    renderScrubberBars();
  }

  function stopModalClock() {
    if (modalClockTimer) {
      clearInterval(modalClockTimer);
      modalClockTimer = null;
    }
  }

  function currentModalState() {
    return modalIssueId ? state(modalIssueId) : null;
  }

  function updateRunningModal() {
    const panel = document.getElementById('issue-reminder-running-panel');
    if (!panel || !modalIssueId) return;
    const timerState = currentModalState();
    const hasTimer = !!timerState;
    panel.hidden = !hasTimer;
    const clock = document.getElementById('issue-reminder-running-clock');
    const statePill = document.getElementById('issue-reminder-running-state');
    const dueEl = document.getElementById('issue-reminder-running-due');
    const pauseBtn = document.getElementById('issue-reminder-pause-btn');
    const resumeBtn = document.getElementById('issue-reminder-resume-btn');
    if (!hasTimer) return;
    if (clock) clock.textContent = formatClock(timerState);
    if (statePill) {
      statePill.textContent = timerState.isPaused ? 'Paused' : (timerState.isOverdue ? 'Overdue' : 'Running');
      statePill.classList.toggle('paused', !!timerState.isPaused);
      statePill.classList.toggle('overdue', !!timerState.isOverdue);
    }
    if (dueEl) dueEl.textContent = timerState.label || 'Live countdown';
    if (pauseBtn) pauseBtn.style.display = timerState.isPaused ? 'none' : '';
    if (resumeBtn) resumeBtn.style.display = timerState.isPaused ? '' : 'none';
  }

  function startModalClock() {
    stopModalClock();
    updateRunningModal();
    modalClockTimer = setInterval(updateRunningModal, 1000);
  }

  function scrubberSecondsFromClientX(clientX) {
    const barsWrap = document.getElementById('issue-reminder-bars');
    if (!barsWrap) return 0;
    const rect = barsWrap.getBoundingClientRect();
    if (!rect.width) return selectedSeconds;
    const raw = (clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, raw));
    const stepIndex = Math.round((clamped * TIMER_SCRUBBER_MAX_SECONDS) / TIMER_SCRUBBER_STEP_SECONDS);
    return stepIndex * TIMER_SCRUBBER_STEP_SECONDS;
  }

  function bindScrubber() {
    if (scrubberPointerBound) return;
    const lane = document.getElementById('issue-reminder-scrubber');
    if (!lane) return;
    scrubberPointerBound = true;
    bindTimerPreviewInputs();
    updateScrubberLabels();
    renderScrubberBars();

    lane.addEventListener('click', event => {
      if (event.target?.closest('.timer-scrubber-pointer')) return;
      setSelectedSeconds(scrubberSecondsFromClientX(event.clientX));
    });

    lane.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedSeconds(selectedSeconds - TIMER_SCRUBBER_STEP_SECONDS);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedSeconds(selectedSeconds + TIMER_SCRUBBER_STEP_SECONDS);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setSelectedSeconds(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setSelectedSeconds(TIMER_SCRUBBER_MAX_SECONDS);
      }
    });

    lane.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      lane.setPointerCapture?.(event.pointerId);
      setSelectedSeconds(scrubberSecondsFromClientX(event.clientX));
      const move = moveEvent => {
        setSelectedSeconds(scrubberSecondsFromClientX(moveEvent.clientX));
      };
      const finish = finishEvent => {
        lane.releasePointerCapture?.(finishEvent.pointerId);
        lane.removeEventListener('pointermove', move);
        lane.removeEventListener('pointerup', finish);
        lane.removeEventListener('pointercancel', finish);
      };
      lane.addEventListener('pointermove', move);
      lane.addEventListener('pointerup', finish);
      lane.addEventListener('pointercancel', finish);
    });
  }

  function openModal(issueId) {
    const issue = getIssues().find(item => item.id === issueId);
    if (!issue) return;
    modalIssueId = issueId;
    const current = state(issueId);
    const runningSeconds = current ? Math.max(0, Math.ceil(Math.abs(Number(current.remainingMs || 0)) / 1000)) : 0;
    const minutes = Math.max(0, Number(current?.minutes || 0));
    const totalSeconds = runningSeconds || Math.round(minutes * 60);
    bindScrubber();
    setSelectedSeconds(totalSeconds);
    syncTimerPreviewInputs(true);
    const sub = document.getElementById('issue-reminder-modal-subtitle');
    if (sub) sub.textContent = current
      ? `Press ${issue.machine || 'Unknown'} • live timer controls`
      : `Press ${issue.machine || 'Unknown'} • pick a timer`;
    const clearBtn = document.getElementById('issue-reminder-clear-btn');
    if (clearBtn) clearBtn.style.display = current ? '' : 'none';
    document.getElementById('issue-reminder-modal')?.classList.add('visible');
    startModalClock();
    requestAnimationFrame(() => document.getElementById('issue-reminder-scrubber')?.focus());
  }

  function closeModal() {
    stopModalClock();
    document.getElementById('issue-reminder-modal')?.classList.remove('visible');
    const panel = document.getElementById('issue-reminder-running-panel');
    if (panel) panel.hidden = true;
    modalIssueId = null;
  }

  function setFromModal(minutes) {
    if (!modalIssueId) return;
    const parsedMinutes = parseTimerMinutes(minutes);
    setSelectedSeconds(Math.round(parsedMinutes * 60));
    if (!set(modalIssueId, parsedMinutes)) return;
    showGameToast(`⏱ Reminder set for ${formatTimerMinutes(parsedMinutes)}.`);
    closeModal();
    renderIssues();
  }

  function addTimeFromModal(minutes) {
    if (!modalIssueId) return;
    const addMinutes = parseTimerMinutes(minutes);
    if (!addMinutes) return;
    const current = reminderForIssue(modalIssueId);
    const currentState = state(modalIssueId);
    const now = Date.now();
    const remainingMs = Math.max(0, Number(currentState?.remainingMs || 0));
    const nextRemainingMs = remainingMs + (addMinutes * 60 * 1000);
    const nextReminder = {
      minutes: parseTimerMinutes(nextRemainingMs / 60000),
      setAt: Number(current?.setAt || 0) || now,
      dueAt: now + nextRemainingMs,
      paused: Boolean(currentState?.isPaused),
      pausedAtMs: currentState?.isPaused ? (Number(current?.pausedAtMs || 0) || now) : null,
      pausedRemainingMs: currentState?.isPaused ? nextRemainingMs : null,
      visualDurationMs: Number(currentState?.durationMs || 0) + (addMinutes * 60 * 1000),
      visualElapsedMs: Number(currentState?.elapsedMs || 0),
      visualStartedAtMs: now
    };
    if (!setReminderState(modalIssueId, nextReminder)) return;
    setSelectedSeconds(Math.round(nextRemainingMs / 1000));
    updateRunningModal();
    showGameToast(`⏱ Added ${formatTimerMinutes(addMinutes)}.`);
    renderIssues();
  }

  function pauseIssueReminder(issueId) {
    if (!issueId) return false;
    const current = reminderForIssue(issueId);
    const currentState = state(issueId);
    if (!current || currentState?.isPaused) return;
    const remainingMs = Math.max(0, Number(currentState?.remainingMs || 0));
    const now = Date.now();
    const nextReminder = {
      ...current,
      minutes: parseTimerMinutes(Math.max(remainingMs, 1000) / 60000),
      paused: true,
      pausedAtMs: now,
      pausedRemainingMs: remainingMs,
      visualDurationMs: Number(currentState?.durationMs || 0),
      visualElapsedMs: Number(currentState?.elapsedMs || 0),
      visualStartedAtMs: now
    };
    if (!setReminderState(issueId, nextReminder)) return false;
    showGameToast('⏸ Timer paused.');
    renderIssues();
    return true;
  }

  function pauseFromModal() {
    if (!pauseIssueReminder(modalIssueId)) return;
    updateRunningModal();
  }

  function resumeIssueReminder(issueId) {
    if (!issueId) return false;
    const current = reminderForIssue(issueId);
    const currentState = state(issueId);
    if (!current || !currentState?.isPaused) return;
    const now = Date.now();
    const remainingMs = Math.max(1000, Number(currentState.remainingMs || current.pausedRemainingMs || 0));
    const nextReminder = {
      minutes: parseTimerMinutes(remainingMs / 60000),
      setAt: now,
      dueAt: now + remainingMs,
      paused: false,
      pausedAtMs: null,
      pausedRemainingMs: null,
      visualDurationMs: Number(currentState?.durationMs || 0),
      visualElapsedMs: Number(currentState?.elapsedMs || 0),
      visualStartedAtMs: now
    };
    if (!setReminderState(issueId, nextReminder)) return false;
    showGameToast('▶ Timer resumed.');
    renderIssues();
    return true;
  }

  function resumeFromModal() {
    if (!resumeIssueReminder(modalIssueId)) return;
    updateRunningModal();
  }

  function setFromModalCustom() {
    const total = parseTimerMinutes(selectedSeconds / 60);
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

  function dismissOverdueFromCard(issueId) {
    const reminderState = state(issueId);
    if (!reminderState?.isOverdue) return;
    clear(issueId);
    showGameToast('✓ Alarm dismissed.', 'success');
    renderIssues();
  }

  function handleBadgeAction(issueId) {
    const reminderState = state(issueId);
    if (!reminderState) return;
    if (reminderState.isOverdue) return dismissOverdueFromCard(issueId);
    if (reminderState.isPaused) return resumeIssueReminder(issueId);
    return pauseIssueReminder(issueId);
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
        if (isDemoMode) {
          // Bypassed in demo mode to prevent permission error
          issue.highPriority = true;
          issue.priority = 'critical';
          renderIssues();
          showGameToast(`🚨 Hot: Press ${issue.machine || 'Unknown'}`);
          return;
        }
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
    document.querySelectorAll('[data-reminder-card-id]').forEach(card => {
      const issueId = card.getAttribute('data-reminder-card-id');
      if (!issueId) return;
      const reminderState = state(issueId);
      const showProgress = !!reminderState && !reminderState.isPaused && !reminderState.isOverdue;
      const showPausedProgress = !!reminderState && reminderState.isPaused;
      card.classList.toggle('timer-progress', showProgress);
      card.classList.toggle('timer-paused-progress', showPausedProgress);
      card.classList.toggle('timer-overdue', !!reminderState?.isOverdue);
      if (showProgress || showPausedProgress) {
        card.style.setProperty('--timer-progress', String(reminderState.elapsedProgress));
      } else {
        card.style.removeProperty('--timer-progress');
      }
    });

    document.querySelectorAll('[data-reminder-quick-id]').forEach(button => {
      const issueId = button.getAttribute('data-reminder-quick-id');
      if (!issueId) return;
      const reminderState = state(issueId);
      const showProgress = !!reminderState && !reminderState.isPaused && !reminderState.isOverdue;
      const showPausedProgress = !!reminderState && reminderState.isPaused;
      button.classList.toggle('timer-progress', showProgress);
      button.classList.toggle('timer-paused-progress', showPausedProgress);
      button.classList.toggle('timer-overdue', !!reminderState?.isOverdue);
      button.classList.toggle('paused', !!reminderState?.isPaused);
      if (showProgress || showPausedProgress) button.style.setProperty('--timer-progress', String(reminderState.elapsedProgress));
      else button.style.removeProperty('--timer-progress');
    });

    document.querySelectorAll('[data-reminder-id]').forEach(el => {
      const issueId = el.getAttribute('data-reminder-id');
      if (!issueId) return;
      const reminderState = state(issueId);
      if (!reminderState) {
        // Clear text or set to Off
        const isButtonTime = el.classList.contains('issue-reminder-time');
        el.textContent = isButtonTime ? 'Off' : '';
        
        // Hide parent badge if it exists
        const badge = el.closest('.timer-mini-badge');
        if (badge) {
          badge.style.display = 'none';
          badge.classList.remove('paused');
        }
        
        // Update button style/label if it is in the footer
        const btn = el.closest('.issue-reminder-btn');
        if (btn) {
          btn.classList.add('inactive');
          btn.classList.remove('overdue');
          btn.classList.remove('paused');
          const label = btn.querySelector('.issue-reminder-label');
          if (label) label.textContent = 'Timer';
        }
        return;
      }
      
      el.textContent = formatClock(reminderState);
      
      // Ensure badge is visible and has correct class if it exists
      const badge = el.closest('.timer-mini-badge');
      if (badge) {
        badge.style.display = '';
        badge.classList.toggle('overdue', !!reminderState.isOverdue);
        badge.classList.toggle('paused', !!reminderState.isPaused);
        if (badge.matches('button')) {
          const label = reminderState.isOverdue ? 'Dismiss expired alarm' : reminderState.isPaused ? 'Resume timer' : 'Pause timer';
          badge.title = label;
          badge.setAttribute('aria-label', label);
        }
      }
      
      // Ensure button has correct active classes/labels if in footer
      const btn = el.closest('.issue-reminder-btn');
      if (btn) {
        btn.classList.remove('inactive');
        btn.classList.toggle('overdue', !!reminderState.isOverdue);
        btn.classList.toggle('paused', !!reminderState.isPaused);
        const label = btn.querySelector('.issue-reminder-label');
        if (label) {
          label.textContent = reminderState.isPaused ? 'Paused' : (reminderState.isOverdue ? 'Dismiss alarm' : 'Check back');
        }
      }
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
    addTimeFromModal,
    pauseFromModal,
    resumeFromModal,
    handleBadgeAction,
    clearFromModal,
    setFromCard,
    setQuick,
    clearFromCard,
    dismissOverdueFromCard,
    maybeNotify,
    refreshClocksInDom
  };
}
