import readline from 'node:readline';
import { Writable } from 'node:stream';

export interface Prompter {
  ask(question: string, def?: string): Promise<string>;
  askHidden(question: string): Promise<string>;
  confirm(question: string, def?: boolean): Promise<boolean>;
  close(): void;
}

/** readline-based prompts that work in Termux, Windows terminals and piped stdin. */
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
  const question = (q: string) =>
    new Promise<string>((resolve) => {
      rl.question(q, (a) => resolve(a));
    });
  return {
    async ask(q, def) {
      const a = (await question(q)).trim();
      return a || def || '';
    },
    async askHidden(q) {
      output.write(q);
      muted = true;
      try {
        const a = await question('');
        return a.trim();
      } finally {
        muted = false;
        output.write('\n');
      }
    },
    async confirm(q, def = true) {
      const a = (await question(q)).trim().toLowerCase();
      if (!a) return def;
      return ['y', 'yes', 'نعم', 'موافق'].includes(a);
    },
    close: () => rl.close(),
  };
}
