export const DATA_BACKEND_FIREBASE = 'firebase';
export const DATA_BACKEND_SQL = 'sql';

export function selectedDataBackend() {
  const explicit = String(window.AP_TRACKER_DATA_BACKEND || '').trim().toLowerCase();
  if (explicit === DATA_BACKEND_SQL || explicit === DATA_BACKEND_FIREBASE) return explicit;
  const params = new URLSearchParams(window.location.search || '');
  const fromQuery = String(params.get('dataBackend') || '').trim().toLowerCase();
  if (fromQuery === DATA_BACKEND_SQL || fromQuery === DATA_BACKEND_FIREBASE) return fromQuery;
  return DATA_BACKEND_FIREBASE;
}

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status || 0;
    this.body = options.body;
  }
}

export class SqlDataApi {
  constructor({ baseUrl = '/api', getIdToken, fetchImpl = window.fetch.bind(window) } = {}) {
    this.baseUrl = String(baseUrl || '/api').replace(/\/+$/, '');
    this.getIdToken = getIdToken;
    this.fetchImpl = fetchImpl;
  }

  async request(path, options = {}) {
    const token = this.getIdToken ? await this.getIdToken() : '';
    const headers = {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...options,
      headers,
      body: options.body && typeof options.body !== 'string'
        ? JSON.stringify(options.body)
        : options.body
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new ApiError(body?.error || `API request failed with ${res.status}`, {
        status: res.status,
        body
      });
    }
    return body;
  }

  getCurrentUserContext() {
    return this.request('/me');
  }

  updateCurrentUserContext(patch) {
    return this.request('/me', {
      method: 'PATCH',
      body: patch
    });
  }

  listPlants(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/plants${suffix}`);
  }

  listPlantMembers(plantId, params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/plants/${encodeURIComponent(plantId)}/members${suffix}`);
  }

  updatePlantMember(plantId, uid, patch) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/members/${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      body: patch
    });
  }

  getStatusConfig(plantId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/status-config`);
  }

  updateStatusConfig(plantId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/status-config`, {
      method: 'PUT',
      body: payload
    });
  }

  getStoreConfig(plantId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/store-config`);
  }

  updateStoreConfig(plantId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/store-config`, {
      method: 'PUT',
      body: payload
    });
  }

  getRoleAlertRouting(plantId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/role-alert-routing`);
  }

  updateRoleAlertRouting(plantId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/role-alert-routing`, {
      method: 'PUT',
      body: payload
    });
  }

  getGamificationState(plantId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/gamification`);
  }

  awardGamification(plantId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/gamification/award`, {
      method: 'POST',
      body: payload
    });
  }

  loadPlantBootstrap(plantId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/bootstrap`);
  }

  getDailySchedule(plantId, scheduleDate) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/daily-schedules/${encodeURIComponent(scheduleDate)}`);
  }

  listIssues(plantId, params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/plants/${encodeURIComponent(plantId)}/issues${suffix}`);
  }

  deleteIssue(plantId, issueId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/issues/${encodeURIComponent(issueId)}`, {
      method: 'DELETE'
    });
  }

  getIssue(plantId, issueId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/issues/${encodeURIComponent(issueId)}`);
  }

  createIssue(plantId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/issues`, {
      method: 'POST',
      body: payload
    });
  }

  updateIssue(plantId, issueId, patch) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/issues/${encodeURIComponent(issueId)}`, {
      method: 'PATCH',
      body: patch
    });
  }

  listIssueEvents(plantId, issueId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/issues/${encodeURIComponent(issueId)}/events`);
  }

  appendIssueEvent(plantId, issueId, event) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/issues/${encodeURIComponent(issueId)}/events`, {
      method: 'POST',
      body: event
    });
  }

  listIssueAttachments(plantId, issueId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/issues/${encodeURIComponent(issueId)}/attachments`);
  }

  createIssueAttachment(plantId, issueId, attachment) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/issues/${encodeURIComponent(issueId)}/attachments`, {
      method: 'POST',
      body: attachment
    });
  }

  listNotes(plantId, params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/plants/${encodeURIComponent(plantId)}/notes${suffix}`);
  }

  createNote(plantId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/notes`, {
      method: 'POST',
      body: payload
    });
  }

  updateNote(plantId, noteId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/notes/${encodeURIComponent(noteId)}`, {
      method: 'PATCH',
      body: payload
    });
  }

  deleteNote(plantId, noteId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/notes/${encodeURIComponent(noteId)}`, {
      method: 'DELETE'
    });
  }

  listNoteAttachments(plantId, noteId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/notes/${encodeURIComponent(noteId)}/attachments`);
  }

  createNoteAttachment(plantId, noteId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/notes/${encodeURIComponent(noteId)}/attachments`, {
      method: 'POST',
      body: payload
    });
  }

  deleteNoteAttachment(plantId, noteId, attachmentId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/notes/${encodeURIComponent(noteId)}/attachments/${encodeURIComponent(attachmentId)}`, {
      method: 'DELETE'
    });
  }

  listConversations(plantId, params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/plants/${encodeURIComponent(plantId)}/conversations${suffix}`);
  }

  createConversation(plantId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/conversations`, {
      method: 'POST',
      body: payload
    });
  }

  listConversationMessages(plantId, conversationId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/conversations/${encodeURIComponent(conversationId)}/messages`);
  }

  createConversationMessage(plantId, conversationId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: payload
    });
  }

  markConversationRead(plantId, conversationId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/conversations/${encodeURIComponent(conversationId)}/read`, {
      method: 'PATCH',
      body: payload
    });
  }

  listWikiPages(plantId, params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/plants/${encodeURIComponent(plantId)}/wiki-pages${suffix}`);
  }

  getWikiPage(plantId, pageId, params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/plants/${encodeURIComponent(plantId)}/wiki-pages/${encodeURIComponent(pageId)}${suffix}`);
  }

  saveWikiRevision(plantId, pageId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/wiki-pages/${encodeURIComponent(pageId)}/revisions`, {
      method: 'POST',
      body: payload
    });
  }

  deleteWikiPage(plantId, pageId, params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/plants/${encodeURIComponent(plantId)}/wiki-pages/${encodeURIComponent(pageId)}${suffix}`, {
      method: 'DELETE'
    });
  }

  createWikiAttachment(plantId, pageId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/wiki-pages/${encodeURIComponent(pageId)}/attachments`, {
      method: 'POST',
      body: payload
    });
  }

  listRoleAlerts(plantId, params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/plants/${encodeURIComponent(plantId)}/role-alerts${suffix}`);
  }

  createRoleAlert(plantId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/role-alerts`, {
      method: 'POST',
      body: payload
    });
  }

  updateRoleAlert(plantId, alertId, patch) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/role-alerts/${encodeURIComponent(alertId)}`, {
      method: 'PATCH',
      body: patch
    });
  }

  subscribeToPlant(_plantId, _handlers = {}) {
    throw new Error('SQL realtime adapter is not implemented yet. Start with polling, then add Durable Objects or WebSockets if needed.');
  }
}

export class FirebaseDataApi {
  constructor(firebaseBindings = {}) {
    this.firebaseBindings = firebaseBindings;
  }

  unavailable(methodName) {
    throw new Error(`FirebaseDataApi.${methodName} has not been wired yet. Keep using existing Firebase calls until adapter cutover.`);
  }

  getCurrentUserContext() { return this.unavailable('getCurrentUserContext'); }
  updateCurrentUserContext() { return this.unavailable('updateCurrentUserContext'); }
  listPlants() { return this.unavailable('listPlants'); }
  listPlantMembers() { return this.unavailable('listPlantMembers'); }
  updatePlantMember() { return this.unavailable('updatePlantMember'); }
  getStatusConfig() { return this.unavailable('getStatusConfig'); }
  updateStatusConfig() { return this.unavailable('updateStatusConfig'); }
  getStoreConfig() { return this.unavailable('getStoreConfig'); }
  updateStoreConfig() { return this.unavailable('updateStoreConfig'); }
  getRoleAlertRouting() { return this.unavailable('getRoleAlertRouting'); }
  updateRoleAlertRouting() { return this.unavailable('updateRoleAlertRouting'); }
  getGamificationState() { return this.unavailable('getGamificationState'); }
  awardGamification() { return this.unavailable('awardGamification'); }
  loadPlantBootstrap() { return this.unavailable('loadPlantBootstrap'); }
  getDailySchedule() { return this.unavailable('getDailySchedule'); }
  listIssues() { return this.unavailable('listIssues'); }
  deleteIssue() { return this.unavailable('deleteIssue'); }
  getIssue() { return this.unavailable('getIssue'); }
  createIssue() { return this.unavailable('createIssue'); }
  updateIssue() { return this.unavailable('updateIssue'); }
  listIssueEvents() { return this.unavailable('listIssueEvents'); }
  appendIssueEvent() { return this.unavailable('appendIssueEvent'); }
  listIssueAttachments() { return this.unavailable('listIssueAttachments'); }
  createIssueAttachment() { return this.unavailable('createIssueAttachment'); }
  listNotes() { return this.unavailable('listNotes'); }
  createNote() { return this.unavailable('createNote'); }
  updateNote() { return this.unavailable('updateNote'); }
  deleteNote() { return this.unavailable('deleteNote'); }
  listNoteAttachments() { return this.unavailable('listNoteAttachments'); }
  createNoteAttachment() { return this.unavailable('createNoteAttachment'); }
  deleteNoteAttachment() { return this.unavailable('deleteNoteAttachment'); }
  listConversations() { return this.unavailable('listConversations'); }
  createConversation() { return this.unavailable('createConversation'); }
  listConversationMessages() { return this.unavailable('listConversationMessages'); }
  createConversationMessage() { return this.unavailable('createConversationMessage'); }
  markConversationRead() { return this.unavailable('markConversationRead'); }
  listWikiPages() { return this.unavailable('listWikiPages'); }
  getWikiPage() { return this.unavailable('getWikiPage'); }
  saveWikiRevision() { return this.unavailable('saveWikiRevision'); }
  deleteWikiPage() { return this.unavailable('deleteWikiPage'); }
  createWikiAttachment() { return this.unavailable('createWikiAttachment'); }
  listRoleAlerts() { return this.unavailable('listRoleAlerts'); }
  createRoleAlert() { return this.unavailable('createRoleAlert'); }
  updateRoleAlert() { return this.unavailable('updateRoleAlert'); }
  subscribeToPlant() { return this.unavailable('subscribeToPlant'); }
}

export function createDataApi(options = {}) {
  if (selectedDataBackend() === DATA_BACKEND_SQL) {
    return new SqlDataApi(options.sql || options);
  }
  return new FirebaseDataApi(options.firebase || {});
}
