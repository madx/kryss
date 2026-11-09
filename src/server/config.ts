import { writeFile } from "node:fs/promises";

const DEFAULT_TODO_FILE = "./todo.md";

export function resolveTodoFile(env: Record<string, string | undefined>): string {
  return env.TODO_FILE || DEFAULT_TODO_FILE;
}

export async function ensureTodoFile(path: string): Promise<void> {
  // The "wx" flag fails if the file exists, so an existing file is never overwritten.
  await writeFile(path, "", { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}
