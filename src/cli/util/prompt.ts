import { createInterface } from "node:readline";

/** Ask a yes/no question. Returns false on EOF/non-interactive input. */
export function confirm(question: string, defaultYes = false): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  return new Promise((resolve) => {
    rl.question(question + suffix, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === "") return resolve(defaultYes);
      resolve(a === "y" || a === "yes");
    });
  });
}
