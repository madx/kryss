import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";

const DEFAULT_TODO_FILE = "./todo.md";

export function resolveTodoFile(env: Record<string, string | undefined>): string {
  return env.TODO_FILE || DEFAULT_TODO_FILE;
}

export async function ensureTodoFile(path: string): Promise<void> {
  if (!existsSync(path)) {
    // "wx" fails if the file appeared in the meantime, so it is never overwritten.
    await writeFile(path, "", { flag: "wx" }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
}
