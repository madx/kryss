import { open, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { frontmatterOf } from "./markdown";

const FIRST_CHUNK = 4096;
const MAX_FRONTMATTER = 1024 * 1024;
const ENABLED_LINE = /^kryss-enabled:[ \t]*true[ \t]*$/;
const FORBIDDEN_CHARS = /[*"\\/<>:|?#^[\]\u0000-\u001f]/;

/** True when the text of a frontmatter block has the top-level line `kryss-enabled: true`. */
function isEnabled(frontmatter: string): boolean {
  const lines = frontmatter.split("\n").map((l) => l.replace(/\r$/, ""));
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)[ \t]*$/.test(lines[i]!)) return false;
    if (ENABLED_LINE.test(lines[i]!)) return true;
  }
  return false;
}

/** Reads a file only up to the end of its frontmatter and returns that block, or "" when there is none or it is not closed. */
export async function readFrontmatter(path: string): Promise<string> {
  let handle;
  try {
    handle = await open(path, "r");
    let size = FIRST_CHUNK;
    for (;;) {
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, 0);
      let text = buffer.subarray(0, bytesRead).toString("utf8");
      const complete = bytesRead < size;
      // A chunk that stops inside a line must not be taken for a closing delimiter.
      if (!complete) text = text.slice(0, text.lastIndexOf("\n") + 1);
      const frontmatter = frontmatterOf(text);
      if (frontmatter !== "" || complete || size >= MAX_FRONTMATTER) return frontmatter;
      size *= 4;
    }
  } catch {
    return "";
  } finally {
    await handle?.close();
  }
}

/** Tells whether a file opts in. An unclosed frontmatter does not. */
const hasKryssFrontmatter = async (path: string) => isEnabled(await readFrontmatter(path));

/** Sorts paths alphabetically, ignoring case. */
export const byName = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()) || (a < b ? -1 : a > b ? 1 : 0);

/** The relative paths (with `/`, unsorted) of the Markdown files of a Vault, skipping the dot folders. It is the one walk of the Vault. */
export async function listMarkdown(vaultDir: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".")) await walk(join(dir, entry.name), `${prefix}${entry.name}/`);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          found.push(`${prefix}${entry.name}`);
        }
      }),
    );
  }
  await walk(vaultDir, "");
  return found;
}

/** The relative paths (with `/`, sorted ignoring case) of the Kryss files of a Vault. */
export async function scanVault(vaultDir: string): Promise<string[]> {
  const files = await listMarkdown(vaultDir);
  const enabled = await Promise.all(files.map((f) => hasKryssFrontmatter(join(vaultDir, f))));
  return files.filter((_, i) => enabled[i]).sort(byName);
}

/** The real path of a Kryss file given by its path relative to the Vault, or null when it is not inside the Vault or not a Kryss file. */
export async function resolveKryssFile(vaultDir: string, rel: string): Promise<string | null> {
  if (rel === "" || rel.includes("\0") || isAbsolute(rel)) return null;
  try {
    const root = await realpath(vaultDir);
    const real = await realpath(join(root, rel));
    const inside = relative(root, real);
    if (inside === "" || inside === ".." || inside.startsWith(".." + sep) || isAbsolute(inside)) return null;
    const segments = inside.split(sep);
    if (segments.slice(0, -1).some((s) => s.startsWith(".")) || !real.endsWith(".md")) return null;
    if (!(await stat(real)).isFile()) return null;
    return (await hasKryssFrontmatter(real)) ? real : null;
  } catch {
    return null;
  }
}

export type FileName = { ok: true; fileName: string } | { ok: false; error: string };

/** Trims the name, adds `.md` and refuses what Obsidian refuses or what would break its links (PRD 5.16). */
export function validateFileName(name: string): FileName {
  const trimmed = name.trim();
  const fileName = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
  const stem = fileName.slice(0, -3);
  if (stem.trim() === "") return { ok: false, error: "The name is empty" };
  if (fileName.startsWith(".")) return { ok: false, error: "The name cannot start with a dot" };
  const bad = FORBIDDEN_CHARS.exec(stem);
  if (bad) return { ok: false, error: `The name cannot contain ${bad[0] < " " ? "a control character" : `"${bad[0]}"`}` };
  return { ok: true, fileName };
}

export type CreateResult = { ok: true; path: string } | { ok: false; status: 400 | 409; error: string };

/** Creates a Kryss file in `newFileDir`, never overwriting. The path is relative to the Vault. */
export async function createVaultFile(vaultDir: string, newFileDir: string, name: string): Promise<CreateResult> {
  const checked = validateFileName(name);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  const target = join(newFileDir, checked.fileName);
  try {
    await writeFile(target, "---\nkryss-enabled: true\n---\n", { flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return { ok: false, status: 409, error: "A file with this name already exists" };
    if (code === "ENAMETOOLONG") return { ok: false, status: 400, error: "The name is too long" };
    throw error;
  }
  return { ok: true, path: relative(vaultDir, target).split(sep).join("/") };
}
