import { describe, expect, test } from "bun:test";
import { chooseFile, fileEntries, fileHref, fileLabel, fileStorageKey, switchRefusal } from "./files";

describe("chooseFile", () => {
  const files = ["Inbox.md", "Projects/Work.md", "Zed.md"];

  test("opens the file of the URL when it is listed", () => {
    expect(chooseFile("Projects/Work.md", "Zed.md", files)).toBe("Projects/Work.md");
  });
  test("falls back to the last file when the URL has none", () => {
    expect(chooseFile(null, "Zed.md", files)).toBe("Zed.md");
  });
  test("falls back to the last file when the file of the URL is not listed", () => {
    expect(chooseFile("Gone.md", "Zed.md", files)).toBe("Zed.md");
  });
  test("falls back to the first file when the last one is not listed or unknown", () => {
    expect(chooseFile(null, "Gone.md", files)).toBe("Inbox.md");
    expect(chooseFile(null, null, files)).toBe("Inbox.md");
  });
  test("is null when the Vault has no Kryss file", () => {
    expect(chooseFile("Work.md", "Zed.md", [])).toBeNull();
  });
});

describe("fileLabel", () => {
  test("is the name without its folder or extension", () => {
    expect(fileLabel("Projects/Deep/Work.md")).toBe("Work");
    expect(fileLabel("Inbox.md")).toBe("Inbox");
  });
  test("keeps the inner dots of the name", () => {
    expect(fileLabel("a/v1.2.md")).toBe("v1.2");
  });
});

describe("fileHref", () => {
  test("carries the path in the file parameter, encoded", () => {
    const href = fileHref("Projects/My Work & more.md");
    expect(new URLSearchParams(href).get("file")).toBe("Projects/My Work & more.md");
    expect(href.startsWith("?file=")).toBe(true);
  });
});

describe("fileStorageKey", () => {
  test("is the base key alone in single-file mode", () => {
    expect(fileStorageKey("kryss.filter", null)).toBe("kryss.filter");
  });
  test("differs for each file", () => {
    expect(fileStorageKey("kryss.filter", "a.md")).not.toBe(fileStorageKey("kryss.filter", "b.md"));
    expect(fileStorageKey("kryss.filter", "a.md")).not.toBe("kryss.filter");
  });
});

describe("fileEntries", () => {
  test("puts New file… first, then the files in order", () => {
    expect(fileEntries(["a.md", "b.md"])).toEqual([{ kind: "new" }, { kind: "file", path: "a.md" }, { kind: "file", path: "b.md" }]);
  });
  test("holds only New file… when there is no file", () => {
    expect(fileEntries([])).toEqual([{ kind: "new" }]);
  });
});

describe("switchRefusal", () => {
  test("lets a switch go when everything is saved or about to be", () => {
    expect(switchRefusal("saved")).toBeNull();
    expect(switchRefusal("unsaved")).toBeNull();
    expect(switchRefusal("saving")).toBeNull();
  });
  test("refuses with a message while a save fails or is in conflict", () => {
    for (const status of ["conflict", "invalid", "offline", "error"] as const) {
      expect(switchRefusal(status)).toMatch(/\S/);
    }
  });
});
