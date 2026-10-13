import pc from 'picocolors';
import type { CheckStatus, DoctorReport } from '@sindar/core';

const ICON: Record<CheckStatus, string> = {
  ok: pc.green('✔'),
  warn: pc.yellow('⚠'),
  fail: pc.red('✖'),
  info: pc.cyan('ℹ'),
};

export function renderDoctor(report: DoctorReport, title: string, versionLine: string): string {
  const lines: string[] = [];
  lines.push(pc.bold(`${title} — ${versionLine}`));
  lines.push('');
  for (const c of report.checks) {
    lines.push(`${ICON[c.status]} ${c.title}`);
    if (c.hint) lines.push(`   ${pc.dim('→')} ${c.hint}`);
    for (const it of c.items ?? []) lines.push(`   ${ICON[it.status]} ${it.text}`);
  }
  lines.push('');
  const color = report.summary.fail ? pc.red : report.summary.warn ? pc.yellow : pc.green;
  lines.push(color(pc.bold(report.verdict)));
  return lines.join('\n');
}

export function banner(version: string): string {
  return [
    pc.bold(pc.cyan('SINDAR')) + pc.dim(` v${version}`),
    pc.dim('مساعد ذكاء اصطناعي شخصي — مجاني، مفتوح المصدر، يعمل على جهازك'),
    pc.dim('Free, self-hosted personal AI agent'),
  ].join('\n');
}
