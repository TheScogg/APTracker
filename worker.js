const FIREBASE_AUTH_ORIGIN = 'https://press-tracker-9d9c9.firebaseapp.com';

function isAuthHelperRequest(pathname) {
  return pathname === '/__/auth' || pathname.startsWith('/__/auth/');
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
    const { images } = await request.json();
    if (!Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: 'Expected { images: [base64, ...] }' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const texts = [];
    for (const [i, image] of images.entries()) {
      const res = await fetch('https://vision.googleapis.com/v1/images:annotate?key=' + apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ image: { content: image }, features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }] }]
        })
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
    if (url.pathname === '/api/ai/convert') {
      return handleAiConvert(request, env);
    }
    if (url.pathname === '/api/debug') {
      const info = {};
      for (const key of Object.keys(env)) {
        const val = env[key];
        info[key] = typeof val === 'string' ? `string length ${val.length} (starts with ${val.slice(0, 6)}...)` : typeof val;
      }
      return new Response(JSON.stringify(info, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    return env.ASSETS.fetch(request);
  }
};
