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

  loadPlantBootstrap(plantId) {
    return this.request(`/plants/${encodeURIComponent(plantId)}/bootstrap`);
  }

  listIssues(plantId, params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/plants/${encodeURIComponent(plantId)}/issues${suffix}`);
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

  subscribeToPlant(_plantId, _handlers = {}) {
    throw new Error('SQL realtime adapter is not implemented yet. Use SignalR in the next migration phase.');
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
  loadPlantBootstrap() { return this.unavailable('loadPlantBootstrap'); }
  listIssues() { return this.unavailable('listIssues'); }
  getIssue() { return this.unavailable('getIssue'); }
  createIssue() { return this.unavailable('createIssue'); }
  updateIssue() { return this.unavailable('updateIssue'); }
  listIssueEvents() { return this.unavailable('listIssueEvents'); }
  appendIssueEvent() { return this.unavailable('appendIssueEvent'); }
  listIssueAttachments() { return this.unavailable('listIssueAttachments'); }
  createIssueAttachment() { return this.unavailable('createIssueAttachment'); }
  subscribeToPlant() { return this.unavailable('subscribeToPlant'); }
}

export function createDataApi(options = {}) {
  if (selectedDataBackend() === DATA_BACKEND_SQL) {
    return new SqlDataApi(options.sql || options);
  }
  return new FirebaseDataApi(options.firebase || {});
}
