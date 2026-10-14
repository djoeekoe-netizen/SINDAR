import { describe, expect, it } from 'vitest';
import {
  findGatewayProcesses,
  listProcesses,
  looksLikeGatewayProcess,
  parseCmdline,
  processAlive,
} from '../src/procs.js';

const HOME = '/home/u/.sindar';

describe('process table helpers', () => {
  it('parses NUL-separated cmdlines', () => {
    expect(parseCmdline('node\0/usr/bin/sindar\0gateway\0run\0')).toEqual([
      'node',
      '/usr/bin/sindar',
      'gateway',
      'run',
    ]);
    expect(parseCmdline(Buffer.from(''))).toEqual([]);
  });

  it('recognises brains started by the app, by `app connect` and by hand — for this home only', () => {
    // Android app → Termux RUN_COMMAND: exec node "$(command -v sindar)" gateway run (default home)
    expect(looksLikeGatewayProcess(['node', '/usr/bin/sindar', 'gateway', 'run'], HOME, HOME)).toBe(
      true,
    );
    // ensureGatewayRunning: node dist/index.js --home X gateway run
    expect(
      looksLikeGatewayProcess(
        ['node', '/lib/node_modules/sindar/dist/index.js', '--home', HOME, 'gateway', 'run'],
        HOME,
        '/other/default',
      ),
    ).toBe(true);
    expect(
      looksLikeGatewayProcess(
        ['node22', '/x/dist/index.js', `--home=${HOME}`, 'gateway', 'start', '--foreground'],
        HOME,
      ),
    ).toBe(true);
    expect(looksLikeGatewayProcess(['node', '/usr/bin/sindar', 'gateway', '-f'], HOME, HOME)).toBe(
      true,
    );
    // not ours / not a brain
    expect(looksLikeGatewayProcess(['node', '/usr/bin/sindar', 'chat'], HOME, HOME)).toBe(false);
    expect(
      looksLikeGatewayProcess(['node', '/usr/bin/sindar', 'gateway', 'stop'], HOME, HOME),
    ).toBe(false);
    expect(
      looksLikeGatewayProcess(['node', '/usr/bin/sindar', 'gateway', 'start'], HOME, HOME),
    ).toBe(false); // background `start` is the spawner, not the server
    expect(
      looksLikeGatewayProcess(['node', '/srv/other/app.js', 'gateway', 'run'], HOME, HOME),
    ).toBe(false);
    expect(
      looksLikeGatewayProcess(['python', '/usr/bin/sindar', 'gateway', 'run'], HOME, HOME),
    ).toBe(false);
    expect(
      looksLikeGatewayProcess(
        ['node', '/x/dist/index.js', '--home', '/elsewhere', 'gateway', 'run'],
        HOME,
        HOME,
      ),
    ).toBe(false);
    // a brain without --home serves the DEFAULT home, so it is not ours when we use a custom home
    expect(
      looksLikeGatewayProcess(['node', '/usr/bin/sindar', 'gateway', 'run'], '/custom', HOME),
    ).toBe(false);
  });

  it('lists live processes and never reports itself as a brain', () => {
    const procs = listProcesses();
    if (process.platform !== 'win32') {
      expect(procs.some((p) => p.pid === process.pid)).toBe(true);
    }
    expect(findGatewayProcesses('/nonexistent-home-xyz').length).toBe(0);
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(2 ** 22 - 1)).toBe(false);
  });
});
