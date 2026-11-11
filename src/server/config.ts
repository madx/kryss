import { realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

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

export type VaultConfig = { vaultDir: string; newFileDir: string };

/**
 * The Vault mode settings, or undefined in single-file mode (`VAULT_DIR` unset or empty).
 * Both folders are resolved to their real path, and a `NEW_FILE_DIR` outside the Vault is refused.
 */
export async function resolveVault(env: Record<string, string | undefined>): Promise<VaultConfig | undefined> {
  if (!env.VAULT_DIR) return undefined;
  const vaultDir = await realpath(resolve(env.VAULT_DIR)).catch(() => {
    throw new Error(`VAULT_DIR "${env.VAULT_DIR}" is not an existing folder`);
  });
  if (!env.NEW_FILE_DIR) return { vaultDir, newFileDir: vaultDir };
  const newFileDir = await realpath(resolve(env.NEW_FILE_DIR)).catch(() => {
    throw new Error(`NEW_FILE_DIR "${env.NEW_FILE_DIR}" is not an existing folder`);
  });
  const inside = relative(vaultDir, newFileDir);
  if (inside.startsWith("..") || isAbsolute(inside)) throw new Error(`NEW_FILE_DIR "${env.NEW_FILE_DIR}" must be inside VAULT_DIR`);
  return { vaultDir, newFileDir };
}
