const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64Url(bytes) {
  let binary = '';
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < array.length; i += 1) binary += String.fromCharCode(array[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret, usage) {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
}

async function signValue(secret, value) {
  const key = await importHmacKey(secret, 'sign');
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
}

async function verifyValue(secret, value, signature) {
  const key = await importHmacKey(secret, 'verify');
  return crypto.subtle.verify('HMAC', key, fromBase64Url(signature), textEncoder.encode(value));
}

function parseJsonSegment(segment) {
  try {
    return JSON.parse(textDecoder.decode(fromBase64Url(segment)));
  } catch {
    return null;
  }
}

export async function signAppSessionToken(user = {}, secret, options = {}) {
  if (!secret) throw new Error('APP_SESSION_SECRET is not configured.');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(300, Number(options.ttlSeconds) || 60 * 60 * 12);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    typ: 'ap-session',
    sub: String(user.uid || user.sub || '').trim(),
    email: String(user.email || '').trim(),
    name: String(user.name || user.displayName || user.email || user.uid || '').trim(),
    picture: String(user.picture || user.photoURL || '').trim(),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds
  };
  if (!payload.sub) throw new Error('Cannot sign session without a user id.');
  const encodedHeader = toBase64Url(textEncoder.encode(JSON.stringify(header)));
  const encodedPayload = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await signValue(secret, signingInput);
  return {
    token: `${signingInput}.${signature}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    payload
  };
}

export async function verifyAppSessionToken(token, secret) {
  if (!secret || !token) return null;
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  const header = parseJsonSegment(encodedHeader);
  const payload = parseJsonSegment(encodedPayload);
  if (!header || !payload) return null;
  if (header.alg !== 'HS256' || payload.typ !== 'ap-session') return null;
  const isValid = await verifyValue(secret, `${encodedHeader}.${encodedPayload}`, signature);
  if (!isValid) return null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Number(payload.exp || 0) <= nowSeconds) return null;
  return {
    uid: String(payload.sub || '').trim(),
    email: String(payload.email || '').trim(),
    name: String(payload.name || payload.email || payload.sub || '').trim(),
    picture: String(payload.picture || '').trim(),
    expiresAt: new Date(Number(payload.exp || 0) * 1000).toISOString()
  };
}
