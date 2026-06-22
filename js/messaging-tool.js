export function initMessagingTool(deps) {
  const {
    getCurrentUser, getCurrentPlantId, NO_AUTH_MODE, esc, _relativeTime,
    showGameToast, completeDemoGuideStep, readFileAsDataUrl,
    _bindToolModalShellNavigation, shouldUseSqlStagingReads, requireSqlRead, dataApi,
    collection, getDocs, onSnapshot, query, where, orderBy, serverTimestamp,
    conversationsCol, uploadAttachmentToPreferredStorage,
    registerFcmToken,
    db
  } = deps;

  let _messagingInboxUnsubscribe = null;
  let _messagingInboxPollTimer = null;
  let _msgSearchTimer = null;

  const _messagingState = {
    conversations: [],
    activeConversationId: null,
    selectedPhoto: null,
    lastSeenByConversation: {},
    tab: 'all',
    search: '',
    selectableMembers: [],
    selectedDmUid: null,
    selectedGroupMembers: new Set()
  };

  function _updateMessagingEntryBadges(unreadCount = 0) {
    const safeCount = Math.max(0, Number(unreadCount) || 0);
    document.querySelectorAll('[data-messages-trigger]').forEach(el => {
      el.classList.toggle('messages-has-unread', safeCount > 0);
    });
    document.querySelectorAll('[data-messages-badge]').forEach(el => {
      if (!safeCount) {
        el.style.display = 'none';
        el.textContent = '0';
        return;
      }
      el.style.display = 'inline-flex';
      el.textContent = safeCount > 99 ? '99+' : String(safeCount);
    });
  }

  function _messagingUnreadTotal(conversations = []) {
    return (conversations || []).reduce((sum, conv) => sum + (_messagingUnreadCount(conv) ? 1 : 0), 0);
  }

  function startInboxWatcher() {
    if (_messagingInboxUnsubscribe) {
      _messagingInboxUnsubscribe();
      _messagingInboxUnsubscribe = null;
    }
    if (_messagingInboxPollTimer) {
      clearTimeout(_messagingInboxPollTimer);
      _messagingInboxPollTimer = null;
    }
    const user = getCurrentUser();
    const plantId = getCurrentPlantId();
    if (!plantId || !user?.uid) {
      _updateMessagingEntryBadges(0);
      return;
    }
    if (shouldUseSqlStagingReads(plantId)) {
      let active = true;
      _messagingInboxUnsubscribe = () => {
        active = false;
        if (_messagingInboxPollTimer) {
          clearTimeout(_messagingInboxPollTimer);
          _messagingInboxPollTimer = null;
        }
        _messagingInboxUnsubscribe = null;
      };
      const poll = async () => {
        if (!active || !getCurrentPlantId() || !getCurrentUser()?.uid) return;
        try {
          const payload = await requireSqlRead(
            `messaging inbox ${plantId}`,
            () => dataApi.listConversations(plantId),
            `Messaging inbox is missing in D1 for plant ${plantId}.`
          );
          const conversations = payload?.conversations || [];
          const unreadCount = _messagingUnreadTotal(conversations);
          _updateMessagingEntryBadges(unreadCount);
          const tabBadge = document.getElementById('messaging-tab-all-badge');
          if (tabBadge) {
            tabBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
            tabBadge.style.display = unreadCount ? 'inline-flex' : 'none';
          }
        } catch (err) {
          console.warn('messaging inbox poll error', err);
          _updateMessagingEntryBadges(0);
        }
        if (active) _messagingInboxPollTimer = setTimeout(poll, 5000);
      };
      void poll();
      return;
    }
    const q = query(
      conversationsCol(),
      where('memberIds', 'array-contains', user.uid),
      orderBy('lastMessageAt', 'desc')
    );
    _messagingInboxUnsubscribe = onSnapshot(q, snap => {
      const conversations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const unreadCount = _messagingUnreadTotal(conversations);
      _updateMessagingEntryBadges(unreadCount);
      const tabBadge = document.getElementById('messaging-tab-all-badge');
      if (tabBadge) {
        tabBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        tabBadge.style.display = unreadCount ? 'inline-flex' : 'none';
      }
    }, err => {
      console.warn('messaging inbox watcher error', err);
      _updateMessagingEntryBadges(0);
    });
  }

  function stopInboxWatcher() {
    if (_messagingInboxUnsubscribe) {
      _messagingInboxUnsubscribe();
      _messagingInboxUnsubscribe = null;
    }
    if (_messagingInboxPollTimer) {
      clearTimeout(_messagingInboxPollTimer);
      _messagingInboxPollTimer = null;
    }
    _updateMessagingEntryBadges(0);
  }

  function bindKeyboardShortcut() {
    if (window.__messagingShortcutBound) return;
    window.__messagingShortcutBound = true;
    document.addEventListener('keydown', e => {
      const target = e.target;
      const typing = !!(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
      if (typing) return;
      const openShortcut = (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey));
      if (!openShortcut) return;
      e.preventDefault();
      openMessagingModal();
      setTimeout(() => document.getElementById('messaging-search')?.focus(), 30);
    });
  }

  function _messagingSetError(message = '') {
    const el = document.getElementById('messaging-error');
    if (el) el.textContent = message;
  }

  function _messagingUserLabel(member = {}) {
    return member.displayName || member.name || member.email || member.uid || 'User';
  }

  function _messagingUserPhoto(member = {}) {
    return member.photoURL || member.photoUrl || member.avatarUrl || member.avatarURL || member.picture || '';
  }

  function _messagingInitials(name = '') {
    return String(name || 'U').split(' ').filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase();
  }

  function _messagingColor(seed = '') {
    const palette = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE', '#5AC8FA', '#FF2D55', '#00C7BE'];
    const idx = String(seed).split('').reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length;
    return palette[idx];
  }

  function _fmtMsgTime(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts?.seconds ? ts.seconds * 1000 : ts);
    if (Number.isNaN(+d)) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function _fmtMsgDateSep(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts?.seconds ? ts.seconds * 1000 : ts);
    const now = new Date();
    const diffDays = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function setPhotoPreview(file = null) {
    _messagingState.selectedPhoto = file || null;
    const wrap = document.getElementById('messaging-photo-preview');
    if (!wrap) return;
    if (!file) {
      wrap.innerHTML = '';
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    wrap.innerHTML = `<div class="msg-reaction" style="display:inline-flex;margin:8px 0;">\u{1F4F7} ${esc(file.name || 'image')}</div><img src="${objectUrl}" alt="selected photo preview" style="max-width:180px;border-radius:10px;border:1px solid var(--color-border, var(--border));margin-top:6px;">`;
  }

  function _messagingNotifyIncoming(message, conversationName) {
    showGameToast(`\u{1F4AC} ${conversationName}: ${(message?.sender?.name || 'Someone')} sent a message`);
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification(conversationName, {
        body: message.text || (message.attachments?.length ? 'Sent a photo' : 'New message')
      });
    } catch (e) {
      console.warn('Notification failed', e);
    }
  }

  function _messagingMemberByUid(uid) {
    if (!uid) return null;
    const user = getCurrentUser();
    if (uid === user?.uid) {
      return {
        uid,
        displayName: user?.displayName || user?.email || 'You',
        email: user?.email || '',
        photoURL: user?.photoURL || ''
      };
    }
    return _messagingState.selectableMembers.find(m => m.uid === uid) || null;
  }

  function _messagingPersonAvatar(member = {}, size = 40) {
    const label = _messagingUserLabel(member);
    const photo = _messagingUserPhoto(member);
    if (photo) {
      return `<div class="msg-avatar" style="position:relative;"><img class="msg-avatar-img" src="${esc(photo)}" alt="${esc(label)}" style="width:${size}px;height:${size}px;border-radius:50%;"></div>`;
    }
    return `<div class="msg-avatar" style="position:relative;"><div class="msg-avatar-initials" style="background:${_messagingColor(member.uid || label)};width:${size}px;height:${size}px;">${esc(_messagingInitials(label))}</div></div>`;
  }

  function _messagingConversationName(conv) {
    if (!conv) return 'Conversation';
    const user = getCurrentUser();
    if (conv.type === 'dm') {
      const otherUid = (conv.memberIds || []).find(uid => uid !== user?.uid);
      const other = _messagingMemberByUid(otherUid);
      return _messagingUserLabel(other || { uid: otherUid, name: conv.title || 'Direct Message' });
    }
    if (conv.type === 'press') return conv.title || `Press ${conv.pressId || ''}`.trim() || 'Press Chat';
    return conv.title || 'Group Chat';
  }

  function _messagingFilteredConversations() {
    const tab = _messagingState.tab;
    const q = String(_messagingState.search || '').trim().toLowerCase();
    const sorted = [..._messagingState.conversations].sort((a, b) => {
      const at = a.lastMessageAt?.toMillis?.() ?? a.lastMessageAt?.seconds * 1000 ?? (a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0);
      const bt = b.lastMessageAt?.toMillis?.() ?? b.lastMessageAt?.seconds * 1000 ?? (b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0);
      return bt - at;
    });
    return sorted.filter(conv => {
      if (tab === 'dms' && conv.type !== 'dm') return false;
      if (tab === 'groups' && conv.type === 'dm') return false;
      if (!q) return true;
      const name = _messagingConversationName(conv).toLowerCase();
      const preview = String(conv.lastMessage?.textPreview || '').toLowerCase();
      return name.includes(q) || preview.includes(q);
    });
  }

  function _messagingUnreadCount(conv) {
    const user = getCurrentUser();
    const lastId = conv?.lastMessage?.id;
    const lastSenderUid = conv?.lastMessage?.sender?.uid || conv?.lastMessage?.senderUid;
    if (!lastId || !lastSenderUid || lastSenderUid === user?.uid) return 0;
    const lastReadId = conv?.myMembership?.lastReadMessageId || _messagingState.lastSeenByConversation[conv.id] || null;
    return lastReadId === lastId ? 0 : 1;
  }

  function _messagingAvatarHtml(conv, size = 40) {
    const user = getCurrentUser();
    if (!conv) return '';
    if (conv.type !== 'dm') {
      const others = (conv.memberIds || []).filter(uid => uid !== user?.uid).slice(0, 4);
      const cells = others.map(uid => {
        const m = _messagingMemberByUid(uid);
        const label = _messagingUserLabel(m || { uid });
        const photo = _messagingUserPhoto(m || {});
        if (photo) {
          return `<div class="msg-group-avatar-cell" style="padding:0;overflow:hidden;background:var(--bg4);"><img src="${esc(photo)}" alt="${esc(label)}" style="width:100%;height:100%;object-fit:cover;"></div>`;
        }
        return `<div class="msg-group-avatar-cell" style="background:${_messagingColor(uid)}">${esc(_messagingInitials(label))}</div>`;
      }).join('');
      return `<div class="msg-group-avatar" style="width:${size}px;height:${size}px;">${cells || '<div class="msg-group-avatar-cell" style="grid-column:1/3;background:var(--bg4)">GR</div>'}</div>`;
    }
    const otherUid = (conv.memberIds || []).find(uid => uid !== user?.uid);
    const other = _messagingMemberByUid(otherUid) || { uid: otherUid, name: 'User' };
    return _messagingPersonAvatar(other, size);
  }

  function _renderMessagingConversations() {
    const list = document.getElementById('messaging-conversations-list');
    if (!list) return;
    const conversations = _messagingFilteredConversations();
    if (!conversations.length) {
      list.innerHTML = '<div class="msg-empty"><div class="msg-empty-icon">\u{1F4AC}</div><div class="msg-empty-text">No conversations yet.</div></div>';
      return;
    }
    list.innerHTML = conversations.map(conv => {
      const unread = _messagingUnreadCount(conv);
      const isActive = conv.id === _messagingState.activeConversationId;
      const name = _messagingConversationName(conv);
      const preview = conv.lastMessage?.textPreview || 'No messages yet';
      const time = conv.lastMessageAt ? _relativeTime(conv.lastMessageAt) : '';
      return `<div class="msg-convo-row ${isActive ? 'active' : ''}" data-convo-id="${esc(conv.id)}">
        ${_messagingAvatarHtml(conv)}
        <div class="msg-convo-info">
          <div class="msg-convo-name-row">
            <span class="msg-convo-name">${esc(name)}</span>
            <span class="msg-convo-time">${esc(time)}</span>
          </div>
          <div class="msg-convo-preview ${unread ? 'unread' : ''}">${esc(preview)}</div>
        </div>
        ${unread ? '<div class="msg-unread-dot"></div>' : ''}
      </div>`;
    }).join('');

    list.querySelectorAll('.msg-convo-row').forEach(row => {
      row.addEventListener('click', () => {
        const convoId = row.getAttribute('data-convo-id');
        if (convoId) _selectMessagingConversation(convoId);
        if (window.innerWidth <= 600) document.getElementById('msg-list-panel')?.classList.add('hidden');
      });
    });
  }

  function _renderMessagingThreadHeader(conv) {
    const title = document.getElementById('messaging-thread-title');
    const sub = document.getElementById('messaging-thread-sub');
    const avatar = document.getElementById('messaging-thread-avatar');
    const header = document.getElementById('messaging-thread-header');
    if (!title || !sub || !avatar || !header) return;
    if (!conv) {
      header.style.display = 'none';
      title.textContent = 'Select a conversation';
      sub.textContent = '';
      avatar.innerHTML = '';
      return;
    }
    header.style.display = 'flex';
    title.textContent = _messagingConversationName(conv);
    const memberCount = Array.isArray(conv.memberIds) ? conv.memberIds.length : 0;
    sub.textContent = conv.type === 'dm' ? 'Direct message' : `${memberCount} members`;
    avatar.innerHTML = _messagingAvatarHtml(conv, 36);
  }

  function _renderMessagingMessages(messages) {
    const panel = document.getElementById('messaging-thread-messages');
    if (!panel) return;
    if (!messages.length) {
      panel.innerHTML = '<div class="msg-empty"><div class="msg-empty-icon">\u{1F4AC}</div><div class="msg-empty-text">No messages yet. Start the conversation.</div></div>';
      return;
    }
    const user = getCurrentUser();
    const convo = _messagingState.conversations.find(c => c.id === _messagingState.activeConversationId);
    let prevDate = '';
    const html = [];
    messages.forEach(msg => {
      const dt = msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date(msg.createdAt?.seconds ? msg.createdAt.seconds * 1000 : msg.createdAt);
      const dateKey = dt.toDateString();
      if (dateKey !== prevDate) {
        html.push(`<div class="msg-date-sep">${esc(_fmtMsgDateSep(msg.createdAt))}</div>`);
        prevDate = dateKey;
      }
      const mine = msg.sender?.uid === user?.uid;
      const senderName = mine ? 'You' : (msg.sender?.name || _messagingUserLabel(_messagingMemberByUid(msg.sender?.uid) || {}));
      const avatar = mine ? '' : `<div class="msg-row-avatar">${_messagingAvatarHtml({ type: 'dm', memberIds: [user?.uid, msg.sender?.uid] }, 28)}</div>`;
      const attachments = (msg.attachments || []).filter(att => att.kind === 'image' && att.url)
        .map(att => `<img class="messaging-msg-image" src="${esc(att.url)}" alt="${esc(att.fileName || 'image')}" style="max-width:200px;border-radius:10px;border:1px solid var(--color-border, var(--border));margin-top:4px;">`).join('');
      html.push(`<div class="msg-row ${mine ? 'sent' : 'recv'}">
        ${avatar}
        <div class="msg-bubble-group">
          ${(!mine && convo?.type !== 'dm') ? `<div class="msg-sender-name">${esc(senderName)}</div>` : ''}
          <div class="msg-bubble-wrap">
            <div class="msg-bubble ${mine ? 'sent' : 'recv'}">${esc(msg.text || '')}</div>
            ${attachments}
          </div>
          <div class="msg-bubble-time">${esc(_fmtMsgTime(msg.createdAt))}</div>
        </div>
      </div>`);
    });
    panel.innerHTML = html.join('');
    panel.scrollTop = panel.scrollHeight;
  }

  function _selectMessagingConversation(conversationId) {
    const user = getCurrentUser();
    _messagingState.activeConversationId = conversationId;
    const selected = _messagingState.conversations.find(c => c.id === conversationId);
    _renderMessagingConversations();
    _renderMessagingThreadHeader(selected);
    window.openConversation(conversationId, messages => {
      _renderMessagingMessages(messages);
      const lastMessage = messages[messages.length - 1] || null;
      const lastId = lastMessage?.id || null;
      const seenId = _messagingState.lastSeenByConversation[conversationId] || null;
      if (lastMessage && seenId && lastMessage.id !== seenId && lastMessage.sender?.uid !== user?.uid) {
        _messagingNotifyIncoming(lastMessage, _messagingConversationName(selected));
      }
      if (lastMessage) _messagingState.lastSeenByConversation[conversationId] = lastMessage.id;
      if (lastId && lastId !== seenId) {
        window.markConversationRead(conversationId, lastId).catch(err => console.warn('markConversationRead failed', err));
      }
    });
  }

  function _renderMessagingMemberPicks() {
    const dmWrap = document.getElementById('messaging-dm-list');
    const groupWrap = document.getElementById('messaging-group-members');
    if (dmWrap) {
      dmWrap.innerHTML = _messagingState.selectableMembers.map(m => {
        const label = _messagingUserLabel(m);
        const checked = _messagingState.selectedDmUid === m.uid;
        return `<div class="msg-member-row ${checked ? 'selected' : ''}" data-dm-uid="${esc(m.uid)}">
          ${_messagingPersonAvatar(m, 36)}
          <div style="font-size:14px;font-weight:600;">${esc(label)}</div>
          <div class="msg-member-check">${checked ? '\u2713' : ''}</div>
        </div>`;
      }).join('');
      dmWrap.querySelectorAll('[data-dm-uid]').forEach(row => {
        row.addEventListener('click', () => {
          _messagingState.selectedDmUid = row.getAttribute('data-dm-uid');
          _renderMessagingMemberPicks();
        });
      });
    }

    if (groupWrap) {
      groupWrap.innerHTML = _messagingState.selectableMembers.map(m => {
        const label = _messagingUserLabel(m);
        const checked = _messagingState.selectedGroupMembers.has(m.uid);
        return `<div class="msg-member-row ${checked ? 'selected' : ''}" data-group-uid="${esc(m.uid)}">
          ${_messagingPersonAvatar(m, 36)}
          <div style="font-size:14px;font-weight:600;">${esc(label)}</div>
          <div class="msg-member-check">${checked ? '\u2713' : ''}</div>
        </div>`;
      }).join('');
      groupWrap.querySelectorAll('[data-group-uid]').forEach(row => {
        row.addEventListener('click', () => {
          const uid = row.getAttribute('data-group-uid');
          if (_messagingState.selectedGroupMembers.has(uid)) _messagingState.selectedGroupMembers.delete(uid);
          else _messagingState.selectedGroupMembers.add(uid);
          _renderMessagingMemberPicks();
        });
      });
    }

    document.getElementById('messaging-create-dm-btn').disabled = !_messagingState.selectedDmUid;
    const groupName = String(document.getElementById('messaging-group-name')?.value || '').trim();
    document.getElementById('messaging-create-group-btn').disabled = !groupName || _messagingState.selectedGroupMembers.size < 1;
  }

  async function _messagingSelectableMembers() {
    const user = getCurrentUser();
    const plantId = getCurrentPlantId();
    if (NO_AUTH_MODE || !plantId || !user?.uid) return [];
    if (shouldUseSqlStagingReads(plantId)) {
      const payload = await requireSqlRead(
        `messaging members ${plantId}`,
        () => dataApi.listPlantMembers(plantId, { active: true }),
        `Messaging members are missing in D1 for plant ${plantId}.`
      );
      return (payload?.members || [])
        .filter(m => m.uid !== user.uid && m.isActive !== false)
        .sort((a, b) => String(_messagingUserLabel(a)).localeCompare(String(_messagingUserLabel(b))));
    }
    const membersSnap = await getDocs(collection(db, 'plants', plantId, 'members'));
    return membersSnap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(m => m.uid !== user.uid && m.isActive !== false)
      .sort((a, b) => String(_messagingUserLabel(a)).localeCompare(String(_messagingUserLabel(b))));
  }

  async function _messagingLoadMemberSelectors({ preserveSelection = false } = {}) {
    _messagingState.selectableMembers = await _messagingSelectableMembers();
    if (!preserveSelection) {
      _messagingState.selectedDmUid = null;
      _messagingState.selectedGroupMembers = new Set();
    }
    _renderMessagingMemberPicks();
  }

  function openMessagingModal(options = {}) {
    const preserveState = !!options.preserveState;
    const user = getCurrentUser();
    const plantId = getCurrentPlantId();
    _bindToolModalShellNavigation();
    const modal = document.getElementById('messaging-modal');
    if (modal) modal.classList.add('visible');
    document.body.classList.add('messaging-open');
    completeDemoGuideStep('tools');
    _messagingSetError('');
    if (!preserveState) setPhotoPreview(null);
    document.getElementById('msg-list-panel')?.classList.remove('hidden');
    if (NO_AUTH_MODE || !plantId || !user?.uid) {
      _messagingState.conversations = [];
      _messagingState.activeConversationId = null;
      _messagingState.selectableMembers = [];
      _renderMessagingConversations();
      _renderMessagingThreadHeader(null);
      const panel = document.getElementById('messaging-thread-messages');
      if (panel) panel.innerHTML = '<div class="msg-empty"><div class="msg-empty-icon">\u{1F4AC}</div><div class="msg-empty-text">Messaging is disabled until a plant and signed-in user are available.</div></div>';
      _messagingSetError('Messaging is disabled in no-auth mode.');
      return;
    }
    _messagingLoadMemberSelectors({ preserveSelection: preserveState }).catch(err => {
      console.warn('messaging member load failed', err);
      _messagingSetError(`Could not load members: ${err?.message || 'permission denied'}`);
    });

    const panel = document.getElementById('messaging-thread-messages');
    if (panel) panel.innerHTML = '<div class="msg-empty"><div class="msg-empty-text">Loading\u2026</div></div>';

    window.watchConversations(conversations => {
      _messagingState.conversations = conversations;
      conversations.forEach(conv => {
        const lastReadMessageId = conv?.myMembership?.lastReadMessageId || null;
        if (lastReadMessageId) _messagingState.lastSeenByConversation[conv.id] = lastReadMessageId;
      });
      const stillExists = conversations.some(c => c.id === _messagingState.activeConversationId);
      if (!stillExists) _messagingState.activeConversationId = conversations[0]?.id || null;
      _renderMessagingConversations();
      if (_messagingState.activeConversationId) {
        _selectMessagingConversation(_messagingState.activeConversationId);
      } else {
        _renderMessagingThreadHeader(null);
        if (panel) panel.innerHTML = '<div class="msg-empty"><div class="msg-empty-icon">\u{1F4AC}</div><div class="msg-empty-text">Create a conversation to begin messaging.</div></div>';
      }
    }, {}, err => {
      _messagingSetError(`Could not load conversations: ${err?.message || 'permission denied'}`);
      _renderMessagingThreadHeader(null);
      if (panel) panel.innerHTML = '<div class="msg-empty"><div class="msg-empty-text">Conversation access is currently denied.</div></div>';
    });
  }

  function closeMessagingModal(options = {}) {
    if (_msgSearchTimer) { clearTimeout(_msgSearchTimer); _msgSearchTimer = null; }
    document.getElementById('messaging-modal')?.classList.remove('visible');
    document.body.classList.remove('messaging-open');
    hideSheets();
    if (!options.preserveState) {
      setPhotoPreview(null);
    }
    window.closeConversation();
    window.closeConversationList();
  }

  async function sendMessage() {
    const ta = document.getElementById('messaging-input');
    const text = String(ta?.value || '').trim();
    if (!text && !_messagingState.selectedPhoto) return;
    if (!_messagingState.activeConversationId) {
      _messagingSetError('Select or create a conversation first.');
      return;
    }
    try {
      _messagingSetError('');
      let attachments = [];
      if (_messagingState.selectedPhoto) {
        const photo = await _uploadMessagingPhoto(_messagingState.selectedPhoto, _messagingState.activeConversationId);
        attachments = [photo];
      }
      await window.sendConversationMessage(_messagingState.activeConversationId, text || '', { attachments });
      if (ta) {
        ta.value = '';
        ta.style.height = 'auto';
      }
      setPhotoPreview(null);
    } catch (err) {
      console.warn('sendMessagingModalMessage failed', err);
      _messagingSetError(`Could not send message: ${err?.message || 'permission denied'}`);
    }
  }

  async function createDm() {
    const user = getCurrentUser();
    const plantId = getCurrentPlantId();
    _messagingSetError('');
    if (!plantId || !user?.uid) {
      _messagingSetError('Sign in and select a plant before creating a DM.');
      return;
    }
    if (!_messagingState.selectedDmUid) {
      _messagingSetError('Select someone to message.');
      return;
    }
    try {
      const conversationId = await window.createConversation({ type: 'dm', memberIds: [_messagingState.selectedDmUid] });
      hideSheets();
      _messagingState.activeConversationId = conversationId;
      _selectMessagingConversation(conversationId);
    } catch (err) {
      console.warn('createMessagingDm failed', err);
      _messagingSetError(`Could not create DM: ${err?.message || 'permission denied'}`);
    }
  }

  async function createGroup() {
    const user = getCurrentUser();
    const plantId = getCurrentPlantId();
    _messagingSetError('');
    if (!plantId || !user?.uid) {
      _messagingSetError('Sign in and select a plant before creating a group.');
      return;
    }
    const groupTitle = String(document.getElementById('messaging-group-name')?.value || '').trim();
    const memberIds = Array.from(_messagingState.selectedGroupMembers);
    if (!groupTitle) {
      _messagingSetError('Enter a group name.');
      return;
    }
    if (!memberIds.length) {
      _messagingSetError('Select at least one member for the group.');
      return;
    }
    try {
      const conversationId = await window.createConversation({ type: 'group', title: groupTitle, memberIds });
      document.getElementById('messaging-group-name').value = '';
      hideSheets();
      _messagingState.activeConversationId = conversationId;
      _selectMessagingConversation(conversationId);
    } catch (err) {
      console.warn('createMessagingGroup failed', err);
      _messagingSetError(`Could not create group: ${err?.message || 'permission denied'}`);
    }
  }

  function showNewDm() {
    const sheet = document.getElementById('messaging-new-dm');
    if (sheet) sheet.classList.add('visible');
    document.getElementById('messaging-new-group')?.classList.remove('visible');
    _renderMessagingMemberPicks();
  }

  function showNewGroup() {
    const sheet = document.getElementById('messaging-new-group');
    if (sheet) sheet.classList.add('visible');
    document.getElementById('messaging-new-dm')?.classList.remove('visible');
    _renderMessagingMemberPicks();
  }

  function hideSheets() {
    const dm = document.getElementById('messaging-new-dm');
    const group = document.getElementById('messaging-new-group');
    if (dm) dm.classList.remove('visible');
    if (group) group.classList.remove('visible');
  }

  async function enableNotifications() {
    try {
      await registerFcmToken({ requestPermission: true });
      _messagingSetError('');
      showGameToast('\u{1F514} Push alerts enabled');
    } catch (err) {
      _messagingSetError(err?.message || 'Notification permission was not granted.');
    }
  }

  async function _uploadMessagingPhoto(file, conversationId) {
    const plantId = getCurrentPlantId();
    const dataUrl = await readFileAsDataUrl(file);
    const uploaded = await uploadAttachmentToPreferredStorage(plantId, {
      scope: 'conversation',
      conversationId,
      fileName: file.name || 'image.jpg',
      contentType: file.type || 'image/jpeg',
      dataUrl
    });
    return {
      kind: 'image',
      url: uploaded.downloadUrl || uploaded.url || '',
      storagePath: uploaded.storagePath,
      storageBucket: uploaded.storageBucket || 'r2',
      fileName: uploaded.fileName || file.name || 'image.jpg',
      contentType: uploaded.contentType || file.type || 'image/jpeg',
      sizeBytes: Number(uploaded.sizeBytes || file.size || 0)
    };
  }

  function bindEvents() {
    document.getElementById('messaging-modal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('messaging-modal')) closeMessagingModal();
    });

    document.getElementById('messaging-new-dm')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) hideSheets();
    });

    document.getElementById('messaging-new-group')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) hideSheets();
    });

    document.getElementById('messaging-create-dm-btn')?.addEventListener('click', () => createDm());
    document.getElementById('messaging-create-group-btn')?.addEventListener('click', () => createGroup());

    document.getElementById('messaging-tabs')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      _messagingState.tab = btn.getAttribute('data-tab') || 'all';
      document.querySelectorAll('#messaging-tabs .msg-tab').forEach(tabBtn => tabBtn.classList.toggle('active', tabBtn === btn));
      _renderMessagingConversations();
    });

    document.getElementById('messaging-search')?.addEventListener('input', e => {
      _messagingState.search = e.target.value || '';
      if (_msgSearchTimer) clearTimeout(_msgSearchTimer);
      _msgSearchTimer = setTimeout(() => {
        _msgSearchTimer = null;
        _renderMessagingConversations();
      }, 150);
    });

    document.getElementById('messaging-back-btn')?.addEventListener('click', () => {
      document.getElementById('msg-list-panel')?.classList.remove('hidden');
    });

    document.getElementById('messaging-group-name')?.addEventListener('input', () => _renderMessagingMemberPicks());

    document.getElementById('messaging-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    document.getElementById('messaging-input')?.addEventListener('input', e => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
    });

    document.getElementById('messaging-photo-input')?.addEventListener('change', e => {
      const file = e.target?.files?.[0] || null;
      setPhotoPreview(file);
    });
  }

  bindEvents();

  return {
    open: openMessagingModal,
    close: closeMessagingModal,
    sendMessage,
    createDm,
    createGroup,
    showNewDm,
    showNewGroup,
    hideSheets,
    enableNotifications,
    setPhotoPreview,
    startInboxWatcher,
    stopInboxWatcher,
    updateBadges: _updateMessagingEntryBadges,
    bindKeyboardShortcut,
    hasState: () => {
      return Boolean(
        _messagingState.conversations.length ||
        _messagingState.activeConversationId ||
        _messagingState.selectedPhoto ||
        _messagingState.selectedDmUid ||
        _messagingState.selectedGroupMembers?.size
      );
    },
    state: _messagingState
  };
}
