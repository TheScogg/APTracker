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

  function updateTimerPreview() {
    const preview = document.getElementById('issue-reminder-preview');
    if (!preview) return;
    preview.textContent = formatSelectedClock(selectedSeconds);
    preview.classList.toggle('empty', selectedSeconds <= 0);
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
    const minutes = Math.max(0, Number(current?.minutes || 0));
    const totalSeconds = Math.round(minutes * 60);
    bindScrubber();
    setSelectedSeconds(totalSeconds);
    const sub = document.getElementById('issue-reminder-modal-subtitle');
    if (sub) sub.textContent = `Press ${issue.machine || 'Unknown'} • pick a timer`;
    const clearBtn = document.getElementById('issue-reminder-clear-btn');
    if (clearBtn) clearBtn.style.display = current ? '' : 'none';
    document.getElementById('issue-reminder-modal')?.classList.add('visible');
    requestAnimationFrame(() => document.getElementById('issue-reminder-scrubber')?.focus());
  }

  function closeModal() {
    document.getElementById('issue-reminder-modal')?.classList.remove('visible');
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
        }
        
        // Update button style/label if it is in the footer
        const btn = el.closest('.issue-reminder-btn');
        if (btn) {
          btn.classList.add('inactive');
          btn.classList.remove('overdue');
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
      }
      
      // Ensure button has correct active classes/labels if in footer
      const btn = el.closest('.issue-reminder-btn');
      if (btn) {
        btn.classList.remove('inactive');
        btn.classList.toggle('overdue', !!reminderState.isOverdue);
        const label = btn.querySelector('.issue-reminder-label');
        if (label) {
          label.textContent = reminderState.isOverdue ? 'Check now' : 'Check back';
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
    clearFromModal,
    setFromCard,
    setQuick,
    clearFromCard,
    maybeNotify,
    refreshClocksInDom
  };
}
