import { handleD1ApiRequest, importDailyScheduleToD1 } from './d1-api.js';
import { signAppSessionToken, verifyAppSessionToken } from './session-auth.js';
import { sendPushNotification } from '@mmmike/web-push/send';
import {
  ascertainScheduleShift,
  requireScheduleShift
} from '../js/schedule-shifts.mjs';

const FIREBASE_AUTH_ORIGIN = 'https://press-tracker-9d9c9.firebaseapp.com';
const FIREBASE_PROJECT_ID = 'press-tracker-9d9c9';
const FIREBASE_WEB_API_KEY = 'AIzaSyABjasNBbJnsqq4M_UxKruKrN6-O2FXCwc';

let _cachedToken = null;
let _tokenExpiresAt = 0;

function isAuthHelperRequest(pathname) {
  return pathname === '/__/auth' || pathname.startsWith('/__/auth/');
}

function base64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  return atob(str.replace(/-/g, '+').replace(/_/g, '/'));
}

async function getGoogleOAuthToken(env) {
  if (_cachedToken && Date.now() < _tokenExpiresAt - 60) {
    return _cachedToken;
  }
  const saJson = env.GOOGLE_SERVICE_ACCOUNT;
  if (!saJson) throw new Error('GOOGLE_SERVICE_ACCOUNT secret not configured');
  const sa = JSON.parse(saJson);
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const enc = new TextEncoder();
  const jwtB64 = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claim));

  // Import the private key and sign
  const pem = sa.private_key;
  const pemBody = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const rawKey = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', rawKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, enc.encode(jwtB64));
  const jwt = jwtB64 + '.' + base64url(String.fromCharCode(...new Uint8Array(sig)));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt)
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Failed to get OAuth token');
  _cachedToken = data.access_token;
  _tokenExpiresAt = now + (data.expires_in || 3600);
  return _cachedToken;
}

let _googleJwksCache = null;
let _googleJwksExpiresAt = 0;

async function getGoogleJwks() {
  if (_googleJwksCache && Date.now() < _googleJwksExpiresAt) {
    return _googleJwksCache;
  }
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error('Failed to fetch Google JWKs');
  const data = await res.json();
  _googleJwksCache = data.keys || [];
  _googleJwksExpiresAt = Date.now() + 6 * 60 * 60 * 1000;
  return _googleJwksCache;
}

function base64urlToBytes(str) {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function verifyGoogleIdToken(token, env) {
  if (!token) throw new Error('Token is empty');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token structure');
  
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64urlDecode(headerB64));
  const payload = JSON.parse(base64urlDecode(payloadB64));
  
  const kid = header.kid;
  if (!kid) throw new Error('Missing kid in token header');
  
  const keys = await getGoogleJwks();
  const jwk = keys.find(k => k.kid === kid);
  if (!jwk) throw new Error('JWK not found for kid: ' + kid);
  
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  
  const enc = new TextEncoder();
  const signingInput = `${headerB64}.${payloadB64}`;
  const signatureBytes = base64urlToBytes(signatureB64);
  const isValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signatureBytes,
    enc.encode(signingInput)
  );
  
  if (!isValid) throw new Error('Signature verification failed');
  
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('Token expired');
  
  const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
  if (!validIssuers.includes(payload.iss)) throw new Error('Invalid issuer: ' + payload.iss);
  
  const allowedClientId = env.GOOGLE_CLIENT_ID || '';
  if (allowedClientId && payload.aud !== allowedClientId) {
    throw new Error('Audience mismatch. Token aud: ' + payload.aud + ', expected: ' + allowedClientId);
  } else if (!allowedClientId) {
    if (!payload.aud.startsWith('943200266003-')) {
      throw new Error('Audience project mismatch. Token aud: ' + payload.aud);
    }
  }
  
  return {
    uid: payload.sub,
    email: payload.email || '',
    emailVerified: payload.email_verified !== false,
    name: payload.name || payload.email || payload.sub,
    picture: payload.picture || ''
  };
}

async function handleOcr(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
    });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  const endpoint = env.AZURE_DOCINT_ENDPOINT;
  const key = env.AZURE_DOCINT_KEY;
  if (!endpoint || !key) {
    return new Response(JSON.stringify({ error: 'Azure Document Intelligence not configured (set AZURE_DOCINT_ENDPOINT and AZURE_DOCINT_KEY secrets)' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const pdfBytes = await request.arrayBuffer();
    const apiUrl = `${endpoint.replace(/\/$/, '')}/formrecognizer/documentModels/prebuilt-layout:analyze?api-version=2023-07-31`;

    const azureRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', 'Ocp-Apim-Subscription-Key': key },
      body: pdfBytes,
    });

    if (!azureRes.ok) {
      const err = await azureRes.text();
      return new Response(JSON.stringify({ error: `Azure API error (${azureRes.status})`, details: err }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const operationLocation = azureRes.headers.get('Operation-Location');
    if (!operationLocation) {
      return new Response(JSON.stringify({ error: 'Missing Operation-Location header from Azure' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    let result;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const poll = await fetch(operationLocation, { headers: { 'Ocp-Apim-Subscription-Key': key } });
      const data = await poll.json();
      if (data.status === 'succeeded') { result = data; break; }
      if (data.status === 'failed') {
        return new Response(JSON.stringify({ error: 'Azure analysis failed', details: data.error }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (!result) {
      return new Response(JSON.stringify({ error: 'Azure analysis timed out (60s)' }), { status: 504, headers: { 'Content-Type': 'application/json' } });
    }

    // Extract text preserving page boundaries
    const pages = result.analyzeResult?.pages || [];
    const fullText = pages.map(p =>
      (p.lines || []).map(l => l.content).join('\n')
    ).join('\n\n');

    return new Response(JSON.stringify({ text: fullText, pageCount: pages.length }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function handleOcrGoogle(request, env) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }
  const apiKey = env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Google Cloud Vision not configured', keys: Object.keys(env).join(',') }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { images, languageHints, featureType, model, maxResults } = await request.json();
    if (!Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: 'Expected { images: [base64, ...] }' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const texts = [];
    for (const [i, image] of images.entries()) {
      const feature = { type: featureType || 'DOCUMENT_TEXT_DETECTION', maxResults: Math.max(1, Math.min(10, Number(maxResults) || 1)) };
      if (model) feature.model = model;
      const requestBody = { requests: [{ image: { content: image }, features: [feature] }] };
      if (Array.isArray(languageHints) && languageHints.length) {
        requestBody.requests[0].imageContext = { languageHints };
      }
      const res = await fetch('https://vision.googleapis.com/v1/images:annotate?key=' + apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data.error && data.error.message) || 'Google Vision API error');
      texts.push(data.responses?.[0]?.fullTextAnnotation?.text || '');
    }
    return new Response(JSON.stringify({ text: texts.join('\n\n'), pageCount: texts.length }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

function extractDocAiTextFromLayout(doc) {
  const blocks = doc?.documentLayout?.blocks;
  if (!blocks?.length) return '';
  const fullText = doc?.text || '';
  const parts = [];

  function walk(blockList) {
    for (const block of blockList) {
      if (block.textBlock) {
        if (block.textBlock.text) {
          parts.push(block.textBlock.text);
        } else if (fullText && block.textAnchor?.textSegments) {
          for (const seg of block.textAnchor.textSegments) {
            const start = parseInt(seg.startIndex || '0');
            const end = seg.endIndex !== undefined ? parseInt(seg.endIndex) : fullText.length;
            if (end > start && start >= 0 && end <= fullText.length) {
              parts.push(fullText.slice(start, end));
            }
          }
        }
      }
      if (block.tableBlock) {
        for (const row of [...(block.tableBlock.headerRows || []), ...(block.tableBlock.bodyRows || [])]) {
          for (const cell of row.cells || []) {
            walk(cell.blocks || []);
            parts.push('\t');
          }
          parts.push('\n');
        }
      }
    }
  }

  walk(blocks);
  return parts.join('').replace(/\t+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function getDocAiText(doc) {
  if (doc?.text?.trim()) return doc.text.trim();
  const fromLayout = extractDocAiTextFromLayout(doc);
  if (fromLayout) return fromLayout;
  if (doc?.entities?.length) {
    return doc.entities.map(e => e.mention || e.text || '').filter(Boolean).join('\n');
  }
  return '';
}

function shouldBypassStaticCache(pathname) {
  return pathname === '/'
    || pathname === '/index.html'
    || pathname === '/js/app.js'
    || pathname === '/js/build-info.js'
    || pathname === '/js/fcm-config.js'
    || pathname === '/firebase-messaging-sw.js'
    || pathname === '/css/styles.css';
}

function withStaticCacheHeaders(response, pathname) {
  const headers = new Headers(response.headers);
  if (shouldBypassStaticCache(pathname)) {
    headers.set('Cache-Control', 'no-store, max-age=0');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// ── AWS Signature V4 helpers ──────────────────────────────────────────

async function hmac(key, msg) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg));
  return new Uint8Array(sig);
}

async function sha256Hex(msg) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function byteArrayToHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sign an AWS API request.
 * Returns the headers that must be included in the fetch call.
 */
async function signAwsRequest(region, service, method, host, path, query, body, accessKeyId, secretAccessKey) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = await sha256Hex(body || '');

  const canonicalHeaders = `content-type:application/x-amz-json-1.1\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:Textract.AnalyzeDocument\n`;
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target';

  const canonicalRequest = [
    method,
    path || '/',
    query || '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n');

  const kDate = await hmac('AWS4' + secretAccessKey, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = byteArrayToHex(await hmac(kSigning, stringToSign));

  const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'Content-Type': 'application/x-amz-json-1.1',
    'Host': host,
    'X-Amz-Date': amzDate,
    'X-Amz-Target': 'Textract.AnalyzeDocument',
    'Authorization': authorization
  };
}

// ── Amazon Textract handler ───────────────────────────────────────────

async function handleOcrTextract(request, env) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  const region = env.AWS_REGION || 'us-west-2';

  if (!accessKeyId || !secretAccessKey) {
    return new Response(JSON.stringify({ error: 'AWS credentials not configured in secrets' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { images } = await request.json();
    if (!images || !images.length) {
      return new Response(JSON.stringify({ error: 'No images provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const service = 'textract';
    const host = `textract.${region}.amazonaws.com`;
    const url = `https://${host}/`;

    const pageTexts = [];

    for (let i = 0; i < images.length; i++) {
      const base64Image = images[i];
      const body = JSON.stringify({
        Document: { Bytes: base64Image },
        FeatureTypes: ['TABLES']
      });

      const headers = await signAwsRequest(
        region, service, 'POST', host, '/', '', body,
        accessKeyId, secretAccessKey
      );

      const res = await fetch(url, { method: 'POST', headers, body });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Textract page ${i + 1} error: ${errText}`);
        console.error(`Request X-Amz-Target: ${headers['X-Amz-Target']}`);
        console.error(`Request body length: ${body.length}`);
        throw new Error(`Textract API error on page ${i + 1}: ${res.status} ${errText}`);
      }

      const data = await res.json();
      const blocks = data.Blocks || [];

      const blockMap = {};
      for (const b of blocks) {
        blockMap[b.Id] = b;
      }

      let pageText = '';
      for (const b of blocks) {
        if (b.BlockType === 'TABLE') {
          const rows = [];
          for (const rel of (b.Relationships || [])) {
            if (rel.Type === 'CHILD') {
              for (const cid of rel.Ids) {
                const cell = blockMap[cid];
                if (cell && cell.BlockType === 'CELL') {
                  const r = (cell.RowIndex || 1) - 1;
                  const c = (cell.ColumnIndex || 1) - 1;
                  if (!rows[r]) rows[r] = [];
                  let text = cell.Text || '';
                  if (!text && cell.Relationships) {
                    const words = [];
                    for (const cr of cell.Relationships) {
                      if (cr.Type === 'CHILD') {
                        for (const wid of cr.Ids) {
                          const word = blockMap[wid];
                          if (word && word.BlockType === 'WORD') {
                            words.push(word.Text || '');
                          }
                        }
                      }
                    }
                    text = words.join(' ');
                  }
                  rows[r][c] = text.replace(/\n/g, ' ');
                }
              }
            }
          }
          if (rows.length) {
            const maxCols = Math.max(...rows.map(r => (r || []).length));
            for (let r = 0; r < rows.length; r++) {
              if (!rows[r]) rows[r] = [];
              for (let c = 0; c < maxCols; c++) {
                if (!rows[r][c]) rows[r][c] = '';
              }
              pageText += '| ' + rows[r].join(' | ') + ' |\n';
              if (r === 0) {
                pageText += '|-' + Array(maxCols).fill('-').join('|-') + '|\n';
              }
            }
            pageText += '\n';
          }
        }
      }
      if (!pageText) {
        const lines = blocks.filter(b => b.BlockType === 'LINE').map(b => b.Text);
        pageText = lines.join('\n');
      }
      pageTexts.push(pageText);
    }

    const fullText = pageTexts.join('\n\n');
    return new Response(JSON.stringify({ text: fullText, pageCount: images.length }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleOcrDocumentAi(request, env) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const accessToken = await getGoogleOAuthToken(env);
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');
    const processorId = url.searchParams.get('processorId');
    const loc = url.searchParams.get('location') || 'us';
    if (!projectId || !processorId) {
      return new Response(JSON.stringify({ error: 'Project ID and Processor ID are required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const pdfBase64 = await request.arrayBuffer().then(b => {
      const bytes = new Uint8Array(b);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    });

    const docAiUrl = `https://${loc}-documentai.googleapis.com/v1/projects/${projectId}/locations/${loc}/processors/${processorId}:process`;
    const res = await fetch(docAiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accessToken },
      body: JSON.stringify({
        rawDocument: { content: pdfBase64, mimeType: 'application/pdf' },
        skipHumanReview: true
      })
    });

    const data = await res.json();
    if (res.status === 401) {
      _cachedToken = null;
      const newToken = await getGoogleOAuthToken(env);
      const retryRes = await fetch(docAiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + newToken },
        body: JSON.stringify({
          rawDocument: { content: pdfBase64, mimeType: 'application/pdf' },
          skipHumanReview: true
        })
      });
      const retryData = await retryRes.json();
      if (!retryRes.ok) throw new Error((retryData.error && retryData.error.message) || 'Document AI API error: ' + retryRes.status);
      const retryText = getDocAiText(retryData.document);
      const retryPages = retryData.document?.pages || [];
      return new Response(JSON.stringify({ text: retryText, pageCount: retryPages.length || 1 }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (!res.ok) throw new Error((data.error && data.error.message) || 'Document AI API error: ' + res.status);

    const pages = data.document?.pages || [];
    const text = getDocAiText(data.document);

    if (!text && !pages.length) {
      const snippet = JSON.stringify(data).slice(0, 2000);
      return new Response(JSON.stringify({ error: 'Document AI returned no text. Response preview: ' + snippet }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ text, pageCount: pages.length || 1 }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function handleAiConvert(request, env) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({
      error: 'DeepSeek key missing',
      typeofKey: typeof apiKey,
      keyLength: typeof apiKey === 'string' ? apiKey.length : 'N/A',
      allKeys: Object.keys(env).join(',')
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { text: rawText, shiftOverride, instructions, systemPrompt: customPrompt } = await request.json();
    if (!rawText) {
      return new Response(JSON.stringify({ error: 'Expected { text: string }' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const basePrompt = `You convert daily production schedule OCR text into structured JSON. Output ONLY valid JSON matching this schema. CRITICAL: Escape all double quotes inside string values with backslash. For example, "27" Basket" must be written as "27\" Basket". Never use unescaped quotes inside strings. Output ONLY the JSON object, no markdown, no explanation.

{
  "schedule_info": {
    "date": "YYYY-MM-DD",
    "shift": "1",
    "line_speed": "",
    "total_planned_pcs": "",
    "note": ""
  },
  "page_1": [
    {
      "press": "",
      "part_storage_location": [],
      "part_number": "",
      "description": "",
      "cavity": "",
      "doh": "",
      "labels_per_shift": "",
      "mc": "",
      "notes": ""
    }
  ],
  "page_2": [],
  "north_bay_changes": [],
  "south_bay_changes": []
}

Rules:
- Extract date from the text if present (use YYYY-MM-DD format).
- Read the schedule header and set schedule_info.shift to exactly "1", "2", or "3".
- Each row in page_1 / page_2 represents one press/cavity entry from the schedule.
- "doh" is Days on Hand (numeric).
- "labels_per_shift" is numeric.
- "mc" is mold code.
- part_storage_location is an array of string location codes (can be empty).
- "cavity" is a string (e.g. "4").
- north_bay_changes and south_bay_changes are for change-over rows (same fields).
- If shiftOverride is provided, use it instead of auto-detecting.
- If text is unclear or a field is missing, use empty string or empty array. Do NOT make up data.
- Return ONLY the JSON object, no markdown or explanation.`;

    const systemPrompt = customPrompt ? basePrompt + `\n\nAdditional context from schedule admin:\n${customPrompt}` : basePrompt;

    const userMessage = `Schedule OCR text:\n\n${rawText}${shiftOverride ? `\n\nShift override: ${shiftOverride}` : ''}${instructions ? `\n\nAdditional instructions: ${instructions}` : ''}`;

    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 16384
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error((data.error && data.error.message) || 'DeepSeek API error: ' + res.status);

    let content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek returned empty response');

    // Strip markdown code fences if present
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) content = fenceMatch[1].trim();

    // Sanitize before parsing — fix inch-mark quotes and normalize smart quotes
    let cleaned = content
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/(\d)"(?!\s*[,\}\]\:])/g, '$1\\"');

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (_) {
      // Try removing trailing commas (most common LLM JSON issue)
      const fixed = cleaned.replace(/,\s*([\]}])/g, '$1');
      try {
        parsed = JSON.parse(fixed);
      } catch (_2) {
        return new Response(JSON.stringify({ error: 'DeepSeek returned invalid JSON', content: content }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }
    const detectedShift = ascertainScheduleShift({
      text: rawText,
      reportedShift: parsed?.schedule_info?.shift ?? parsed?.shift,
      override: shiftOverride
    });
    if (!parsed.schedule_info || typeof parsed.schedule_info !== 'object') parsed.schedule_info = {};
    parsed.schedule_info.shift = detectedShift;
    return new Response(JSON.stringify(parsed), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: e?.status || 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ── Full pipeline: image → Textract → DeepSeek → JSON ─────────────────

async function handleScheduleScan(request, env) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  const region = env.AWS_REGION || 'us-west-2';
  const deepseekKey = env.DEEPSEEK_API_KEY;

  if (!accessKeyId || !secretAccessKey) {
    return new Response(JSON.stringify({ error: 'AWS credentials not configured' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (!deepseekKey) {
    return new Response(JSON.stringify({ error: 'DeepSeek API key not configured' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    // Step 1: Read one or two images from request body
    const contentType = request.headers.get('Content-Type') || '';
    let imagesToProcess = [];
    let customInstructions = '';
    let customSysPrompt = '';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formText = await request.text();
      const params = new URLSearchParams(formText);
      const imagesParam = params.get('images');
      if (imagesParam) {
        try {
          imagesToProcess = JSON.parse(imagesParam);
          if (!Array.isArray(imagesToProcess)) imagesToProcess = [imagesParam];
        } catch {
          imagesToProcess = [imagesParam];
        }
      } else {
        throw new Error('Form body must include "images" field');
      }
    } else if (contentType.includes('application/json')) {
      const bodyJson = await request.json();
      // Shortcuts may send images as array, stringified array, or single value
      let rawImages = bodyJson.images;
      if (rawImages === undefined) rawImages = bodyJson.image;
      if (rawImages === undefined) {
        // Try the entire body as a single image value
        const keys = Object.keys(bodyJson);
        if (keys.length === 1) rawImages = bodyJson[keys[0]];
      }
      if (rawImages === undefined) {
        throw new Error('Expected "image" (base64) or "images" (array of base64)');
      }
      if (Array.isArray(rawImages)) {
        imagesToProcess = rawImages;
      } else if (typeof rawImages === 'string') {
        try {
          const parsed = JSON.parse(rawImages);
          imagesToProcess = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          imagesToProcess = [rawImages];
        }
      } else {
        imagesToProcess = [String(rawImages)];
      }
      // Optional custom instructions / system prompt from the Shortcut body
      customInstructions = bodyJson.instructions || '';
      customSysPrompt = bodyJson.systemPrompt || '';
    } else {
      const arrayBuffer = await request.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8.length; i += 65536) {
        binary += String.fromCharCode(...uint8.subarray(i, i + 65536));
      }
      imagesToProcess = [btoa(binary)]; // single raw image
    }

    // Step 2: Textract OCR for each image
    const service = 'textract';
    const host = `textract.${region}.amazonaws.com`;
    const textractUrl = `https://${host}/`;

    let allOcrTexts = [];

    for (let pageIdx = 0; pageIdx < imagesToProcess.length; pageIdx++) {
      const imageBytes = imagesToProcess[pageIdx];
      const body = JSON.stringify({
        Document: { Bytes: imageBytes },
        FeatureTypes: ['TABLES']
      });

      const headers = await signAwsRequest(region, service, 'POST', host, '/', '', body, accessKeyId, secretAccessKey);
      const trRes = await fetch(textractUrl, { method: 'POST', headers, body });
      if (!trRes.ok) {
        const errText = await trRes.text();
        throw new Error(`Textract error on image ${pageIdx + 1}: ${trRes.status} ${errText}`);
      }
      const trData = await trRes.json();
      const blocks = trData.Blocks || [];

      const blockMap = {};
      for (const b of blocks) blockMap[b.Id] = b;

      let ocrText = '';
      for (const b of blocks) {
        if (b.BlockType === 'TABLE') {
          const rows = [];
          for (const rel of (b.Relationships || [])) {
            if (rel.Type === 'CHILD') {
              for (const cid of rel.Ids) {
                const cell = blockMap[cid];
                if (cell && cell.BlockType === 'CELL') {
                  const r = (cell.RowIndex || 1) - 1;
                  const c = (cell.ColumnIndex || 1) - 1;
                  if (!rows[r]) rows[r] = [];
                  let text = cell.Text || '';
                  if (!text && cell.Relationships) {
                    const words = [];
                    for (const cr of cell.Relationships) {
                      if (cr.Type === 'CHILD') {
                        for (const wid of cr.Ids) {
                          const word = blockMap[wid];
                          if (word && word.BlockType === 'WORD') words.push(word.Text || '');
                        }
                      }
                    }
                    text = words.join(' ');
                  }
                  rows[r][c] = text.replace(/\n/g, ' ');
                }
              }
            }
          }
          if (rows.length) {
            const maxCols = Math.max(...rows.map(r => (r || []).length));
            for (let r = 0; r < rows.length; r++) {
              if (!rows[r]) rows[r] = [];
              for (let c = 0; c < maxCols; c++) {
                if (!rows[r][c]) rows[r][c] = '';
              }
              ocrText += '| ' + rows[r].join(' | ') + ' |\n';
              if (r === 0) {
                ocrText += '|-' + Array(maxCols).fill('-').join('|-') + '|\n';
              }
            }
            ocrText += '\n';
          }
        }
      }
      if (!ocrText) {
        ocrText = blocks.filter(b => b.BlockType === 'LINE').map(b => b.Text).join('\n');
      }
      if (!ocrText.trim()) throw new Error(`No text detected in image ${pageIdx + 1}`);
      allOcrTexts.push(ocrText);
    }

    // Step 3: DeepSeek → JSON
    const basePrompt = `You convert daily production schedule OCR text into structured JSON. Output ONLY valid JSON matching this schema. CRITICAL: Escape all double quotes inside string values with backslash. For example, "27" Basket" must be written as "27\\" Basket". Never use unescaped quotes inside strings. Output ONLY the JSON object, no markdown, no explanation.

{
  "schedule_info": {
    "date": "YYYY-MM-DD",
    "shift": "1",
    "line_speed": "",
    "total_planned_pcs": "",
    "note": ""
  },
  "page_1": [
    {
      "press": "5.01",
      "part_storage_location": [],
      "part_number": "",
      "description": "",
      "cavity": "",
      "doh": "",
      "labels_per_shift": "",
      "mc": "",
      "notes": ""
    }
  ],
  "page_2": [],
  "north_bay_changes": [],
  "south_bay_changes": []
}

Rules:
- Auto-detect shift (1, 2, or 3) from the schedule header or text and set schedule_info.shift to exactly "1", "2", or "3".
- part_storage_location is an ARRAY of location strings (up to 3 values).
- cavity is a string (e.g. "4" or "9-16").
- doh is numeric.
- labels_per_shift is numeric.
- mc is mold code string.
- press is the press number from the schedule grid (e.g. "5.01").
- CRITICAL: Some press rows have TWO part numbers (e.g. "23904132P001 23904132P002" or "26503975P004 26503976P004" with a space between them) or TWO part storage location sets. When this happens, you MUST create TWO separate rows in the JSON with the SAME press number. Split the part_number, part_storage_location, cavity, and description values between the two rows. Do NOT put both part numbers in one row's part_number field.
- page_1 and page_2 contain the main press rows.
- north_bay_changes and south_bay_changes are for change-over rows.
- If text is unclear or a field is missing, use empty string or empty array. Do NOT make up data.
- Return ONLY the JSON, no markdown or explanation.`;

    const dsRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + deepseekKey
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: customSysPrompt ? basePrompt + `\n\nAdditional context from schedule admin:\n${customSysPrompt}` : basePrompt },
          { role: 'user', content: `Schedule OCR text:\n\n${allOcrTexts.join('\n\n--- Page ---\n\n')}${customInstructions ? `\n\nAdditional instructions: ${customInstructions}` : ''}` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 16384
      })
    });

    if (!dsRes.ok) {
      const dsErr = await dsRes.text();
      throw new Error(`DeepSeek error: ${dsRes.status} ${dsErr}`);
    }

    const dsData = await dsRes.json();
    let content = dsData.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek returned empty response');

    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) content = fenceMatch[1].trim();

    let cleaned = content
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/(\d)"(?!\s*[,\}\]\:])/g, '$1\\"');

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (_) {
      const fixed = cleaned.replace(/,\s*([\]}])/g, '$1');
      try {
        parsed = JSON.parse(fixed);
      } catch (_2) {
        return new Response(JSON.stringify({ error: 'DeepSeek returned invalid JSON', content: content.substring(0, 500) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const rawOcrText = allOcrTexts.join('\n\n--- Page ---\n\n');
    const detectedShift = ascertainScheduleShift({
      text: rawOcrText,
      reportedShift: parsed?.schedule_info?.shift ?? parsed?.shift
    });
    if (!parsed.schedule_info || typeof parsed.schedule_info !== 'object') parsed.schedule_info = {};
    parsed.schedule_info.shift = detectedShift;

    // Step 4: If ?plant= is provided, write to Firestore
    const scanUrl = new URL(request.url);
    const plantId = scanUrl.searchParams.get('plant');
    let saved = false;
    let saveError = 'not_attempted';
    if (plantId) {
      saveError = 'pending';
      try {
        const importReq = new Request(request.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed)
        });
        const importRes = await handleImportSchedule(importReq, env);
        saved = importRes.ok;
        if (!saved) {
          const body = await importRes.json().catch(() => ({}));
          saveError = body.error || `HTTP_${importRes.status}`;
        } else {
          saveError = null;
        }
      } catch (importErr) {
        saveError = 'EXCEPTION: ' + importErr.message;
      }
    }

    return new Response(JSON.stringify({ ...parsed, saved, saveError, rawOcrText: rawOcrText.substring(0, 8000) }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: e?.status || 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── Debug endpoint: echo image metadata ──────────────────────────────

async function handleDebugImage(request, env) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const contentType = request.headers.get('Content-Type') || '';
  const url = new URL(request.url);
  const debug = { received: true, contentType, plantParam: url.searchParams.get('plant') };

  try {
    if (contentType.includes('application/json')) {
      const bodyJson = await request.json();
      let rawImages = bodyJson.images || bodyJson.image || Object.values(bodyJson)[0];
      if (typeof rawImages === 'string') rawImages = [rawImages];
      if (!Array.isArray(rawImages)) rawImages = [String(rawImages)];
      debug.images = rawImages.map((b64, i) => ({
        index: i,
        length: b64.length,
        validBase64: /^[A-Za-z0-9+/]*={0,2}$/.test(b64.replace(/[\s\r\n]/g, '')),
        startsWith: b64.substring(0, 40),
        endsWith: b64.substring(b64.length - 20)
      }));
    } else {
      const arrayBuffer = await request.arrayBuffer();
      debug.rawLength = arrayBuffer.byteLength;
      debug.rawType = contentType || 'unknown';
    }
  } catch (e) {
    debug.error = e.message;
  }

  return new Response(JSON.stringify(debug, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// ── Import schedule JSON to D1 ────────────────────────────────────────

const SCHEDULE_SECTIONS = [
  { inputKey: 'page_1', section: 'page1', isChange: false },
  { inputKey: 'page_2', section: 'page2', isChange: false },
  { inputKey: 'north_bay_changes', section: 'northBayChanges', isChange: true },
  { inputKey: 'south_bay_changes', section: 'southBayChanges', isChange: true }
];

function normalizeScheduleRowId(press, cavity, usedIds) {
  const rawPress = String(press || '').trim().toLowerCase()
    .replace(/\./g, '_')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'row';
  const safeCavity = String(cavity || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!usedIds.has(rawPress)) {
    usedIds.add(rawPress);
    return rawPress;
  }
  if (safeCavity) {
    const cavityId = `${rawPress}_cav${safeCavity}`;
    if (!usedIds.has(cavityId)) {
      usedIds.add(cavityId);
      return cavityId;
    }
  }
  let index = 2;
  let nextId = `${rawPress}_${index}`;
  while (usedIds.has(nextId)) {
    index += 1;
    nextId = `${rawPress}_${index}`;
  }
  usedIds.add(nextId);
  return nextId;
}

function parseMaybeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalizeScheduleKeys(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const normalized = { ...raw };
  const sectionMap = {
    page1: 'page_1',
    page2: 'page_2',
    northBayChanges: 'north_bay_changes',
    southBayChanges: 'south_bay_changes',
    north_bay_change: 'north_bay_changes',
    south_bay_change: 'south_bay_changes'
  };
  for (const [alternate, canonical] of Object.entries(sectionMap)) {
    if (normalized[alternate] !== undefined && normalized[canonical] === undefined) {
      normalized[canonical] = normalized[alternate];
      delete normalized[alternate];
    }
  }
  if (normalized.schedule_info && typeof normalized.schedule_info === 'object') {
    const info = { ...normalized.schedule_info };
    const infoMap = {
      scheduleDate: 'date',
      schedule_date: 'date',
      lineSpeed: 'line_speed',
      totalPlannedPcs: 'total_planned_pcs'
    };
    for (const [alternate, canonical] of Object.entries(infoMap)) {
      if (info[alternate] !== undefined && info[canonical] === undefined) {
        info[canonical] = info[alternate];
      }
    }
    normalized.schedule_info = info;
  }
  if (!normalized.schedule_info && (normalized.date || normalized.shift)) {
    normalized.schedule_info = {
      date: normalized.date || '',
      shift: normalized.shift || '',
      line_speed: '',
      total_planned_pcs: '',
      note: ''
    };
  }
  return normalized;
}

function extractSchedulePayload(parsed) {
  if (parsed?.schedule_info) return parsed;
  if (parsed?.dailySchedules && typeof parsed.dailySchedules === 'object') {
    const firstEntry = Object.values(parsed.dailySchedules)[0];
    if (firstEntry && typeof firstEntry === 'object') return firstEntry;
  }
  return parsed;
}

function normalizeSchedulePayload(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Schedule JSON must be an object.');
  const info = raw.schedule_info || {};
  const scheduleDate = String(info.date || '').trim();
  if (!scheduleDate) throw new Error('schedule_info.date is required (yyyy-mm-dd).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) throw new Error('schedule_info.date must use yyyy-mm-dd format.');
  const scheduleShift = requireScheduleShift(info.shift);

  const sections = {};
  for (const cfg of SCHEDULE_SECTIONS) {
    const rows = Array.isArray(raw[cfg.inputKey]) ? raw[cfg.inputKey] : [];
    const usedIds = new Set();
    sections[cfg.section] = rows.map((row, index) => ({
      rowId: normalizeScheduleRowId(row?.press, row?.cavity, usedIds),
      scheduleDate,
      shift: scheduleShift,
      section: cfg.section,
      press: String(row?.press || ''),
      partStorageLocation: Array.isArray(row?.part_storage_location)
        ? row.part_storage_location.map(value => String(value ?? ''))
        : [],
      partNumber: String(row?.part_number || ''),
      description: String(row?.description || ''),
      cavity: String(row?.cavity || ''),
      doh: parseMaybeNumber(row?.doh),
      labelsPerShift: parseMaybeNumber(row?.labels_per_shift),
      mc: String(row?.mc || ''),
      notes: String(row?.notes || ''),
      displayOrder: index + 1,
      isChange: cfg.isChange
    }));
  }

  return {
    scheduleDate,
    shift: scheduleShift,
    lineSpeed: parseMaybeNumber(info.line_speed),
    totalPlannedPcs: parseMaybeNumber(info.total_planned_pcs),
    notes: String(info.note || ''),
    sections
  };
}

async function handleImportSchedule(request, env) {
  let plantId;
  let scheduleDate;
  try {
    const url = new URL(request.url);
    plantId = url.searchParams.get('plant');
    scheduleDate = url.searchParams.get('date');
    const shiftParam = String(url.searchParams.get('shift') || '').trim();
    if (!plantId) throw new Error('Missing ?plant= parameter');

    const db = env.APTRACKER_DB || env.DB;
    if (!db) throw new Error('D1 binding not configured. Add APTRACKER_DB or DB to wrangler.jsonc.');

    if (request.method === 'GET') {
      if (!scheduleDate) throw new Error('Missing ?date= parameter');
      const shift = shiftParam ? requireScheduleShift(shiftParam, 'shift query parameter') : '';
      const existing = await db
        .prepare(shift
          ? 'SELECT schedule_date, shift FROM daily_schedules WHERE plant_id = ? AND schedule_date = ? AND shift = ? LIMIT 1'
          : 'SELECT schedule_date, shift FROM daily_schedules WHERE plant_id = ? AND schedule_date = ? ORDER BY shift ASC LIMIT 1')
        .bind(...(shift ? [plantId, scheduleDate, shift] : [plantId, scheduleDate]))
        .first();
      return jsonResponse({ exists: Boolean(existing), plantId, date: scheduleDate, shift: shift || existing?.shift || null });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const scheduleJson = canonicalizeScheduleKeys(await request.json());
    const payload = extractSchedulePayload(scheduleJson);
    const normalized = normalizeSchedulePayload(payload);
    const imported = await importDailyScheduleToD1(db, plantId, {
      ...normalized,
      sourceFileName: request.headers.get('x-source-file-name') || 'api-import',
      sourceFileType: request.headers.get('x-source-file-type') || 'application/json',
      status: 'imported'
    });

    return jsonResponse({
      success: true,
      plantId,
      date: normalized.scheduleDate,
      shift: normalized.shift,
      totalRows: imported.rowCount,
      scheduleIssues: imported.scheduleIssueCount
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message, plantId, date: scheduleDate }), {
      status: e?.status || 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
}

async function listUserD1PushTokens(env, uid, provider = 'fcm') {
  const db = env.APTRACKER_DB || env.DB;
  if (!db || !uid) return [];
  const result = await db.prepare(`
    SELECT token, token_id, provider, platform, notification_permission
    FROM user_push_tokens
    WHERE uid = ? AND provider = ?
  `).bind(uid, provider).all();
  const rows = Array.isArray(result?.results) ? result.results : [];
  return rows
    .filter(row => row?.token)
    .map(row => ({
      token: row.token,
      tokenId: row.token_id,
      provider: row.provider,
      platform: row.platform,
      notificationPermission: row.notification_permission
    }));
}

async function listUserD1FcmTokens(env, uid) {
  return listUserD1PushTokens(env, uid, 'fcm');
}

async function authenticateExchangeUser(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('Missing Google ID token.');
  const bearerToken = match[1];
  const sessionSecret = env.APP_SESSION_SECRET || env.AP_SESSION_SECRET || '';
  const appSessionUser = await verifyAppSessionToken(bearerToken, sessionSecret);
  if (appSessionUser?.uid) {
    return {
      localId: appSessionUser.uid,
      email: appSessionUser.email || '',
      displayName: appSessionUser.name || appSessionUser.email || appSessionUser.uid,
      photoUrl: appSessionUser.picture || ''
    };
  }
  try {
    const decoded = await verifyGoogleIdToken(bearerToken, env);
    let uid = decoded.uid;
    const db = getD1Db(env);
    if (db && decoded.email && decoded.emailVerified !== false) {
      const emailLower = decoded.email.toLowerCase();
      try {
        const activeMember = await db.prepare(
          `
            SELECT pm.uid
            FROM plant_members pm
            LEFT JOIN users u ON u.uid = pm.uid
            WHERE pm.is_active = 1
              AND (LOWER(pm.email) = ? OR LOWER(u.email) = ?)
            ORDER BY
              CASE WHEN pm.uid = ? THEN 0 ELSE 1 END,
              CASE WHEN pm.role = 'admin' THEN 0 ELSE 1 END,
              pm.joined_at ASC
            LIMIT 1
          `
        ).bind(emailLower, emailLower, decoded.uid).first();
        const row = activeMember || await db.prepare(
          'SELECT uid FROM user_lookup WHERE email_normalized = ? LIMIT 1'
        ).bind(emailLower).first();
        if (row?.uid) {
          uid = row.uid;
        } else {
          const userRow = await db.prepare(
            'SELECT uid FROM users WHERE LOWER(email) = ? ORDER BY LENGTH(uid) DESC, created_at ASC LIMIT 1'
          ).bind(emailLower).first();
          if (userRow?.uid) {
            uid = userRow.uid;
          }
        }
      } catch (dbErr) {
        console.error('Failed to look up uid in D1:', dbErr);
      }
    }
    return {
      localId: uid,
      email: decoded.email,
      displayName: decoded.name,
      photoUrl: decoded.picture
    };
  } catch (e) {
    try {
      const apiKey = env.FIREBASE_WEB_API_KEY || FIREBASE_WEB_API_KEY;
      if (apiKey) {
        const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: bearerToken })
        });
        const data = await res.json();
        if (res.ok && data.users?.[0]?.localId) {
          return data.users[0];
        }
      }
    } catch (_) {}
    throw new Error('Google Sign-In verification failed: ' + e.message);
  }
}

async function authenticateAppRequest(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Missing app session token.'), { status: 401 });
  const bearerToken = match[1];
  const sessionSecret = env.APP_SESSION_SECRET || env.AP_SESSION_SECRET || '';
  const appSessionUser = await verifyAppSessionToken(bearerToken, sessionSecret);
  if (!appSessionUser?.uid) {
    throw Object.assign(new Error('Invalid or expired app session.'), { status: 401 });
  }
  return {
    localId: appSessionUser.uid,
    email: appSessionUser.email || '',
    displayName: appSessionUser.name || appSessionUser.email || appSessionUser.uid,
    photoUrl: appSessionUser.picture || ''
  };
}

async function handleSessionExchange(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, { status: 405 });
  try {
    const user = await authenticateExchangeUser(request, env);
    const sessionSecret = env.APP_SESSION_SECRET || env.AP_SESSION_SECRET || '';
    if (!sessionSecret) {
      return jsonResponse({ error: 'APP_SESSION_SECRET is not configured.' }, { status: 500 });
    }
    const session = await signAppSessionToken({
      uid: user.localId,
      email: user.email || '',
      name: user.displayName || user.email || user.localId,
      picture: user.photoUrl || ''
    }, sessionSecret);
    return jsonResponse({
      sessionToken: session.token,
      expiresAt: session.expiresAt
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, { status: 401 });
  }
}

function getAttachmentBucket(env) {
  return env.APTRACKER_ATTACHMENTS || env.ATTACHMENTS_BUCKET || null;
}

function getAttachmentSigningSecret(env) {
  return env.ATTACHMENT_URL_SECRET || env.APP_SESSION_SECRET || env.AP_SESSION_SECRET || '';
}

async function sha256Base64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function signAttachmentPath(path, env) {
  const secret = getAttachmentSigningSecret(env);
  if (!secret) throw new Error('APP_SESSION_SECRET or ATTACHMENT_URL_SECRET is required for attachment URL signing.');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(path || '')));
  let binary = '';
  for (const byte of new Uint8Array(sig)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function verifyAttachmentSignature(path, sig, env) {
  if (!path || !sig) return false;
  const expected = await signAttachmentPath(path, env);
  return expected === sig;
}

function buildAttachmentObjectUrl(requestUrl, storagePath, env) {
  const url = new URL('/api/storage/object', requestUrl);
  url.searchParams.set('path', storagePath);
  return signAttachmentPath(storagePath, env).then(sig => {
    url.searchParams.set('sig', sig);
    return url.toString();
  });
}

function parseDataUrlPayload(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match) throw Object.assign(new Error('Expected a base64 data URL.'), { status: 400 });
  const contentType = match[1] || 'application/octet-stream';
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { contentType, bytes };
}

async function requirePlantAccess(env, plantId, request, permissionName = null) {
  const db = getD1Db(env);
  if (!db) throw Object.assign(new Error('D1 binding not configured.'), { status: 500 });
  const authUser = await authenticateAppRequest(request, env);
  const user = {
    uid: authUser.localId,
    email: authUser.email || '',
    name: authUser.displayName || authUser.email || authUser.localId
  };
  const row = await db.prepare(
    `
      SELECT is_active, permissions_json
      FROM plant_members
      WHERE plant_id = ? AND uid = ?
      LIMIT 1
    `
  ).bind(String(plantId || ''), user.uid).first();
  if (!row || !Number(row.is_active)) {
    throw Object.assign(new Error('Plant access denied'), { status: 403 });
  }
  if (permissionName) {
    let permissions = {};
    try {
      permissions = row.permissions_json ? JSON.parse(row.permissions_json) : {};
    } catch {
      permissions = {};
    }
    if (permissions[permissionName] !== true) {
      throw Object.assign(new Error('Permission denied'), { status: 403 });
    }
  }
  return user;
}

function normalizeAttachmentFileName(fileName, fallback = 'attachment.bin') {
  const raw = String(fileName || '').trim();
  const normalized = raw.replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

async function handleAttachmentUpload(request, env, plantId) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, { status: 405 });
  const bucket = getAttachmentBucket(env);
  if (!bucket) {
    return jsonResponse({ error: 'Attachment bucket is not configured. Bind APTRACKER_ATTACHMENTS (R2) before switching storage.' }, { status: 501 });
  }
  try {
    const body = await request.json();
    const scope = String(body.scope || '').trim().toLowerCase();
    const validScopes = new Set(['issue', 'note', 'wiki', 'conversation']);
    if (!validScopes.has(scope)) {
      throw Object.assign(new Error('scope must be one of: issue, note, wiki, conversation.'), { status: 400 });
    }
    const permissionName = scope === 'wiki' ? 'canEditIssue' : null;
    const actor = await requirePlantAccess(env, plantId, request, permissionName);
    const { contentType, bytes } = parseDataUrlPayload(body.dataUrl);
    const declaredContentType = String(body.contentType || '').trim() || contentType;
    const fileName = normalizeAttachmentFileName(body.fileName, `attachment-${Date.now()}.bin`);
    const objectHash = await sha256Base64Url(bytes);
    const entityId = String(body.issueId || body.noteId || body.pageId || body.conversationId || '').trim() || 'misc';
    const wikiScope = String(body.wikiScope || body.scopeType || 'shared').trim().toLowerCase();
    const pressId = String(body.pressId || '').trim();
    let key = '';
    if (scope === 'issue') {
      key = `plants/${plantId}/issues/${entityId}/photos/${Date.now()}_${objectHash.slice(0, 12)}_${fileName}`;
    } else if (scope === 'note') {
      key = `plants/${plantId}/notes/${entityId}/attachments/${Date.now()}_${objectHash.slice(0, 12)}_${fileName}`;
    } else if (scope === 'wiki') {
      key = wikiScope === 'press'
        ? `plants/${plantId}/presses/${pressId || 'unknown'}/wikiPages/${entityId}/attachments/${Date.now()}_${objectHash.slice(0, 12)}_${fileName}`
        : `plants/${plantId}/wikiPages/${entityId}/attachments/${Date.now()}_${objectHash.slice(0, 12)}_${fileName}`;
    } else {
      key = `plants/${plantId}/conversations/${entityId}/photos/${Date.now()}_${objectHash.slice(0, 12)}_${fileName}`;
    }
    await bucket.put(key, bytes, {
      httpMetadata: {
        contentType: declaredContentType,
        cacheControl: 'public, max-age=31536000, immutable'
      },
      customMetadata: {
        plantId: String(plantId || ''),
        scope,
        entityId,
        uploadedByUid: actor.uid,
        uploadedByName: actor.name || actor.email || actor.uid
      }
    });
    const downloadUrl = await buildAttachmentObjectUrl(request.url, key, env);
    return jsonResponse({
      ok: true,
      attachment: {
        storageBucket: 'r2',
        storagePath: key,
        contentType: declaredContentType,
        sizeBytes: bytes.byteLength,
        fileName,
        uploadedBy: { uid: actor.uid, name: actor.name || actor.email || actor.uid },
        uploadedAt: new Date().toISOString(),
        url: downloadUrl,
        downloadUrl
      }
    }, { status: 201 });
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Attachment upload failed.' }, { status: error?.status || 500 });
  }
}

async function handleAttachmentDelete(request, env, plantId) {
  if (request.method !== 'DELETE') return jsonResponse({ error: 'DELETE required' }, { status: 405 });
  const bucket = getAttachmentBucket(env);
  if (!bucket) {
    return jsonResponse({ error: 'Attachment bucket is not configured.' }, { status: 501 });
  }
  try {
    await requirePlantAccess(env, plantId, request, null);
    const body = await request.json();
    const storagePath = String(body.storagePath || '').trim();
    if (!storagePath || !storagePath.startsWith(`plants/${plantId}/`)) {
      throw Object.assign(new Error('Invalid storagePath.'), { status: 400 });
    }
    await bucket.delete(storagePath);
    return jsonResponse({ ok: true, storagePath });
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Attachment delete failed.' }, { status: error?.status || 500 });
  }
}

async function handleAttachmentObject(request, env) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const bucket = getAttachmentBucket(env);
  if (!bucket) return new Response('Attachment bucket is not configured.', { status: 404 });
  const url = new URL(request.url);
  const storagePath = String(url.searchParams.get('path') || '').trim();
  const sig = String(url.searchParams.get('sig') || '').trim();
  if (!storagePath || !sig || !(await verifyAttachmentSignature(storagePath, sig, env))) {
    return new Response('Invalid attachment URL.', { status: 403 });
  }
  const object = await bucket.get(storagePath);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  if (url.searchParams.get('download') === '1') {
    const filename = normalizeAttachmentFileName(url.searchParams.get('filename') || storagePath.split('/').pop(), 'attachment');
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  }
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
  return new Response(object.body, { status: 200, headers });
}

function migrationReadiness(env) {
  const hasD1 = Boolean(env.APTRACKER_DB || env.DB);
  const hasSessionSecret = Boolean(env.APP_SESSION_SECRET || env.AP_SESSION_SECRET);
  const hasGoogleServiceAccount = Boolean(env.GOOGLE_SERVICE_ACCOUNT);
  const hasFirebaseWebApiKey = Boolean(env.FIREBASE_WEB_API_KEY || FIREBASE_WEB_API_KEY);
  const hasWebPush = Boolean(env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY);
  return {
    ready: hasD1 && hasSessionSecret,
    bindings: {
      d1: hasD1,
      appSessionSecret: hasSessionSecret
    },
    runtimeDependencies: {
      firebaseAuthSessionExchange: hasFirebaseWebApiKey,
      fcmPushDelivery: hasGoogleServiceAccount,
      webPushDelivery: hasWebPush
    },
    migrationState: {
      sqlApiAuthOnly: true,
      fullyOffFirebaseAuth: false,
      fullyOffFirebasePush: false
    },
    remainingSteps: [
      'Replace Firebase/Google sign-in if you want to fully leave Firebase Auth.',
      'Remove FCM fallback after Web Push has enough active subscriptions.'
    ]
  };
}

async function handleMigrationReadiness(request, env) {
  if (request.method !== 'GET') return jsonResponse({ error: 'GET required' }, { status: 405 });
  try {
    await authenticateAppRequest(request, env);
    return jsonResponse(migrationReadiness(env));
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
  }
}

async function handleWebPushVapidPublicKey(request, env) {
  if (request.method !== 'GET') return jsonResponse({ error: 'GET required' }, { status: 405 });
  const publicKey = String(env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
  return jsonResponse({
    configured: Boolean(publicKey),
    publicKey
  });
}

async function sendFcmToTokens(env, tokens, payload) {
  const uniqueTokens = Array.from(new Set((tokens || []).filter(Boolean)));
  if (!uniqueTokens.length) return { attempted: 0, sent: 0, failed: 0, errors: [] };

  const projectId = env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID;
  const oauthToken = await getGoogleOAuthToken(env);
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const results = [];
  for (const registrationToken of uniqueTokens) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + oauthToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: registrationToken,
          data: Object.fromEntries(Object.entries({
            ...(payload.data || {}),
            title: payload.notification?.title || '',
            body: payload.notification?.body || ''
          }).map(([k, v]) => [k, String(v ?? '')])),
          webpush: {
            fcm_options: { link: payload.link || '/index.html' }
          }
        }
      })
    });
    const data = await res.json().catch(() => ({}));
    results.push({ ok: res.ok, status: res.status, data });
  }
  return {
    attempted: uniqueTokens.length,
    sent: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    errors: results.filter(r => !r.ok).slice(0, 5).map(r => ({ status: r.status, error: r.data?.error?.message || 'FCM send failed' }))
  };
}

function getWebPushVapidConfig(env) {
  const publicKey = String(env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.WEB_PUSH_VAPID_PRIVATE_KEY || '').trim();
  const subject = String(env.WEB_PUSH_VAPID_SUBJECT || 'mailto:admin@aptracker.local').trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

function payloadToWebPushPayload(payload = {}) {
  const title = payload.notification?.title || payload.data?.title || 'AP Tracker';
  const body = payload.notification?.body || payload.data?.body || '';
  return {
    title,
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: {
      ...(payload.data || {}),
      url: payload.link || payload.data?.url || '/index.html'
    }
  };
}

function parseWebPushSubscription(token) {
  if (!token) return null;
  if (typeof token === 'object') return token;
  try {
    const parsed = JSON.parse(String(token));
    if (parsed?.endpoint && parsed?.keys?.p256dh && parsed?.keys?.auth) return parsed;
  } catch {}
  return null;
}

async function sendWebPushToTokens(env, tokens, payload) {
  const subscriptions = Array.from(new Map((tokens || [])
    .map(parseWebPushSubscription)
    .filter(Boolean)
    .map(subscription => [subscription.endpoint, subscription])).values());
  if (!subscriptions.length) return { attempted: 0, sent: 0, failed: 0, errors: [] };
  const vapid = getWebPushVapidConfig(env);
  if (!vapid) return { attempted: 0, sent: 0, failed: subscriptions.length, errors: [{ error: 'Web Push VAPID config is not configured.' }] };

  const webPayload = payloadToWebPushPayload(payload);
  const results = [];
  for (const subscription of subscriptions) {
    try {
      const ok = await sendPushNotification(subscription, webPayload, vapid);
      results.push({ ok });
    } catch (error) {
      results.push({ ok: false, error: error?.message || 'Web Push send failed' });
    }
  }
  return {
    attempted: subscriptions.length,
    sent: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    errors: results.filter(r => !r.ok).slice(0, 5).map(r => ({ error: r.error || 'Web Push send failed' }))
  };
}

async function pushTokensByUser(env, userIds) {
  const entries = await Promise.all(Array.from(new Set(userIds || [])).filter(Boolean).map(async uid => {
    const [webPush, fcm] = await Promise.all([
      listUserD1PushTokens(env, uid, 'web-push').catch(() => []),
      listUserD1FcmTokens(env, uid).catch(() => [])
    ]);
    return { uid, webPush, fcm };
  }));
  return entries;
}

async function sendPushToUsers(env, userIds, payload) {
  const tokenRows = await pushTokensByUser(env, userIds);
  const webPushTokens = [];
  const fcmTokens = [];
  for (const entry of tokenRows) {
    if (entry.webPush.length) {
      webPushTokens.push(...entry.webPush.map(t => t.token));
    } else {
      fcmTokens.push(...entry.fcm.map(t => t.token));
    }
  }
  const [webPush, fcm] = await Promise.all([
    sendWebPushToTokens(env, webPushTokens, payload),
    sendFcmToTokens(env, fcmTokens, payload)
  ]);
  return {
    attempted: webPush.attempted + fcm.attempted,
    sent: webPush.sent + fcm.sent,
    failed: webPush.failed + fcm.failed,
    providers: {
      webPush,
      fcm
    },
    errors: [
      ...(webPush.errors || []).map(error => ({ provider: 'web-push', ...error })),
      ...(fcm.errors || []).map(error => ({ provider: 'fcm', ...error }))
    ].slice(0, 10)
  };
}

function getNotificationsQueue(env) {
  return env.APTRACKER_NOTIFICATIONS_QUEUE || env.NOTIFICATIONS_QUEUE || null;
}

async function enqueueNotificationJob(env, job) {
  const queue = getNotificationsQueue(env);
  if (!queue?.send) return false;
  await queue.send({
    version: 1,
    enqueuedAt: new Date().toISOString(),
    ...job
  });
  return true;
}

function buildQueuedDelivery(previousDelivery = null, extra = {}) {
  const previous = previousDelivery && typeof previousDelivery === 'object' ? previousDelivery : {};
  return {
    ...previous,
    ...extra,
    queuedAt: new Date().toISOString(),
    deliveryMode: 'queue',
    queue: 'aptracker-notifications'
  };
}

function isDeliverySent(delivery) {
  return Boolean(delivery?.sentAt);
}

function getD1Db(env) {
  return env.APTRACKER_DB || env.DB || null;
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getD1NotificationDelivery(row) {
  return parseJsonObject(row?.notification_delivery_json);
}

async function getD1RoleAlert(env, plantId, alertId) {
  const db = getD1Db(env);
  if (!db || !plantId || !alertId) return null;
  const result = await db.prepare(`
    SELECT *
    FROM role_feed_alerts
    WHERE plant_id = ? AND alert_id = ?
    LIMIT 1
  `).bind(plantId, alertId).first();
  if (!result) return null;
  return {
    row: result,
    createdBy: parseJsonObject(result.created_by_json),
    raw: parseJsonObject(result.raw_json),
    recipientUserIds: parseJsonArray(result.recipient_user_ids_json),
    notificationDelivery: getD1NotificationDelivery(result)
  };
}

async function getD1Conversation(env, plantId, conversationId) {
  const db = getD1Db(env);
  if (!db || !plantId || !conversationId) return null;
  const result = await db.prepare(`
    SELECT *
    FROM conversations
    WHERE plant_id = ? AND conversation_id = ?
    LIMIT 1
  `).bind(plantId, conversationId).first();
  if (!result) return null;
  return {
    row: result,
    memberIds: parseJsonArray(result.member_ids_json),
    lastMessage: parseJsonObject(result.last_message_json)
  };
}

async function getD1ConversationMessage(env, plantId, conversationId, messageId) {
  const db = getD1Db(env);
  if (!db || !plantId || !conversationId || !messageId) return null;
  const result = await db.prepare(`
    SELECT *
    FROM conversation_messages
    WHERE plant_id = ? AND conversation_id = ? AND message_id = ?
    LIMIT 1
  `).bind(plantId, conversationId, messageId).first();
  if (!result) return null;
  return {
    row: result,
    attachments: parseJsonArray(result.attachments_json),
    mentions: parseJsonArray(result.mentions_json),
    notificationDelivery: getD1NotificationDelivery(result)
  };
}

async function patchD1RoleAlertNotificationDelivery(env, plantId, alertId, delivery) {
  const db = getD1Db(env);
  if (!db || !plantId || !alertId || !delivery) return false;
  try {
    await db.prepare(`
      UPDATE role_feed_alerts
      SET notification_delivery_json = ?,
          updated_at = ?
      WHERE plant_id = ? AND alert_id = ?
    `).bind(JSON.stringify(delivery), new Date().toISOString(), plantId, alertId).run();
    return true;
  } catch (error) {
    if (String(error?.message || '').includes('no such column')) {
      return false;
    }
    throw error;
  }
}

async function patchD1ConversationMessageNotificationDelivery(env, plantId, conversationId, messageId, delivery) {
  const db = getD1Db(env);
  if (!db || !plantId || !conversationId || !messageId || !delivery) return false;
  try {
    await db.prepare(`
      UPDATE conversation_messages
      SET notification_delivery_json = ?
      WHERE plant_id = ? AND conversation_id = ? AND message_id = ?
    `).bind(JSON.stringify(delivery), plantId, conversationId, messageId).run();
    return true;
  } catch (error) {
    if (String(error?.message || '').includes('no such column')) {
      return false;
    }
    throw error;
  }
}

function addRecipientId(set, value) {
  const uid = String(value || '').trim();
  if (uid) set.add(uid);
}

function issueTimerRecipientIds(issue) {
  const recipients = new Set();
  const timer = issue?.timer || {};
  addRecipientId(recipients, timer.notificationOwnerUid);
  addRecipientId(recipients, timer.notificationRequestedBy?.uid);
  addRecipientId(recipients, issue?.createdBy?.uid);
  addRecipientId(recipients, issue?.userId);
  addRecipientId(recipients, issue?.ownerUid);
  addRecipientId(recipients, issue?.createdByUid);
  addRecipientId(recipients, issue?.submitterUid);
  addRecipientId(recipients, issue?.assignedToUid);
  for (const uid of Array.isArray(issue?.watcherUids) ? issue.watcherUids : []) addRecipientId(recipients, uid);
  return Array.from(recipients);
}

function issueTimerMessage(issue, plantId, issueId) {
  const machine = issue?.machine || issue?.machineCode || 'Unknown';
  const title = `Timer due - Press ${machine}`;
  const note = String(issue?.note || '').trim();
  const body = note ? note.slice(0, 140) : 'Go back and check the issue.';
  return {
    notification: { title, body },
    data: { type: 'issue-timer', plantId, issueId, title, body, url: '/index.html' },
    link: '/index.html'
  };
}

function issueTimerEntryFromD1Row(row) {
  const delivery = parseJsonObject(row.timer_notification_delivery_json);
  const pauseMeta = delivery?.__pauseMeta || null;
  return {
    source: 'd1',
    plantId: row.plant_id,
    issueId: row.issue_id,
    issue: {
      machineCode: row.machine_code,
      machine: row.machine_code,
      note: row.note,
      createdByUid: row.created_by_uid,
      ownerUid: row.assigned_user_uid,
      assignedToUid: row.assigned_user_uid,
      timer: {
        enabled: Boolean(row.timer_enabled),
        startedAt: row.timer_started_at || null,
        dueAt: row.timer_due_at || null,
        dueAtMs: row.timer_due_at_ms == null ? null : Number(row.timer_due_at_ms),
        durationMinutes: row.timer_duration_minutes == null ? null : Number(row.timer_duration_minutes),
        minutes: row.timer_duration_minutes == null ? null : Number(row.timer_duration_minutes),
        notificationStatus: row.timer_notification_status,
        notificationOwnerUid: row.timer_notification_owner_uid,
        notificationRequestedBy: parseJsonObject(row.timer_notification_requested_by_json),
        notificationDelivery: delivery,
        paused: Boolean(pauseMeta?.paused),
        pausedAtMs: pauseMeta?.pausedAtMs == null ? null : Number(pauseMeta.pausedAtMs),
        pausedRemainingMs: pauseMeta?.pausedRemainingMs == null ? null : Number(pauseMeta.pausedRemainingMs)
      }
    }
  };
}

async function listPendingIssueTimersD1(env, limit = 100) {
  const db = getD1Db(env);
  if (!db) return [];
  try {
    const result = await db.prepare(`
      SELECT *
      FROM issues
      WHERE timer_enabled = 1
        AND timer_notification_status = 'pending'
      ORDER BY timer_due_at_ms ASC, created_at ASC
      LIMIT ?
    `).bind(limit).all();
    const rows = Array.isArray(result?.results) ? result.results : [];
    return rows.map(issueTimerEntryFromD1Row);
  } catch (error) {
    if (String(error?.message || '').includes('no such column')) {
      return [];
    }
    throw error;
  }
}

async function getIssueTimerEntryD1(env, plantId, issueId) {
  const db = getD1Db(env);
  if (!db || !plantId || !issueId) return null;
  try {
    const row = await db.prepare(`
      SELECT *
      FROM issues
      WHERE plant_id = ? AND issue_id = ?
      LIMIT 1
    `).bind(plantId, issueId).first();
    return row ? issueTimerEntryFromD1Row(row) : null;
  } catch (error) {
    if (String(error?.message || '').includes('no such column')) {
      return null;
    }
    throw error;
  }
}

async function patchD1IssueTimerNotification(env, plantId, issueId, timerPatch) {
  const db = getD1Db(env);
  if (!db || !plantId || !issueId || !timerPatch) return false;
  try {
    await db.prepare(`
      UPDATE issues
      SET timer_notification_status = ?,
          timer_notification_delivery_json = ?,
          updated_at = ?
      WHERE plant_id = ? AND issue_id = ?
    `).bind(
      timerPatch.notificationStatus || null,
      JSON.stringify(timerPatch.notificationDelivery || null),
      new Date().toISOString(),
      plantId,
      issueId
    ).run();
    return true;
  } catch (error) {
    if (String(error?.message || '').includes('no such column')) {
      return false;
    }
    throw error;
  }
}

async function deliverIssueTimerPush(env, plantId, issueId) {
  const entry = await getIssueTimerEntryD1(env, plantId, issueId);
  if (!entry) return { skipped: true, reason: 'issue-not-found' };

  const { issue } = entry;
  const timer = issue?.timer || {};
  const deliveryBefore = timer.notificationDelivery || null;
  if (isDeliverySent(deliveryBefore)) return { skipped: true, reason: 'already-sent' };

  const dueAtMs = Number(timer.dueAtMs || 0);
  if (!timer.enabled || !Number.isFinite(dueAtMs) || dueAtMs > Date.now()) {
    return { skipped: true, reason: 'timer-not-due' };
  }

  const recipients = issueTimerRecipientIds(issue);
  try {
    const result = await sendPushToUsers(env, recipients, issueTimerMessage(issue, plantId, issueId));
    const delivery = {
      ...(deliveryBefore || {}),
      sentAt: new Date().toISOString(),
      recipientUserIds: recipients,
      attempted: result.attempted,
      sent: result.sent,
      failed: result.failed,
      providers: result.providers || null,
      errors: result.errors || []
    };
    await patchD1IssueTimerNotification(env, plantId, issueId, {
      notificationStatus: result.sent > 0 ? 'sent' : 'failed',
      notificationDelivery: delivery
    });
    return { ok: true, ...result };
  } catch (error) {
    const failedDelivery = {
      ...(deliveryBefore || {}),
      sentAt: new Date().toISOString(),
      recipientUserIds: recipients,
      attempted: 0,
      sent: 0,
      failed: 1,
      errors: [{ error: error.message }]
    };
    await patchD1IssueTimerNotification(env, plantId, issueId, {
      notificationStatus: 'failed',
      notificationDelivery: failedDelivery
    }).catch(() => {});
    throw error;
  }
}

async function processDueIssueTimers(env) {
  const nowMs = Date.now();
  const pending = await listPendingIssueTimersD1(env);
  const summary = { checked: pending.length, due: 0, queued: 0, attempted: 0, sent: 0, failed: 0, skipped: 0, errors: [] };

  for (const entry of pending) {
    const { issue } = entry;
    const pathParts = { plantId: entry.plantId, issueId: entry.issueId };
    const timer = issue?.timer || {};
    const dueAtMs = Number(timer.dueAtMs || 0);
    if (!pathParts?.plantId || !pathParts?.issueId || !timer.enabled || !Number.isFinite(dueAtMs) || dueAtMs > nowMs) {
      summary.skipped += 1;
      continue;
    }

    summary.due += 1;
    const recipients = issueTimerRecipientIds(issue);
    try {
      const queued = await enqueueNotificationJob(env, {
        type: 'issue-timer',
        plantId: pathParts.plantId,
        issueId: pathParts.issueId
      });
      if (queued) {
        summary.queued += 1;
        await patchD1IssueTimerNotification(env, pathParts.plantId, pathParts.issueId, {
          notificationStatus: 'queued',
          notificationDelivery: buildQueuedDelivery(timer.notificationDelivery, {
            recipientUserIds: recipients
          })
        });
        continue;
      }

      const result = await deliverIssueTimerPush(env, pathParts.plantId, pathParts.issueId);
      summary.attempted += Number(result.attempted || 0);
      summary.sent += Number(result.sent || 0);
      summary.failed += Number(result.failed || 0);
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({ issueId: pathParts.issueId, error: error.message });
    }
  }

  return summary;
}

async function handleFcmDueIssueTimers(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, { status: 405 });
  try {
    await authenticateAppRequest(request, env);
    const summary = await processDueIssueTimers(env);
    return jsonResponse({ ok: true, ...summary });
  } catch (e) {
    return jsonResponse({ error: e.message }, { status: 500 });
  }
}

async function deliverRoleAlertPush(env, plantId, alertId, excludeUid = '') {
  if (!plantId || !alertId) return { skipped: true, reason: 'missing-identifiers' };
  const d1Alert = await getD1RoleAlert(env, plantId, alertId);
  if (!d1Alert) return { skipped: true, reason: 'alert-not-found' };
  if (isDeliverySent(d1Alert.notificationDelivery)) return { skipped: true, reason: 'already-sent' };

  const recipients = (Array.isArray(d1Alert.recipientUserIds)
    ? d1Alert.recipientUserIds
    : [])
    .filter(uid => uid && uid !== excludeUid);
  const title = d1Alert.row.feed_label || d1Alert.row.title || d1Alert.raw?.feedLabel || 'AP Tracker Alert';
  const body = d1Alert.row.body || d1Alert.raw?.note || d1Alert.raw?.body || 'New alert';
  const result = await sendPushToUsers(env, recipients, {
    notification: { title, body },
    data: {
      type: 'role-alert',
      plantId,
      alertId,
      issueId: d1Alert.row.issue_id || d1Alert.raw?.issueId || '',
      title,
      body,
      url: '/index.html'
    },
    link: '/index.html'
  });
  const delivery = {
    ...(d1Alert.notificationDelivery || {}),
    sentAt: new Date().toISOString(),
    recipientUserIds: recipients,
    attempted: result.attempted,
    sent: result.sent,
    failed: result.failed,
    providers: result.providers || null,
    errors: result.errors || []
  };
  await patchD1RoleAlertNotificationDelivery(env, plantId, alertId, delivery);
  return { ok: true, ...result };
}

async function handleFcmRoleAlert(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, { status: 405 });
  try {
    const user = await authenticateAppRequest(request, env);
    const { plantId, alertId } = await request.json();
    if (!plantId || !alertId) return jsonResponse({ error: 'plantId and alertId are required.' }, { status: 400 });

    const d1Alert = await getD1RoleAlert(env, plantId, alertId);
    if (!d1Alert) return jsonResponse({ error: 'Alert not found.' }, { status: 404 });
    if (isDeliverySent(d1Alert.notificationDelivery)) return jsonResponse({ skipped: true, reason: 'already-sent' });

    const createdByUid = String(d1Alert.createdBy?.uid || d1Alert.raw?.createdBy?.uid || '').trim();
    if (createdByUid !== user.localId) {
      return jsonResponse({ error: 'Only the alert creator can trigger push delivery.' }, { status: 403 });
    }

    const queued = await enqueueNotificationJob(env, {
      type: 'role-alert',
      plantId,
      alertId,
      requestedByUid: user.localId
    });
    if (queued) {
      await patchD1RoleAlertNotificationDelivery(env, plantId, alertId, buildQueuedDelivery(d1Alert.notificationDelivery, {
        requestedByUid: user.localId
      }));
      return jsonResponse({ ok: true, queued: true });
    }

    const result = await deliverRoleAlertPush(env, plantId, alertId, user.localId);
    return jsonResponse({ ok: true, ...result });
  } catch (e) {
    return jsonResponse({ error: e.message }, { status: 500 });
  }
}

async function deliverConversationMessagePush(env, plantId, conversationId, messageId) {
  if (!plantId || !conversationId || !messageId) return { skipped: true, reason: 'missing-identifiers' };
  const [d1Conversation, d1Message] = await Promise.all([
    getD1Conversation(env, plantId, conversationId),
    getD1ConversationMessage(env, plantId, conversationId, messageId)
  ]);
  if (!d1Conversation || !d1Message) return { skipped: true, reason: 'conversation-or-message-not-found' };
  if (isDeliverySent(d1Message.notificationDelivery)) return { skipped: true, reason: 'already-sent' };

  const senderUid = String(d1Message.row.sender_uid || '').trim();
  const recipients = (Array.isArray(d1Conversation.memberIds)
    ? d1Conversation.memberIds
    : [])
    .filter(uid => uid && uid !== senderUid);
  const senderName = d1Message.row.sender_name || 'Someone';
  const title = d1Conversation.row.type === 'dm'
    ? `Message from ${senderName}`
    : (d1Conversation.row.title || 'AP Tracker Message');
  const body = d1Message.row.body || (d1Message.attachments.length ? 'Sent a photo' : 'New message');
  const result = await sendPushToUsers(env, recipients, {
    notification: { title, body },
    data: { type: 'conversation-message', plantId, conversationId, messageId, title, body, url: '/index.html' },
    link: '/index.html'
  });
  const delivery = {
    ...(d1Message.notificationDelivery || {}),
    sentAt: new Date().toISOString(),
    recipientUserIds: recipients,
    attempted: result.attempted,
    sent: result.sent,
    failed: result.failed,
    providers: result.providers || null,
    errors: result.errors || []
  };
  await patchD1ConversationMessageNotificationDelivery(env, plantId, conversationId, messageId, delivery);
  return { ok: true, ...result };
}

async function handleFcmConversationMessage(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, { status: 405 });
  try {
    const user = await authenticateAppRequest(request, env);
    const { plantId, conversationId, messageId } = await request.json();
    if (!plantId || !conversationId || !messageId) {
      return jsonResponse({ error: 'plantId, conversationId, and messageId are required.' }, { status: 400 });
    }

    const [d1Conversation, d1Message] = await Promise.all([
      getD1Conversation(env, plantId, conversationId),
      getD1ConversationMessage(env, plantId, conversationId, messageId)
    ]);
    if (!d1Conversation || !d1Message) return jsonResponse({ error: 'Conversation or message not found.' }, { status: 404 });
    if (isDeliverySent(d1Message.notificationDelivery)) return jsonResponse({ skipped: true, reason: 'already-sent' });

    const senderUid = String(d1Message.row.sender_uid || '').trim();
    if (senderUid !== user.localId) {
      return jsonResponse({ error: 'Only the sender can trigger push delivery.' }, { status: 403 });
    }

    const queued = await enqueueNotificationJob(env, {
      type: 'conversation-message',
      plantId,
      conversationId,
      messageId,
      requestedByUid: user.localId
    });
    if (queued) {
      await patchD1ConversationMessageNotificationDelivery(env, plantId, conversationId, messageId, buildQueuedDelivery(d1Message.notificationDelivery, {
        requestedByUid: user.localId
      }));
      return jsonResponse({ ok: true, queued: true });
    }

    const result = await deliverConversationMessagePush(env, plantId, conversationId, messageId);
    return jsonResponse({ ok: true, ...result });
  } catch (e) {
    return jsonResponse({ error: e.message }, { status: 500 });
  }
}

async function processNotificationQueueMessage(env, body = {}) {
  const type = String(body.type || '').trim();
  if (type === 'role-alert') {
    return deliverRoleAlertPush(
      env,
      String(body.plantId || ''),
      String(body.alertId || ''),
      String(body.requestedByUid || '')
    );
  }
  if (type === 'conversation-message') {
    return deliverConversationMessagePush(
      env,
      String(body.plantId || ''),
      String(body.conversationId || ''),
      String(body.messageId || '')
    );
  }
  if (type === 'issue-timer') {
    return deliverIssueTimerPush(
      env,
      String(body.plantId || ''),
      String(body.issueId || '')
    );
  }
  console.warn('Skipping unknown notification queue job type:', type);
  return { skipped: true, reason: 'unknown-type' };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isApiRequest = url.pathname.startsWith('/api/');

    try {
      if (isAuthHelperRequest(url.pathname)) {
        const upstreamUrl = new URL(url.pathname + url.search, FIREBASE_AUTH_ORIGIN);
        const upstreamRequest = new Request(upstreamUrl.toString(), request);
        return fetch(upstreamRequest);
      }

      const d1ApiResponse = await handleD1ApiRequest(request, env, {
        authenticateRequest: authenticateAppRequest
      });
      if (d1ApiResponse) {
        return d1ApiResponse;
      }

      if (url.pathname === '/api/ocr') {
        return handleOcr(request, env);
      }
      if (url.pathname === '/api/session/exchange') {
        return handleSessionExchange(request, env);
      }
      if (url.pathname === '/api/migration-readiness') {
        return handleMigrationReadiness(request, env);
      }
      if (url.pathname === '/api/push/vapid-public-key') {
        return handleWebPushVapidPublicKey(request, env);
      }
      const attachmentUploadMatch = request.method === 'POST' && url.pathname.match(/^\/api\/plants\/([^/]+)\/attachments\/upload$/);
      if (attachmentUploadMatch) {
        return handleAttachmentUpload(request, env, decodeURIComponent(attachmentUploadMatch[1]));
      }
      const attachmentDeleteMatch = request.method === 'DELETE' && url.pathname.match(/^\/api\/plants\/([^/]+)\/attachments\/object$/);
      if (attachmentDeleteMatch) {
        return handleAttachmentDelete(request, env, decodeURIComponent(attachmentDeleteMatch[1]));
      }
      if (url.pathname === '/api/storage/object') {
        return handleAttachmentObject(request, env);
      }
      if (url.pathname === '/api/ocr/google') {
        return handleOcrGoogle(request, env);
      }
      if (url.pathname === '/api/ocr/document-ai') {
        return handleOcrDocumentAi(request, env);
      }
      if (url.pathname === '/api/ocr/textract') {
        return handleOcrTextract(request, env);
      }
      if (url.pathname === '/api/ai/convert') {
        return handleAiConvert(request, env);
      }
      if (url.pathname === '/api/schedule-scan') {
        return handleScheduleScan(request, env);
      }
      if (url.pathname === '/api/debug-image') {
        return handleDebugImage(request, env);
      }
      if (url.pathname === '/api/import-schedule') {
        return handleImportSchedule(request, env);
      }
      if (url.pathname === '/api/fcm/role-alert') {
        return handleFcmRoleAlert(request, env);
      }
      if (url.pathname === '/api/fcm/conversation-message') {
        return handleFcmConversationMessage(request, env);
      }
      if (url.pathname === '/api/fcm/due-issue-timers') {
        return handleFcmDueIssueTimers(request, env);
      }
      if (url.pathname === '/api/debug') {
        const info = {};
        for (const key of Object.keys(env)) {
          const val = env[key];
          info[key] = typeof val === 'string' ? `string length ${val.length} (starts with ${val.slice(0, 6)}...)` : typeof val;
        }
        try {
          const token = await getGoogleOAuthToken(env);
          info['OAuth_TEST'] = 'SUCCESS - token starts with ' + token.slice(0, 10) + '...';
        } catch (e) {
          info['OAuth_TEST'] = 'FAILED - ' + e.message;
        }
        return new Response(JSON.stringify(info, null, 2), { headers: { 'Content-Type': 'application/json' } });
      }

      const assetResponse = await env.ASSETS.fetch(request);
      return withStaticCacheHeaders(assetResponse, url.pathname);
    } catch (error) {
      if (isApiRequest) {
        return jsonResponse({ error: error?.message || 'Internal server error' }, { status: error?.status || 500 });
      }
      throw error;
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(processDueIssueTimers(env));
  },

  async queue(batch, env, ctx) {
    const failures = [];
    for (const message of batch.messages || []) {
      try {
        await processNotificationQueueMessage(env, message.body || {});
      } catch (error) {
        console.error('Notification queue message failed:', error);
        failures.push(error);
      }
    }
    if (failures.length) {
      throw failures[0];
    }
  }
};
