import { writeFile } from "node:fs/promises";

const DEFAULT_TODO_FILE = "./todo.md";
const DEFAULT_HOST = "127.0.0.1";

export function resolveTodoFile(env: Record<string, string | undefined>): string {
  return env.TODO_FILE || DEFAULT_TODO_FILE;
}

export function resolveHost(env: Record<string, string | undefined>): string {
  return env.HOST || DEFAULT_HOST;
}

export async function ensureTodoFile(path: string): Promise<void> {
  // The "wx" flag fails if the file exists, so an existing file is never overwritten.
  await writeFile(path, "", { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}
