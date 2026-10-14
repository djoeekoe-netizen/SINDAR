import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { findPdfFont, writePdf } from '../documents/pdf.js';
import { isProtectedPath, outsideWorkspace, resolveToolPath } from './paths.js';
import { defineTool, type Tool, type ToolContext, type ToolRiskDetail } from './types.js';

/** A file produced by a tool, surfaced to UIs as a download (never sent to the model). */
export interface ToolFileRef {
  path: string;
  name: string;
  bytes?: number;
  mime?: string;
}

function classifyWrite(args: { path: string }, ctx: ToolContext): ToolRiskDetail {
  const abs = resolveToolPath(ctx, args.path);
  return {
    risk: 'write',
    outsideWorkspace: outsideWorkspace(ctx, abs),
    forbidden: isProtectedPath(ctx, abs),
  };
}

/** On Android (Termux) mirror the document into the phone's Downloads folder so it shows up in Files. */
export function mirrorToDownloads(ctx: ToolContext, abs: string): string | undefined {
  if (!ctx.platform.isTermux) return undefined;
  const downloads = path.join(ctx.platform.home, 'storage', 'downloads');
  try {
    if (!fs.statSync(downloads).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const ext = path.extname(abs);
  const stem = path.basename(abs, ext);
  let target = path.join(downloads, `${stem}${ext}`);
  for (let i = 2; fs.existsSync(target) && i < 100; i++) {
    try {
      // Same content already there (re-run) → reuse it.
      if (fs.readFileSync(target).equals(fs.readFileSync(abs))) return target;
    } catch {
      /* fall through */
    }
    target = path.join(downloads, `${stem}-${i}${ext}`);
  }
  try {
    fs.copyFileSync(abs, target);
    return target;
  } catch {
    return undefined;
  }
}

export const makePdf = defineTool({
  name: 'make_pdf',
  toolset: 'files',
  risk: 'write',
  description:
    'Create a real PDF document from text (Arabic/RTL fully supported, nothing to install). Use this whenever the user wants a PDF — never try pandoc, LaTeX, Python or pip. content accepts light markdown: # / ## / ### headings, - bullets, 1. numbered items, --- rule, blank line = new paragraph. The file is saved (relative paths go to the workspace) and, on Android, copied to Downloads.',
  parameters: z.object({
    path: z.string().describe('Output file name or path, e.g. "report.pdf"'),
    content: z.string().min(1).describe('Document body (plain text or light markdown)'),
    title: z.string().optional().describe('Optional title printed at the top'),
    direction: z
      .enum(['auto', 'rtl', 'ltr'])
      .optional()
      .describe('Text direction (default auto: Arabic → rtl)'),
    font_size: z
      .number()
      .min(8)
      .max(24)
      .optional()
      .describe('Body font size in points (default 13)'),
  }),
  summarize: (a) =>
    `make PDF ${a.path}${a.title ? ` — ${a.title}` : ''} (${a.content.length} chars)`,
  classify: classifyWrite,
  async execute(args, ctx) {
    let abs = resolveToolPath(ctx, args.path);
    if (!/\.pdf$/i.test(abs)) abs += '.pdf';
    const fonts = findPdfFont({ env: ctx.env, home: ctx.home });
    if (!fonts) {
      return {
        content:
          'No Unicode font found for PDF output. Put any .ttf font (e.g. Noto Naskh Arabic) in ~/.sindar/fonts/ or set SINDAR_PDF_FONT.',
        isError: true,
      };
    }
    const r = await writePdf(abs, {
      content: args.content,
      title: args.title,
      direction: args.direction ?? 'auto',
      fontSize: args.font_size,
      fonts,
    });
    const files: ToolFileRef[] = [
      { path: abs, name: path.basename(abs), bytes: r.bytes, mime: 'application/pdf' },
    ];
    const mirrored = mirrorToDownloads(ctx, abs);
    if (mirrored && mirrored !== abs) {
      files.push({
        path: mirrored,
        name: path.basename(mirrored),
        bytes: r.bytes,
        mime: 'application/pdf',
      });
    }
    const kb = Math.max(1, Math.round(r.bytes / 1024));
    const lines = [
      `created ${abs} (${r.pages} page${r.pages === 1 ? '' : 's'}, ${kb} KB, ${r.direction}, font: ${path.basename(fonts.regular)})`,
    ];
    if (mirrored) lines.push(`also copied to the phone's Downloads folder: ${mirrored}`);
    lines.push('Tell the user where the file is; the web UI also shows a download button for it.');
    return { content: lines.join('\n'), meta: { path: abs, files } };
  },
});

export const DOCUMENT_TOOLS: Tool[] = [makePdf as Tool];
