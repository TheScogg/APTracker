const LOCAL_STORAGE_KEY = 'ap_api_session_v1';

function readStoredSession() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session) {
  try {
    if (!session?.token) {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      return;
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(session));
  } catch {}
}

export function createApiSessionClient({ getFirebaseIdToken, exchangePath = '/api/session/exchange', fetchImpl = window.fetch.bind(window) } = {}) {
  let cached = readStoredSession();
  let inFlight = null;

  function parseResponseBody(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function isFresh(session) {
    if (!session?.token || !session?.expiresAt) return false;
    const expiresMs = Date.parse(session.expiresAt);
    return Number.isFinite(expiresMs) && expiresMs > (Date.now() + 60 * 1000);
  }

  async function exchange(forceRefresh = false, googleIdToken = null) {
    if (!forceRefresh && isFresh(cached)) return cached.token;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const tokenToExchange = googleIdToken || (getFirebaseIdToken ? await getFirebaseIdToken() : null);
      if (!tokenToExchange) return '';
      const res = await fetchImpl(exchangePath, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenToExchange}`
        }
      });
      const text = await res.text();
      const body = parseResponseBody(text);
      if (!res.ok || !body?.sessionToken) {
        throw new Error(body?.error || `Session exchange failed (${res.status})`);
      }
      cached = {
        token: body.sessionToken,
        expiresAt: body.expiresAt || ''
      };
      writeStoredSession(cached);
      return cached.token;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    async getAccessToken(options = {}) {
      const token = await exchange(Boolean(options?.forceRefresh), options?.googleIdToken);
      if (token) return token;
      throw new Error('App session is unavailable. Sign in again to continue.');
    },
    clear() {
      cached = null;
      writeStoredSession(null);
    },
    warm(options = {}) {
      return exchange(Boolean(options?.forceRefresh), options?.googleIdToken).catch(() => '');
    }
  };
}
