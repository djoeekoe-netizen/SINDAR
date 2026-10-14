import readline from 'node:readline';
import { Writable } from 'node:stream';

export interface Prompter {
  ask(question: string, def?: string): Promise<string>;
  askHidden(question: string): Promise<string>;
  confirm(question: string, def?: boolean): Promise<boolean>;
  close(): void;
}

/**
 * readline-based prompts that work in Termux, Windows terminals and piped stdin.
 * Lines typed ahead of a question are queued instead of being lost.
 */
export function createPrompter(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Prompter {
  const interactive = Boolean((input as NodeJS.ReadStream).isTTY);
  let muted = false;
  const mutable = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) output.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input, output: mutable, terminal: interactive });
  const queue: string[] = [];
  let waiter: ((line: string) => void) | undefined;
  let closed = false;
  rl.on('line', (line) => {
    if (waiter) {
      const w = waiter;
      waiter = undefined;
      w(line);
    } else queue.push(line);
  });
  rl.on('close', () => {
    closed = true;
    if (waiter) {
      const w = waiter;
      waiter = undefined;
      w('');
    }
  });
  const question = (q: string, hidden = false) =>
    new Promise<string>((resolve) => {
      if (hidden) {
        output.write(q);
        rl.setPrompt('');
        muted = true;
      } else rl.setPrompt(q);
      const finish = (line: string) => {
        if (hidden) {
          muted = false;
          output.write('\n');
        }
        resolve(line);
      };
      if (queue.length) {
        if (!hidden) output.write(q);
        finish(queue.shift()!);
        return;
      }
      if (closed) {
        finish('');
        return;
      }
      waiter = finish;
      rl.prompt();
    });
  return {
    async ask(q, def) {
      const a = (await question(q)).trim();
      return a || def || '';
    },
    async askHidden(q) {
      return (await question(q, true)).trim();
    },
    async confirm(q, def = true) {
      const a = (await question(q)).trim().toLowerCase();
      if (!a) return def;
      return ['y', 'yes', 'نعم', 'موافق'].includes(a);
    },
    close: () => rl.close(),
  };
}
