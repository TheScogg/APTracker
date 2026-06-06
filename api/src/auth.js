import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function firebaseAdminApp() {
  const existing = getApps()[0];
  if (existing) return existing;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    return initializeApp({
      credential: cert(JSON.parse(serviceAccountJson))
    });
  }
  return initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID
  });
}

export async function authenticateRequest(request) {
  const header = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw Object.assign(new Error('Missing bearer token'), { status: 401 });
  }
  const decoded = await getAuth(firebaseAdminApp()).verifyIdToken(match[1]);
  return {
    uid: decoded.uid,
    email: decoded.email || '',
    name: decoded.name || decoded.email || decoded.uid,
    picture: decoded.picture || ''
  };
}
