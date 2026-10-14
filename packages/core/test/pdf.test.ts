import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAssetDir } from '../src/assets.js';
import {
  detectDirection,
  findPdfFont,
  parseBlocks,
  renderPdf,
  visualRuns,
} from '../src/documents/pdf.js';
import { makeRuntime, toolContext, type TestRuntime } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// The fonts ship with the CLI package; core only knows asset dirs the host registers.
registerAssetDir(path.resolve(here, '../../cli/assets'));

describe('pdf: light markdown → blocks', () => {
  it('parses headings, lists, rules and paragraphs', () => {
    const blocks = parseBlocks(
      '# عنوان\n\nسطر أول\nسطر ثانٍ\n\n- نقطة **مهمة**\n1. أولاً\n---\n> اقتباس\n',
    );
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'عنوان' },
      { kind: 'para', text: 'سطر أول سطر ثانٍ' },
      { kind: 'bullet', text: 'نقطة مهمة' },
      { kind: 'number', n: 1, text: 'أولاً' },
      { kind: 'rule' },
      { kind: 'para', text: 'اقتباس' },
    ]);
  });
});

describe('pdf: bidi-lite runs', () => {
  it('detects direction from the first strong character', () => {
    expect(detectDirection('2026 — مرحبا')).toBe('rtl');
    expect(detectDirection('Hello مرحبا')).toBe('ltr');
    expect(detectDirection('123 ...')).toBeUndefined();
  });

  it('orders Arabic/Latin/number runs visually for an RTL line', () => {
    const runs = visualRuns('مرحباً بك في SINDAR. هذا مستند', 'rtl');
    // Visual left→right: second Arabic chunk, the Latin word, then the first Arabic chunk.
    expect(runs.map((r) => r.type)).toEqual(['R', 'L', 'R']);
    expect(runs[0]!.text).toBe('. هذا مستند');
    expect(runs[1]!.text).toBe('SINDAR');
    expect(runs[2]!.text).toBe('مرحباً بك في ');
  });

  it('keeps numbers left-to-right and mirrors brackets inside RTL runs', () => {
    const runs = visualRuns('في عام 2026 (نعم)', 'rtl');
    const types = runs.map((r) => r.type).join('');
    expect(types).toBe('RNR');
    expect(runs[1]!.text).toBe('2026');
    // "(نعم)" is drawn reversed by the font, so the brackets are swapped to keep their shapes right.
    expect(runs[0]!.text).toBe(' )نعم(');
    // Extended Arabic-Indic digits are pre-reversed (the shaper flips Arabic-script runs).
    const fa = visualRuns('رقم ۱۲۳', 'rtl');
    expect(fa.find((r) => r.type === 'N')!.text).toBe('۳۲۱');
  });

  it('keeps an LTR line in logical order with embedded Arabic as one run', () => {
    const runs = visualRuns('Say مرحبا بك now', 'ltr');
    expect(runs.map((r) => r.type)).toEqual(['L', 'R', 'L']);
    expect(runs[1]!.text).toBe('مرحبا بك');
  });
});

describe('pdf: rendering', () => {
  const fonts = findPdfFont({});

  it('finds the bundled Noto Naskh Arabic font', () => {
    expect(fonts?.source).toBe('bundled');
    expect(fonts?.bold).toMatch(/Bold\.ttf$/);
  });

  it('renders a valid PDF with Arabic content and paginates long documents', async () => {
    const r = await renderPdf({ content: 'مرحبا', title: 'تجربة', fonts: fonts! });
    expect(r.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.pages).toBe(1);
    expect(r.direction).toBe('rtl');
    expect(r.buffer.length).toBeGreaterThan(1000);

    const long = Array.from(
      { length: 60 },
      (_, i) =>
        `فقرة ${i + 1}: نص عربي طويل يتكرر لاختبار الانتقال إلى صفحة جديدة عند امتلاء الصفحة.`,
    ).join('\n\n');
    const r2 = await renderPdf({ content: long, fonts: fonts! });
    expect(r2.pages).toBeGreaterThan(1);
    const en = await renderPdf({ content: 'Hello world', fonts: fonts! });
    expect(en.direction).toBe('ltr');
  });
});

describe('make_pdf tool', () => {
  let rt: TestRuntime;
  beforeAll(async () => {
    rt = await makeRuntime();
  });
  afterAll(async () => {
    await rt.cleanup();
  });

  it('is part of the files toolset and writes the PDF into the workspace', async () => {
    const tool = rt.tools.get('make_pdf');
    expect(tool).toBeDefined();
    const ctx = toolContext(rt);
    const result = await rt.tools.execute(
      tool!,
      { path: 'hello', content: '# مرحبا\n\nهذا ملف تجريبي.' },
      ctx,
    );
    expect(result.isError).toBeFalsy();
    const abs = path.join(rt.paths.workspace, 'hello.pdf');
    expect(result.content).toContain(abs);
    expect(result.content).toMatch(/1 page/);
    expect(fs.readFileSync(abs).subarray(0, 4).toString()).toBe('%PDF');
    const files = (result.meta as { files: Array<{ path: string; mime: string }> }).files;
    expect(files[0]).toMatchObject({ path: abs, mime: 'application/pdf' });
  });

  it('classifies writes outside the workspace like write_file', () => {
    const tool = rt.tools.get('make_pdf')!;
    const ctx = toolContext(rt);
    expect(tool.classify!({ path: '/tmp/x.pdf' }, ctx).outsideWorkspace).toBe(true);
    expect(tool.classify!({ path: 'x.pdf' }, ctx).outsideWorkspace).toBe(false);
  });
});
