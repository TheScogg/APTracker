import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { verifyAppSessionToken } from '../../session-auth.js';

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
  const token = match[1];
  const sessionSecret = process.env.APP_SESSION_SECRET || process.env.AP_SESSION_SECRET || '';
  const appSessionUser = await verifyAppSessionToken(token, sessionSecret);
  if (appSessionUser?.uid) return appSessionUser;
  throw Object.assign(new Error('Invalid or expired app session.'), { status: 401 });
}

export async function authenticateFirebaseIdToken(token) {
  const decoded = await getAuth(firebaseAdminApp()).verifyIdToken(token);
  return {
    uid: decoded.uid,
    email: decoded.email || '',
    name: decoded.name || decoded.email || decoded.uid,
    picture: decoded.picture || ''
  };
}
