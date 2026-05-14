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

    return env.ASSETS.fetch(request);
  }
};
