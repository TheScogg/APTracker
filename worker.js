const FIREBASE_AUTH_ORIGIN = 'https://press-tracker-9d9c9.firebaseapp.com';

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
    return new Response(JSON.stringify(parsed), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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
- Auto-detect shift (1, 2, or 3) from the schedule header or text.
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
      status: 500,
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

// ── Import schedule JSON to Firestore ─────────────────────────────────

function firestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'boolean') return { booleanValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(v => firestoreValue(v)) } };
  return { stringValue: String(val) };
}

async function handleImportSchedule(request, env) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let plantId;
  try {
    const url = new URL(request.url);
    plantId = url.searchParams.get('plant');
    if (!plantId) throw new Error('Missing ?plant= parameter');
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const scheduleJson = await request.json();
    if (!scheduleJson || !scheduleJson.schedule_info || !scheduleJson.schedule_info.date) {
      return new Response(JSON.stringify({ error: 'Invalid schedule JSON — missing schedule_info.date' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const saJson = env.GOOGLE_SERVICE_ACCOUNT;
    if (!saJson) throw new Error('GOOGLE_SERVICE_ACCOUNT not configured');
    const sa = JSON.parse(saJson);
    const projectId = sa.project_id;
    const token = await getGoogleOAuthToken(env);

    const scheduleDate = scheduleJson.schedule_info.date;
    const basePath = `projects/${projectId}/databases/(default)/documents/plants/${plantId}/dailySchedules/${scheduleDate}`;
    const now = new Date();

    // Build writes array
    const writes = [];

    // Main doc
    const mainFields = {};
    const mainPairs = [
      ['scheduleDate', scheduleDate],
      ['plantId', plantId],
      ['shift', scheduleJson.schedule_info.shift],
      ['lineSpeed', scheduleJson.schedule_info.line_speed],
      ['totalPlannedPcs', scheduleJson.schedule_info.total_planned_pcs],
      ['sourceFileName', 'iOS Shortcut'],
      ['sourceFileType', 'image/jpeg'],
      ['status', 'imported'],
      ['notes', scheduleJson.schedule_info.note],
      ['page1Count', (scheduleJson.page_1 || []).length],
      ['page2Count', (scheduleJson.page_2 || []).length],
      ['northBayChangesCount', (scheduleJson.north_bay_changes || []).length],
      ['southBayChangesCount', (scheduleJson.south_bay_changes || []).length]
    ];
    for (const [k, v] of mainPairs) mainFields[k] = firestoreValue(v);
    mainFields.updatedAt = { timestampValue: now.toISOString() };
    mainFields.createdAt = { timestampValue: now.toISOString() };

    writes.push({ update: { name: basePath, fields: mainFields } });

    // Section rows
    const sections = [
      { key: 'page_1', name: 'page1' },
      { key: 'page_2', name: 'page2' },
      { key: 'north_bay_changes', name: 'northBayChanges' },
      { key: 'south_bay_changes', name: 'southBayChanges' }
    ];

    for (const section of sections) {
      const rows = scheduleJson[section.key] || [];
      for (const row of rows) {
        const baseId = row.row_id || row.press || `row-${Math.random().toString(36).slice(2, 8)}`;
        const rowId = row.part_number ? `${baseId}_${row.part_number.replace(/[^a-zA-Z0-9]/g, '_')}` : baseId;
        const pslArray = Array.isArray(row.part_storage_location)
          ? row.part_storage_location
          : (row.part_storage_location ? [String(row.part_storage_location)] : []);

        const rowFields = {};
        const rPairs = [
          ['rowId', rowId],
          ['press', row.press],
          ['partStorageLocation', pslArray],
          ['partNumber', row.part_number],
          ['description', row.description],
          ['cavity', row.cavity],
          ['doh', row.doh],
          ['labelsPerShift', row.labels_per_shift],
          ['mc', row.mc],
          ['notes', row.notes],
          ['scheduleDate', scheduleDate],
          ['plantId', plantId],
          ['shift', scheduleJson.schedule_info.shift]
        ];
        for (const [k, v] of rPairs) rowFields[k] = firestoreValue(v);
        rowFields.updatedAt = { timestampValue: now.toISOString() };
        rowFields.createdAt = { timestampValue: now.toISOString() };

        writes.push({ update: { name: `${basePath}/${section.name}/${rowId}`, fields: rowFields } });
      }
    }

    // Commit in batches of 500 (Firestore limit)
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
    const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    for (let i = 0; i < writes.length; i += 500) {
      const batch = writes.slice(i, i + 500);
      const res = await fetch(commitUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ writes: batch })
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Firestore commit error (batch ${i / 500}): ${res.status} ${err}`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      plantId,
      date: scheduleDate,
      totalRows: scheduleJson.page_1.length + scheduleJson.page_2.length + scheduleJson.north_bay_changes.length + scheduleJson.south_bay_changes.length
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (isAuthHelperRequest(url.pathname)) {
      const upstreamUrl = new URL(url.pathname + url.search, FIREBASE_AUTH_ORIGIN);
      const upstreamRequest = new Request(upstreamUrl.toString(), request);
      return fetch(upstreamRequest);
    }

    if (url.pathname === '/api/ocr') {
      return handleOcr(request, env);
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
    if (url.pathname === '/api/debug') {
      const info = {};
      for (const key of Object.keys(env)) {
        const val = env[key];
        info[key] = typeof val === 'string' ? `string length ${val.length} (starts with ${val.slice(0, 6)}...)` : typeof val;
      }
      // Also test the OAuth flow
      try {
        const token = await getGoogleOAuthToken(env);
        info['OAuth_TEST'] = 'SUCCESS - token starts with ' + token.slice(0, 10) + '...';
      } catch (e) {
        info['OAuth_TEST'] = 'FAILED - ' + e.message;
      }
      return new Response(JSON.stringify(info, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    return env.ASSETS.fetch(request);
  }
};
