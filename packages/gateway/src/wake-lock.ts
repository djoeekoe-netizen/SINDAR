import { execFile } from 'node:child_process';
import type { Logger } from '@sindar/core';

/** Termux: keep the CPU awake while the gateway runs (shows the Termux notification). */
export function acquireWakeLock(logger?: Logger): void {
  execFile('termux-wake-lock', [], { timeout: 5000 }, (err) => {
    if (err) logger?.warn('termux-wake-lock failed', { error: err.message });
    else logger?.info('termux wake lock acquired');
  });
}

export function releaseWakeLock(logger?: Logger): void {
  execFile('termux-wake-unlock', [], { timeout: 5000 }, (err) => {
    if (err) logger?.debug('termux-wake-unlock failed', { error: err.message });
  });
}
