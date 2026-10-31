import { maskNum, serverNow } from './common.js';

// A4 in PDF points; pages are drawn on a canvas at SCALE px per point
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const SCALE = 2;
const MARGIN = 36;
const COLS = 3;
const GAP = 12;
const HEADER_H = 100;
const FOOTER_H = 18;
const CARD_W = (PAGE_W - 2 * MARGIN - (COLS - 1) * GAP) / COLS;
// Square, like the host gallery
const CARD_H = CARD_W;
const FONT = '"Bricolage Grotesque", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function paginate(count) {
  const rows = (top) => Math.floor((PAGE_H - MARGIN - FOOTER_H - top + GAP) / (CARD_H + GAP));
  const firstPage = rows(MARGIN + HEADER_H) * COLS;
  const perPage = rows(MARGIN) * COLS;
  const pages = [count ? Math.min(count, firstPage) : 0];
  for (let left = count - pages[0]; left > 0; left -= perPage) pages.push(Math.min(left, perPage));
  return pages;
}

function drawHeader(ctx, c, state, count) {
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = c.accentText;
  ctx.font = `600 9px ${FONT}`;
  ctx.letterSpacing = '1.5px';
  ctx.fillText(`BEST COSTUME ${new Date(serverNow()).getFullYear()}`, MARGIN, MARGIN + 10);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = c.text;
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText(fit(ctx, state.party_name, PAGE_W - 2 * MARGIN), MARGIN, MARGIN + 46);

  ctx.fillStyle = c.muted;
  ctx.font = `400 12px ${FONT}`;
  ctx.fillText(`${count} costume${count === 1 ? '' : 's'}`, MARGIN, MARGIN + 68);
}

function drawFooter(ctx, c, state, page, pages) {
  ctx.fillStyle = c.faint;
  ctx.font = `500 8px ${MONO}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(state.party_name, MARGIN, PAGE_H - MARGIN + 6);
  ctx.textAlign = 'right';
  ctx.fillText(`${page} / ${pages}`, PAGE_W - MARGIN, PAGE_H - MARGIN + 6);
  ctx.textAlign = 'left';
}

function drawCard(ctx, c, mask, img, x, y) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, CARD_W, CARD_H, 12);
  ctx.clip();
  ctx.fillStyle = c.raised;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  if (img) {
    const s = Math.max(CARD_W / img.naturalWidth, CARD_H / img.naturalHeight);
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    ctx.drawImage(img, x + (CARD_W - w) / 2, y + (CARD_H - h) / 2, w, h);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.roundRect(x, y, CARD_W, CARD_H, 12);
  ctx.lineWidth = 1;
  ctx.strokeStyle = c.border;
  ctx.stroke();

  // Number badge, as on the website
  const num = maskNum(mask.number);
  ctx.font = `700 10px ${MONO}`;
  const badgeW = ctx.measureText(num).width + 10;
  ctx.beginPath();
  ctx.roundRect(x + 7, y + 7, badgeW, 17, 5);
  ctx.fillStyle = c.bg;
  ctx.fill();
  ctx.fillStyle = c.text;
  ctx.textBaseline = 'middle';
  ctx.fillText(num, x + 12, y + 16);
}

// Minimal PDF: one full-page JPEG per page
function buildPdf(jpegs) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (part) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id, ...parts) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    parts.forEach(push);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const kids = jpegs.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${jpegs.length} >>`);
  jpegs.forEach(({ bytes, width, height }, i) => {
    const page = 3 + i * 3;
    const draw = `q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Im0 Do Q`;
    object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`);
    object(page + 1, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    object(
      page + 2,
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`,
      bytes,
      '\nendstream',
    );
  });

  const xref = length;
  const size = offsets.length;
  push(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let id = 1; id < size; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

export async function downloadCostumesPdf(state) {
  const c = {
    bg: token('--bg'), raised: token('--raised'), border: token('--border-strong'),
    text: token('--text'), muted: token('--muted'), faint: token('--faint'), accentText: token('--accent-text'),
  };
  // Canvas text silently falls back to a system font if the web font isn't loaded yet
  await Promise.all([
    document.fonts.load(`400 12px ${FONT}`), document.fonts.load(`600 12px ${FONT}`),
    document.fonts.load(`800 12px ${FONT}`), document.fonts.load(`500 12px ${MONO}`),
    document.fonts.load(`700 12px ${MONO}`),
  ]);

  const masks = state.masks;
  const images = await Promise.all(masks.map((m) => loadImage(m.photo_url)));

  const pages = paginate(masks.length);
  const jpegs = [];
  let index = 0;
  for (let p = 0; p < pages.length; p++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(PAGE_W * SCALE);
    canvas.height = Math.round(PAGE_H * SCALE);
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    const top = p === 0 ? MARGIN + HEADER_H : MARGIN;
    if (p === 0) drawHeader(ctx, c, state, masks.length);
    for (let i = 0; i < pages[p]; i++, index++) {
      const x = MARGIN + (i % COLS) * (CARD_W + GAP);
      const y = top + Math.floor(i / COLS) * (CARD_H + GAP);
      drawCard(ctx, c, masks[index], images[index], x, y);
    }
    drawFooter(ctx, c, state, p + 1, pages.length);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    jpegs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
  }

  const url = URL.createObjectURL(buildPdf(jpegs));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.party_name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'costumes'}-costumes.pdf`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
