const FIREBASE_AUTH_ORIGIN = 'https://press-tracker-9d9c9.firebaseapp.com';

function isAuthHelperRequest(pathname) {
  return pathname === '/__/auth' || pathname.startsWith('/__/auth/');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (isAuthHelperRequest(url.pathname)) {
      const upstreamUrl = new URL(url.pathname + url.search, FIREBASE_AUTH_ORIGIN);
      const upstreamRequest = new Request(upstreamUrl.toString(), request);
      return fetch(upstreamRequest);
    }

    return env.ASSETS.fetch(request);
  }
};
