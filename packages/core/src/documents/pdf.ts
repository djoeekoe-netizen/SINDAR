import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { assetDirs } from '../assets.js';

/**
 * Real PDF documents from plain text / light markdown — with proper Arabic.
 *
 * Why hand-rolled layout: pdfkit (via fontkit) shapes Arabic letters correctly and reverses
 * right-to-left runs, but it knows nothing about the bidi algorithm, so a line that mixes
 * Arabic with Latin words or numbers comes out scrambled. We therefore split every line into
 * directional runs ourselves (a small subset of UAX#9: strong R/L, numbers, neutrals,
 * bracket mirroring), order them visually and place each run with an explicit x position.
 * No external programs, no Python, no LaTeX — it runs on a phone inside Termux.
 */

export interface PdfFonts {
  regular: string;
  bold?: string;
  source: 'env' | 'user' | 'bundled' | 'system';
}

export type Direction = 'auto' | 'rtl' | 'ltr';

export interface RenderPdfOptions {
  content: string;
  title?: string;
  direction?: Direction;
  /** Body font size in points (default 13). */
  fontSize?: number;
  fonts: PdfFonts;
  /** Shown in the PDF metadata. */
  author?: string;
}

export interface RenderPdfResult {
  buffer: Buffer;
  pages: number;
  direction: 'rtl' | 'ltr';
}

// ---------------------------------------------------------------------------------------------
// Fonts

const SYSTEM_FONTS: Array<{ regular: string; bold?: string }> = [
  // Android (most vendors ship Noto Naskh Arabic)
  {
    regular: '/system/fonts/NotoNaskhArabic-Regular.ttf',
    bold: '/system/fonts/NotoNaskhArabic-Bold.ttf',
  },
  {
    regular: '/system/fonts/NotoNaskhArabicUI-Regular.ttf',
    bold: '/system/fonts/NotoNaskhArabicUI-Bold.ttf',
  },
  {
    regular: '/system/fonts/NotoSansArabic-Regular.ttf',
    bold: '/system/fonts/NotoSansArabic-Bold.ttf',
  },
  { regular: '/system/fonts/DroidNaskh-Regular.ttf', bold: '/system/fonts/DroidNaskh-Bold.ttf' },
  // Linux
  {
    regular: '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf',
    bold: '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf',
  },
  {
    regular: '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
    bold: '/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf',
  },
  {
    regular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  },
  {
    regular: '/usr/share/fonts/TTF/DejaVuSans.ttf',
    bold: '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  },
  // macOS
  { regular: '/System/Library/Fonts/Supplemental/Arial Unicode.ttf' },
  {
    regular: '/System/Library/Fonts/Supplemental/Arial.ttf',
    bold: '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  },
  // Windows
  { regular: 'C:\\Windows\\Fonts\\arial.ttf', bold: 'C:\\Windows\\Fonts\\arialbd.ttf' },
  { regular: 'C:\\Windows\\Fonts\\tahoma.ttf', bold: 'C:\\Windows\\Fonts\\tahomabd.ttf' },
];

const isFile = (p: string | undefined): p is string => {
  if (!p) return false;
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * Locate a Unicode font that can draw Arabic. Order: `SINDAR_PDF_FONT` → `~/.sindar/fonts/`
 * (user override) → the Noto Naskh Arabic shipped with SINDAR → well-known system fonts.
 */
export function findPdfFont(opts: {
  env?: Record<string, string | undefined>;
  home?: string;
  extraDirs?: readonly string[];
}): PdfFonts | undefined {
  const envFont = opts.env?.SINDAR_PDF_FONT;
  if (isFile(envFont)) {
    const bold = envFont.replace(/(-|_)?Regular(?=\.[^.]+$)/i, '$1Bold');
    return {
      regular: envFont,
      bold: bold !== envFont && isFile(bold) ? bold : undefined,
      source: 'env',
    };
  }
  if (opts.home) {
    const dir = path.join(opts.home, 'fonts');
    try {
      const files = fs
        .readdirSync(dir)
        .filter((f) => /\.(ttf|otf)$/i.test(f))
        .toSorted();
      const bold = files.find((f) => /bold/i.test(f));
      const regular = files.find((f) => !/bold|italic/i.test(f)) ?? files[0];
      if (regular) {
        return {
          regular: path.join(dir, regular),
          bold: bold ? path.join(dir, bold) : undefined,
          source: 'user',
        };
      }
    } catch {
      /* no user fonts */
    }
  }
  for (const dir of [...(opts.extraDirs ?? []), ...assetDirs()]) {
    const regular = path.join(dir, 'fonts', 'NotoNaskhArabic-Regular.ttf');
    if (isFile(regular)) {
      const bold = path.join(dir, 'fonts', 'NotoNaskhArabic-Bold.ttf');
      return { regular, bold: isFile(bold) ? bold : undefined, source: 'bundled' };
    }
  }
  for (const c of SYSTEM_FONTS) {
    if (isFile(c.regular))
      return { regular: c.regular, bold: isFile(c.bold) ? c.bold : undefined, source: 'system' };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Light markdown → blocks

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'number'; n: number; text: string }
  | { kind: 'rule' };

function inline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'para', text: inline(para.join(' ')) });
    para = [];
  };
  for (const raw of content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    let m: RegExpMatchArray | null;
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
    } else if ((m = /^\s*(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line))) {
      flush();
      blocks.push({ kind: 'heading', level: m[1]!.length as 1 | 2 | 3, text: inline(m[2]!) });
    } else if ((m = /^\s*[-*•]\s+(.+)$/.exec(line))) {
      flush();
      blocks.push({ kind: 'bullet', text: inline(m[1]!) });
    } else if ((m = /^\s*(\d{1,3})[.)]\s+(.+)$/.exec(line))) {
      flush();
      blocks.push({ kind: 'number', n: Number(m[1]), text: inline(m[2]!) });
    } else {
      para.push(line.replace(/^\s*>\s?/, ''));
    }
  }
  flush();
  return blocks;
}

// ---------------------------------------------------------------------------------------------
// Bidi-lite: split a line into visually ordered runs

type CharClass = 'R' | 'L' | 'N' | 'X';
interface Run {
  type: 'R' | 'L' | 'N';
  text: string;
  level: number;
}

const RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
const DIGIT_RE = /[0-9\u0660-\u0669\u06F0-\u06F9]/u;
const LETTER_RE = /\p{L}|\p{M}/u;
const NUM_SEP = new Set(['.', ',', ':', '/', '-', '%', '٫', '٬']);
const MIRROR: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«',
  '‹': '›',
  '›': '‹',
};

export function hasRtl(text: string): boolean {
  return RTL_RE.test(text.replace(DIGIT_RE, ''));
}

/** Direction of a paragraph = its first strong character (numbers and punctuation are skipped). */
export function detectDirection(text: string): 'rtl' | 'ltr' | undefined {
  for (const ch of text) {
    if (DIGIT_RE.test(ch)) continue;
    if (RTL_RE.test(ch)) return 'rtl';
    if (LETTER_RE.test(ch)) return 'ltr';
  }
  return undefined;
}

function classify(ch: string): CharClass {
  if (DIGIT_RE.test(ch)) return 'N';
  if (RTL_RE.test(ch)) return 'R';
  if (LETTER_RE.test(ch)) return 'L';
  return 'X';
}

/** Split one line of text into runs in visual (left-to-right) order. */
export function visualRuns(text: string, dir: 'rtl' | 'ltr'): Run[] {
  const chars = Array.from(text);
  const cls = chars.map(classify);
  const para: 'R' | 'L' = dir === 'rtl' ? 'R' : 'L';

  // Separators inside numbers (12.5, 10:30, 2026-10-14, 50%) stay with the number.
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] === 'X' && NUM_SEP.has(chars[i]!)) {
      const prev = i > 0 ? cls[i - 1] : 'X';
      const next = i + 1 < cls.length ? cls[i + 1] : 'X';
      if ((prev === 'N' && next === 'N') || (chars[i] === '%' && prev === 'N')) cls[i] = 'N';
    }
  }
  // Neutrals take the type of their surroundings when both sides agree, else the paragraph's.
  // (Numbers count as R for this purpose — UAX#9 rule N1.)
  const strongOf = (c: CharClass | undefined): 'R' | 'L' =>
    c === 'L' ? 'L' : c === undefined ? para : 'R';
  let i = 0;
  while (i < cls.length) {
    if (cls[i] !== 'X') {
      i++;
      continue;
    }
    let j = i;
    while (j < cls.length && cls[j] === 'X') j++;
    const before = i > 0 ? strongOf(cls[i - 1]) : para;
    const after = j < cls.length ? strongOf(cls[j]) : para;
    const t: 'R' | 'L' = before === after ? before : para;
    for (let k = i; k < j; k++) cls[k] = t;
    i = j;
  }
  // Group into runs with embedding levels (R=1 in any paragraph, L=0 in LTR / 2 in RTL, numbers follow L).
  const levelOf = (t: 'R' | 'L' | 'N'): number => {
    if (t === 'R') return 1;
    return dir === 'rtl' ? 2 : 0;
  };
  const runs: Run[] = [];
  for (let k = 0; k < chars.length; k++) {
    const t = cls[k] as 'R' | 'L' | 'N';
    const last = runs[runs.length - 1];
    if (last && last.type === t) last.text += chars[k];
    else runs.push({ type: t, text: chars[k]!, level: levelOf(t) });
  }
  // UAX#9 L2: from the highest level down, reverse every maximal sequence at or above that level.
  const max = Math.max(0, ...runs.map((r) => r.level));
  for (let lvl = max; lvl >= 1; lvl--) {
    let s = 0;
    while (s < runs.length) {
      if (runs[s]!.level < lvl) {
        s++;
        continue;
      }
      let e = s;
      while (e < runs.length && runs[e]!.level >= lvl) e++;
      const seq = runs.slice(s, e).toReversed();
      runs.splice(s, e - s, ...seq);
      s = e;
    }
  }
  // Mirror brackets inside right-to-left runs (L4) — the font reverses glyph order but not shapes.
  for (const r of runs) {
    if (r.type === 'R') r.text = Array.from(r.text, (c) => MIRROR[c] ?? c).join('');
    else if (r.type === 'N' && /[\u06F0-\u06F9]/u.test(r.text)) {
      // Extended Arabic-Indic digits carry the Arabic script, so the shaper reverses them; undo.
      r.text = Array.from(r.text).toReversed().join('');
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------------------------
// Rendering

const PAGE = { width: 595.28, height: 841.89 }; // A4
const MARGIN = 56;

interface Style {
  font: 'body' | 'bold';
  size: number;
  before: number;
  after: number;
}

export function renderPdf(opts: RenderPdfOptions): Promise<RenderPdfResult> {
  const base = Math.min(24, Math.max(8, opts.fontSize ?? 13));
  const blocks = parseBlocks(opts.content);
  const all = [opts.title ?? '', ...blocks.map((b) => ('text' in b ? b.text : ''))].join('\n');
  const docDir: 'rtl' | 'ltr' =
    opts.direction && opts.direction !== 'auto'
      ? opts.direction
      : (detectDirection(all) ?? (hasRtl(all) ? 'rtl' : 'ltr'));

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: opts.title ?? '',
      Author: opts.author ?? 'SINDAR',
      Creator: 'SINDAR',
      Producer: 'SINDAR (pdfkit)',
    },
    pdfVersion: '1.5',
    lang: docDir === 'rtl' ? 'ar' : 'en',
  });
  doc.registerFont('body', opts.fonts.regular);
  doc.registerFont('bold', opts.fonts.bold ?? opts.fonts.regular);

  const left = MARGIN;
  const right = PAGE.width - MARGIN;
  const contentWidth = right - left;
  const maxY = PAGE.height - MARGIN;
  let y = MARGIN;

  const use = (s: Style) => doc.font(s.font).fontSize(s.size);
  // `features: []` forces pdfkit to shape the whole string as ONE run (otherwise it lays out word by
  // word in logical order, which scrambles right-to-left word order). Default OpenType features stay on.
  const TEXT: PDFKit.Mixins.TextOptions = { lineBreak: false, features: [] };
  const width = (text: string) => doc.widthOfString(text, TEXT);
  const lineHeight = () => doc.currentLineHeight(true) * 1.12;

  const ensure = (h: number) => {
    if (y + h > maxY) {
      doc.addPage();
      y = MARGIN;
    }
  };

  /** Width of a line as it will be drawn: per-run shaping (a mixed-script string measured whole is wider). */
  const lineWidth = (text: string, dir: 'rtl' | 'ltr') =>
    visualRuns(text, dir).reduce((sum, r) => sum + width(r.text), 0);

  const wrap = (text: string, avail: number, dir: 'rtl' | 'ltr'): string[] => {
    const words = text.split(' ').filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    // A single word wider than the line: break it by characters.
    const fit = () => {
      while (lineWidth(cur, dir) > avail && Array.from(cur).length > 1) {
        const chars = Array.from(cur);
        let n = chars.length - 1;
        while (n > 1 && lineWidth(chars.slice(0, n).join(''), dir) > avail) n--;
        lines.push(chars.slice(0, n).join(''));
        cur = chars.slice(n).join('');
      }
    };
    for (const w of words) {
      const candidate = cur ? `${cur} ${w}` : w;
      if (!cur || lineWidth(candidate, dir) <= avail) cur = candidate;
      else {
        lines.push(cur);
        cur = w;
      }
      fit();
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  };

  /** Draw one logical line of text inside [x0, x1] honouring direction + alignment. */
  const drawLine = (
    text: string,
    dir: 'rtl' | 'ltr',
    x0: number,
    x1: number,
    align: 'start' | 'center',
  ) => {
    const runs = visualRuns(text, dir);
    const widths = runs.map((r) => width(r.text));
    const total = widths.reduce((a, b) => a + b, 0);
    let x: number;
    if (align === 'center') x = x0 + (x1 - x0 - total) / 2;
    else x = dir === 'rtl' ? x1 - total : x0;
    runs.forEach((r, idx) => {
      doc.text(r.text, x, y, TEXT);
      x += widths[idx]!;
    });
  };

  const paragraph = (
    text: string,
    style: Style,
    o: { indent?: number; marker?: string; align?: 'start' | 'center'; dir?: 'rtl' | 'ltr' } = {},
  ) => {
    use(style);
    const dir = o.dir ?? detectDirection(text) ?? docDir;
    const indent = o.indent ?? 0;
    const lh = lineHeight();
    const lines = wrap(text, contentWidth - indent, dir);
    y += style.before;
    ensure(lh);
    lines.forEach((line, idx) => {
      ensure(lh);
      if (idx === 0 && o.marker) {
        const mw = width(o.marker);
        doc.text(o.marker, dir === 'rtl' ? right - mw : left, y, TEXT);
      }
      const x0 = dir === 'rtl' ? left : left + indent;
      const x1 = dir === 'rtl' ? right - indent : right;
      drawLine(line, dir, x0, x1, o.align ?? 'start');
      y += lh;
    });
    y += style.after;
  };

  const body: Style = { font: 'body', size: base, before: 0, after: base * 0.55 };
  const h: Record<1 | 2 | 3, Style> = {
    1: { font: 'bold', size: base * 1.7, before: base * 0.9, after: base * 0.5 },
    2: { font: 'bold', size: base * 1.4, before: base * 0.8, after: base * 0.4 },
    3: { font: 'bold', size: base * 1.15, before: base * 0.6, after: base * 0.3 },
  };

  if (opts.title) {
    paragraph(
      opts.title,
      { font: 'bold', size: base * 2, before: 0, after: base * 0.4 },
      { align: 'center' },
    );
    doc
      .moveTo(left, y)
      .lineTo(right, y)
      .lineWidth(0.8)
      .strokeColor('#888')
      .stroke()
      .strokeColor('#000');
    y += base * 1.1;
  }

  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        paragraph(b.text, h[b.level]);
        break;
      case 'para':
        paragraph(b.text, body);
        break;
      case 'bullet':
        paragraph(b.text, { ...body, after: base * 0.25 }, { indent: base * 1.5, marker: '•' });
        break;
      case 'number':
        paragraph(
          b.text,
          { ...body, after: base * 0.25 },
          { indent: base * 1.9, marker: `${b.n}.` },
        );
        break;
      case 'rule':
        ensure(base);
        y += base * 0.3;
        doc
          .moveTo(left, y)
          .lineTo(right, y)
          .lineWidth(0.6)
          .strokeColor('#999')
          .stroke()
          .strokeColor('#000');
        y += base * 0.9;
        break;
    }
  }

  // Footer: page numbers.
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    use({ font: 'body', size: Math.max(8, base * 0.7), before: 0, after: 0 });
    const label = `${p + 1} / ${range.count}`;
    const w = width(label);
    doc
      .fillColor('#777')
      .text(label, left + (contentWidth - w) / 2, PAGE.height - MARGIN + 14, TEXT);
    doc.fillColor('#000');
  }

  return new Promise<RenderPdfResult>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () =>
      resolve({ buffer: Buffer.concat(chunks), pages: range.count, direction: docDir }),
    );
    doc.on('error', reject);
    doc.end();
  });
}

export async function writePdf(
  file: string,
  opts: RenderPdfOptions,
): Promise<RenderPdfResult & { bytes: number }> {
  const r = await renderPdf(opts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, r.buffer);
  return { ...r, bytes: r.buffer.length };
}
