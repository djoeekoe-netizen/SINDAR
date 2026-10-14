import { execFile } from 'node:child_process';
import readline from 'node:readline';
import type { Command } from 'commander';
import pc from 'picocolors';
import { commandExists, detectPlatform, isLang, t, type Lang } from '@sindar/core';

/**
 * `sindar background` — a guided fix for the #1 phone problem: Android (Huawei, Xiaomi, Samsung…)
 * freezes Termux in the background and cuts its network, so SINDAR only answers once Termux is
 * brought to the front. Each step opens the exact settings screen through `am start` (Termux's
 * activity manager) and explains what to toggle. Everything is best effort: when a vendor screen
 * does not exist on this phone we fall back to the standard app page, then to a manual path.
 */

type StepId = 'battery' | 'launch' | 'sleep' | 'data' | 'autostart' | 'saver' | 'samsung' | 'lock';

interface Step {
  id: StepId;
  /** `am start` argument lists to try in order (first that opens wins). */
  intents: string[][];
}

const TERMUX = 'com.termux';
const APP_DETAILS = [
  'start',
  '-a',
  'android.settings.APPLICATION_DETAILS_SETTINGS',
  '-d',
  `package:${TERMUX}`,
];

const STEPS: Record<StepId, Step> = {
  battery: {
    id: 'battery',
    intents: [
      [
        'start',
        '-a',
        'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
        '-d',
        `package:${TERMUX}`,
      ],
      ['start', '-a', 'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS'],
      APP_DETAILS,
    ],
  },
  launch: {
    id: 'launch',
    intents: [
      ['start', '-n', 'com.huawei.systemmanager/.startupmgr.ui.StartupNormalAppListActivity'],
      ['start', '-n', 'com.huawei.systemmanager/.appcontrol.activity.StartupAppControlActivity'],
      APP_DETAILS,
    ],
  },
  sleep: {
    id: 'sleep',
    intents: [
      ['start', '-n', 'com.huawei.systemmanager/.power.ui.HwPowerManagerActivity'],
      ['start', '-a', 'android.intent.action.POWER_USAGE_SUMMARY'],
    ],
  },
  data: {
    id: 'data',
    intents: [
      [
        'start',
        '-a',
        'android.settings.IGNORE_BACKGROUND_DATA_RESTRICTIONS_SETTINGS',
        '-d',
        `package:${TERMUX}`,
      ],
      APP_DETAILS,
    ],
  },
  autostart: {
    id: 'autostart',
    intents: [
      [
        'start',
        '-n',
        'com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity',
      ],
      APP_DETAILS,
    ],
  },
  saver: {
    id: 'saver',
    intents: [
      [
        'start',
        '-n',
        'com.miui.powerkeeper/.ui.HiddenAppsConfigActivity',
        '--es',
        'package_name',
        TERMUX,
        '--es',
        'package_label',
        'Termux',
      ],
      APP_DETAILS,
    ],
  },
  samsung: {
    id: 'samsung',
    intents: [
      ['start', '-n', 'com.samsung.android.lool/com.samsung.android.sm.ui.battery.BatteryActivity'],
      ['start', '-n', 'com.samsung.android.lool/com.samsung.android.sm.battery.ui.BatteryActivity'],
      APP_DETAILS,
    ],
  },
  lock: { id: 'lock', intents: [] },
};

type PathStep = Exclude<StepId, 'lock'>;
const pathKey = (id: PathStep) => `bg.step.${id}.path` as const;

/** Which screens matter on which phones (order = what the user should do first). */
export function stepsFor(manufacturer: string): StepId[] {
  const m = manufacturer.toLowerCase();
  if (/huawei|honor/.test(m)) return ['battery', 'launch', 'sleep', 'data', 'lock'];
  if (/xiaomi|redmi|poco/.test(m)) return ['battery', 'autostart', 'saver', 'data', 'lock'];
  if (/samsung/.test(m)) return ['battery', 'samsung', 'data', 'lock'];
  return ['battery', 'data', 'lock'];
}

function getprop(name: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('getprop', [name], { timeout: 3000 }, (err, stdout) =>
      resolve(err ? '' : String(stdout).trim()),
    );
  });
}

export interface DeviceInfo {
  manufacturer: string;
  model: string;
  android: string;
}

export async function detectDevice(): Promise<DeviceInfo> {
  const [manufacturer, model, android] = await Promise.all([
    getprop('ro.product.manufacturer'),
    getprop('ro.product.model'),
    getprop('ro.build.version.release'),
  ]);
  return { manufacturer, model, android };
}

/** Run `am <args>`; resolves true when Android accepted the intent. */
function am(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 8000 }, (err, stdout, stderr) => {
      const out = `${stdout}\n${stderr}`;
      resolve(!err && !/Error|Exception|does not exist|unable to resolve/i.test(out));
    });
  });
}

/**
 * Try the step's screens starting at `from`; resolves the index that Android accepted, or -1.
 * "Accepted" is not "visible": e.g. the battery dialog closes itself instantly when Termux is
 * already exempt, and some vendors swallow launches silently — that is why the prompt offers `r`
 * (try the next screen for the same step).
 */
async function openStep(bin: string | undefined, step: Step, from = 0): Promise<number> {
  if (!bin) return -1;
  for (let i = from; i < step.intents.length; i++) if (await am(bin, step.intents[i]!)) return i;
  return -1;
}

export function registerBackground(program: Command): void {
  program
    .command('background')
    .alias('bg')
    .description('Keep the brain alive in the background on Android (guided settings) / الخلفية')
    .option('--no-open', 'only print the checklist, do not open settings screens')
    .action(async (opts: { open: boolean }) => {
      const globals = program.opts<{ lang?: string }>();
      const lang: Lang = isLang(globals.lang) ? globals.lang : 'ar';
      const T = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
        t(lang, key, vars);
      const out = (s = '') => process.stdout.write(s + '\n');

      const platform = detectPlatform();
      if (!platform.isTermux) {
        out(pc.yellow(T('bg.notTermux')));
        return;
      }
      const device = await detectDevice();
      const brand = device.manufacturer
        ? device.manufacturer[0]!.toUpperCase() + device.manufacturer.slice(1)
        : '';
      out(pc.bold(T('bg.title')));
      if (brand) {
        out(
          pc.dim(
            T('bg.device', { brand, model: device.model || '?', android: device.android || '?' }),
          ),
        );
      }
      out();
      out(brand ? T('bg.intro', { brand }) : T('bg.intro.generic'));
      out();

      const ids = stepsFor(device.manufacturer);
      const huawei = /huawei|honor/i.test(device.manufacturer);
      const amBin = opts.open ? commandExists('am') : undefined;
      const interactive =
        opts.open && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
      const rl = interactive
        ? readline.createInterface({ input: process.stdin, output: process.stdout })
        : undefined;
      const ask = (q: string) =>
        new Promise<string>((resolve) => (rl ? rl.question(q, resolve) : resolve('')));

      try {
        for (const [i, id] of ids.entries()) {
          const step = STEPS[id];
          out(
            pc.cyan(
              pc.bold(
                T('bg.step', { n: i + 1, total: ids.length, title: T(`bg.step.${id}.title`) }),
              ),
            ),
          );
          out(T(`bg.step.${id}.body`));
          if (id === 'lock') {
            out();
            continue;
          }
          const manual =
            id === 'battery' && huawei ? T('bg.step.battery.path.huawei') : T(pathKey(id));
          out(pc.dim(T('bg.path', { path: manual })));
          if (amBin) {
            const answer = interactive
              ? (await ask(pc.green(T('bg.open.prompt')))).trim().toLowerCase()
              : '';
            if (answer !== 's' && answer !== 'skip') {
              const report = (idx: number) => {
                if (idx < 0) {
                  out(pc.yellow(T('bg.open.failed', { path: manual })));
                  return;
                }
                out(pc.green(T('bg.opened')));
                // The system dialog silently finishes when Termux is already exempt.
                if (id === 'battery' && idx === 0) out(pc.dim(T('bg.step.battery.note')));
              };
              let idx = await openStep(amBin, step);
              report(idx);
              if (interactive) {
                // Wait until the user is back. `r` = "nothing showed up" → next screen for this step.
                for (;;) {
                  const back = (await ask(pc.dim(T('bg.back.prompt')))).trim().toLowerCase();
                  if (back !== 'r' && back !== 'retry') break;
                  idx = idx < 0 ? -1 : await openStep(amBin, step, idx + 1);
                  report(idx);
                }
              }
            }
          } else if (opts.open) {
            out(pc.yellow(T('bg.open.failed', { path: manual })));
          }
          out();
        }
      } finally {
        rl?.close();
      }
      out(pc.green(pc.bold(T('bg.done'))));
    });
}
