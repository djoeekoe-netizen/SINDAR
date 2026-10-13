// Hide Node's "SQLite is an experimental feature" notice — it is expected and harmless.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /sqlite/i.test(w.message)) return;
  process.stderr.write(`${w.name}: ${w.message}\n`);
});

import { Command } from 'commander';
import { VERSION, BUILD, t, isLang } from '@sindar/core';
import { registerChat } from './commands/chat.js';
import { registerConfig } from './commands/config.js';
import { registerDoctor } from './commands/doctor.js';
import { registerModel } from './commands/model.js';
import { registerOnboard } from './commands/onboard.js';
import { registerSessions } from './commands/sessions.js';
import { registerUpdate } from './commands/update.js';
import { banner } from './render.js';

const program = new Command();

program
  .name('sindar')
  .description('SINDAR — free, self-hosted personal AI agent')
  .version(`${VERSION} (${BUILD})`, '-v, --version')
  .option('--lang <ar|en>', 'interface language / لغة الواجهة')
  .option('--home <dir>', 'SINDAR home directory (default: ~/.sindar or $SINDAR_HOME)')
  .showHelpAfterError()
  .action(() => {
    const g = program.opts<{ lang?: string }>();
    const lang = isLang(g.lang) ? g.lang : process.env.SINDAR_LANG === 'en' ? 'en' : 'ar';
    process.stdout.write(banner(VERSION) + '\n\n' + t(lang, 'cli.hint') + '\n');
  });

registerChat(program);
registerOnboard(program);
registerModel(program);
registerSessions(program);
registerConfig(program);
registerDoctor(program);
registerUpdate(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`sindar: ${msg}\n`);
  process.exitCode = 1;
});
