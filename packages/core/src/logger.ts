import fs from 'node:fs';
import path from 'node:path';
import { redactString, redactValue } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  level: LogLevel;
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Path of a JSON-lines log file (rotated at `maxFileBytes`). */
  file?: string;
  maxFileBytes?: number;
  /** Secret values to scrub from every record. */
  secrets?: readonly string[];
  /** Pretty console output to stderr (default: true). */
  console?: boolean;
  bindings?: Record<string, unknown>;
  /** Injectable sink for tests. */
  write?: (line: string) => void;
}

const PRETTY_TAG: Record<LogLevel, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
};

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level: LogLevel = opts.level ?? 'info';
  const secrets = opts.secrets ?? [];
  const maxBytes = opts.maxFileBytes ?? 5 * 1024 * 1024;
  const bindings = opts.bindings ?? {};
  const useConsole = opts.console ?? true;

  const writeFile = (line: string) => {
    if (!opts.file) return;
    try {
      fs.mkdirSync(path.dirname(opts.file), { recursive: true });
      try {
        const st = fs.statSync(opts.file);
        if (st.size > maxBytes) fs.renameSync(opts.file, `${opts.file}.1`);
      } catch {
        /* no file yet */
      }
      fs.appendFileSync(opts.file, line + '\n');
    } catch {
      /* logging must never crash the app */
    }
  };

  const emit = (lvl: LogLevel, msg: string, data?: unknown) => {
    if (LEVELS[lvl] < LEVELS[level]) return;
    const time = new Date().toISOString();
    const safeMsg = redactString(msg, secrets);
    const safeData = data === undefined ? undefined : redactValue(data, secrets);
    const record = {
      time,
      level: lvl,
      msg: safeMsg,
      ...bindings,
      ...(safeData !== undefined ? { data: safeData } : {}),
    };
    const line = JSON.stringify(record);
    if (opts.write) opts.write(line);
    else {
      writeFile(line);
      if (useConsole) {
        const extra = safeData !== undefined ? ' ' + JSON.stringify(safeData) : '';
        process.stderr.write(`${time.slice(11, 19)} ${PRETTY_TAG[lvl]} ${safeMsg}${extra}\n`);
      }
    }
  };

  return {
    level,
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
    child: (b) => createLogger({ ...opts, bindings: { ...bindings, ...b } }),
  };
}

/** A logger that discards everything (tests / quiet CLI paths). */
export const silentLogger: Logger = createLogger({
  level: 'error',
  console: false,
  write: () => {},
});
