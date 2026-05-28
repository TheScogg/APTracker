const NOTE_ALLOWED_TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'A', 'DIV', 'SPAN', 'CODE', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3']);

export function sanitizeNoteHtml(html = '') {
  const source = String(html || '');
  if (!source) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${source}</div>`, 'text/html');
  const root = doc.body.firstElementChild || doc.body;
  const out = document.createElement('div');

  const appendSanitized = (parentOut, node) => {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      parentOut.appendChild(document.createTextNode(node.textContent || ''));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = String(node.tagName || '').toUpperCase();
    if (!NOTE_ALLOWED_TAGS.has(tag)) {
      node.childNodes.forEach(child => appendSanitized(parentOut, child));
      return;
    }
    const el = document.createElement(tag.toLowerCase());
    if (tag === 'A') {
      const href = String(node.getAttribute('href') || '').trim();
      if (href && !/^javascript:/i.test(href)) {
        el.setAttribute('href', href);
        el.setAttribute('rel', 'noopener noreferrer');
        el.setAttribute('target', '_blank');
      }
    }
    node.childNodes.forEach(child => appendSanitized(el, child));
    parentOut.appendChild(el);
  };

  root.childNodes.forEach(child => appendSanitized(out, child));
  return out.innerHTML;
}

export function noteTextFromHtml(html = '') {
  const wrap = document.createElement('div');
  wrap.innerHTML = sanitizeNoteHtml(html);
  return String(wrap.textContent || '').replace(/\s+\n/g, '\n').trim();
}

export function normalizeChecklistItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map(item => ({
      id: String(item?.id || `chk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      text: String(item?.text || ''),
      done: Boolean(item?.done)
    }))
    .filter(item => item.id || item.text);
}
