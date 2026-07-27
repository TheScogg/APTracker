export const DATA_BACKEND_FIREBASE = 'firebase';
export const DATA_BACKEND_SQL = 'sql';

export function selectedDataBackend() {
  return DATA_BACKEND_SQL;
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
    const contentType = String(res.headers.get('Content-Type') || '').toLowerCase();
    let body = null;
    if (text) {
      if (contentType.includes('application/json')) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new ApiError(`API returned invalid JSON for ${path}`, {
            status: res.status,
            body: { raw: text.slice(0, 500) }
          });
        }
      } else {
        body = { raw: text };
      }
    }
    if (!res.ok) {
      const htmlLike = typeof body?.raw === 'string' && body.raw.trim().startsWith('<');
      throw new ApiError(
        body?.error
          || (htmlLike ? `API request failed with ${res.status} and returned HTML instead of JSON` : `API request failed with ${res.status}`),
        {
        status: res.status,
        body
        }
      );
    }
    if (text && !contentType.includes('application/json')) {
      const htmlLike = typeof body?.raw === 'string' && body.raw.trim().startsWith('<');
      throw new ApiError(
        htmlLike ? `API returned HTML instead of JSON for ${path}` : `API returned unexpected content type for ${path}`,
        {
          status: res.status,
          body
        }
      );
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

  createAccessRequests(payload) {
    return this.request('/access-requests', {
      method: 'POST',
      body: payload
    });
  }

  purchaseStoreItem(payload) {
    return this.request('/me/store-purchases', {
      method: 'POST',
      body: payload
    });
  }

  registerPushToken(payload) {
    return this.request('/me/push-tokens', {
      method: 'POST',
      body: payload
    });
  }

  getMigrationReadiness() {
    return this.request('/migration-readiness');
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

  listDailySchedules(plantId, params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/plants/${encodeURIComponent(plantId)}/daily-schedules${suffix}`);
  }

  listIssues(plantId, params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/plants/${encodeURIComponent(plantId)}/issues${suffix}`);
  }

  findSimilarFixes(plantId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/similar-fixes`, {
      method: 'POST',
      body: payload
    });
  }

  saveIssueSimilarFixes(plantId, issueId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/issues/${encodeURIComponent(issueId)}/similar-fixes`, {
      method: 'PUT',
      body: { payload }
    });
  }

  getIssueSimilarFixes(plantId, issueId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/issues/${encodeURIComponent(issueId)}/similar-fixes`);
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

  uploadPlantAttachment(plantId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/attachments/upload`, {
      method: 'POST',
      body: payload
    });
  }

  deleteStoredAttachmentObject(plantId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/attachments/object`, {
      method: 'DELETE',
      body: payload
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
    const query = new URLSearchParams();
    if (payload?.scope) query.set('scope', String(payload.scope));
    if (payload?.pressId) query.set('pressId', String(payload.pressId));
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/plants/${encodeURIComponent(plantId)}/wiki-pages/${encodeURIComponent(pageId)}/revisions${suffix}`, {
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
    const query = new URLSearchParams();
    if (payload?.scope) query.set('scope', String(payload.scope));
    if (payload?.pressId) query.set('pressId', String(payload.pressId));
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/plants/${encodeURIComponent(plantId)}/wiki-pages/${encodeURIComponent(pageId)}/attachments${suffix}`, {
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

  listTodos(plantId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/todos`);
  }

  createTodo(plantId, payload) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/todos`, {
      method: 'POST',
      body: payload
    });
  }

  updateTodo(plantId, todoId, patch) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/todos/${encodeURIComponent(todoId)}`, {
      method: 'PATCH',
      body: patch
    });
  }

  deleteTodo(plantId, todoId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/todos/${encodeURIComponent(todoId)}`, {
      method: 'DELETE'
    });
  }

  subscribeToPlant(_plantId, _handlers = {}) {
    throw new Error('SQL realtime adapter is not implemented yet. Start with polling, then add Durable Objects or WebSockets if needed.');
  }
}

export function createDataApi(options = {}) {
  return new SqlDataApi(options.sql || options);
}
