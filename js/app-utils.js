const alphaCanvasCtx = document.createElement('canvas').getContext('2d');

export function extFromContentType(contentType) {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'bin';
}

export function parseDataUrlMeta(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const contentType = match[1] || 'application/octet-stream';
  const base64Body = match[2] || '';
  const sizeBytes = Math.max(0, Math.floor((base64Body.length * 3) / 4));
  return { contentType, sizeBytes };
}

export function alphaColor(color, alpha = 0.12) {
  const a = Math.max(0, Math.min(1, Number(alpha)));
  if (!alphaCanvasCtx || !color) return `rgba(0,0,0,${a})`;

  alphaCanvasCtx.fillStyle = '#000000';
  alphaCanvasCtx.fillStyle = String(color);
  const normalized = alphaCanvasCtx.fillStyle;
  const match = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) return `rgba(0,0,0,${a})`;

  let hex = match[1];
  if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
  const value = parseInt(hex, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export function localDateStr(date) {
  const pad = value => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

export function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
