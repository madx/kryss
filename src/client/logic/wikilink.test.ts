import { describe, expect, test } from "bun:test";
import { filterNotes, insertText, type Note } from "./wikilink";

const n = (path: string, aliases: string[] = [], modified = 0): Note => ({ name: path.split("/").pop()!, path, aliases, modified });

describe("filterNotes", () => {
  const notes = [n("Projects/Alpha", ["First project"]), n("Beta"), n("Archive/Alphabet")];

  test("an empty query lists every note, sorted by name ignoring case", () => {
    expect(filterNotes(notes, "").map((s) => s.note.path)).toEqual(["Projects/Alpha", "Archive/Alphabet", "Beta"]);
  });
  test("filters on the name, ignoring case, prefix matches first", () => {
    expect(filterNotes([n("Zeta alpha"), n("Alpha")], "ALP").map((s) => s.note.name)).toEqual(["Alpha", "Zeta alpha"]);
  });
  test("an alias matches and the suggestion carries it", () => {
    const [s] = filterNotes(notes, "first");
    expect(s).toMatchObject({ note: { path: "Projects/Alpha" }, alias: "First project" });
  });
  test("a note whose name and alias both match gives two suggestions", () => {
    const list = filterNotes([n("Alpha", ["Alpha two"])], "alpha");
    expect(list.map((s) => s.alias)).toEqual([null, "Alpha two"]);
  });
  test("nothing matches", () => {
    expect(filterNotes(notes, "zzz")).toEqual([]);
  });
  test("two notes with one name show their folder, the others do not", () => {
    const list = filterNotes([n("A/Same"), n("B/Same"), n("Other")], "");
    expect(list.map((s) => s.folder)).toEqual(["", "A", "B"]);
  });
  test("a note at the root has an empty folder even when it shares its name", () => {
    expect(filterNotes([n("Same"), n("B/Same")], "").map((s) => s.folder).sort()).toEqual(["", "B"]);
  });
});

describe("filterNotes: order", () => {
  const paths = (notes: Note[], q: string) => filterNotes(notes, q).map((s) => s.note.path);

  test("an empty query lists the most recently modified notes first", () => {
    expect(paths([n("Old", [], 1), n("New", [], 3), n("Mid", [], 2)], "")).toEqual(["New", "Mid", "Old"]);
  });
  test("prefix matches come before the others, even when the others are more recent", () => {
    expect(paths([n("Zeta alpha", [], 9), n("Alpha", [], 1)], "alp")).toEqual(["Alpha", "Zeta alpha"]);
  });
  test("inside a tier the most recent comes first", () => {
    expect(paths([n("Alpha one", [], 1), n("Alpha two", [], 2), n("X alpha", [], 1), n("Y alpha", [], 2)], "alpha")).toEqual([
      "Alpha two",
      "Alpha one",
      "Y alpha",
      "X alpha",
    ]);
  });
  test("an alias entry sorts with the modified of its note", () => {
    const list = filterNotes([n("Other", ["Nick"], 1), n("Nickel", [], 2), n("Third", ["Nicky"], 3)], "nick");
    expect(list.map((s) => s.alias ?? s.note.name)).toEqual(["Nicky", "Nickel", "Nick"]);
  });
  test("equal modified are ordered by the matched text ignoring case, then by path", () => {
    expect(paths([n("B/same"), n("A/Same"), n("a")], "")).toEqual(["a", "A/Same", "B/same"]);
  });
  test("a note whose name and alias both match gives two entries ordered by the same rules", () => {
    const list = filterNotes([n("Alpha", ["Alpha two"], 5), n("Beta", ["Alpha three"], 7)], "alpha");
    expect(list.map((s) => s.alias ?? s.note.name)).toEqual(["Alpha three", "Alpha", "Alpha two"]);
  });
});

describe("insertText: shortest", () => {
  test("a unique name is inserted alone", () => {
    const notes = [n("A/One"), n("B/Two")];
    expect(insertText({ note: notes[0]!, alias: null, folder: "" }, notes, "shortest", "x.md")).toBe("[[One]]");
  });
  test("same-named notes get the shortest path that tells them apart", () => {
    const notes = [n("A/Same"), n("B/Same"), n("A/Deep/Other"), n("Z/Deep/Other"), n("Y/Z/Deep/Other")];
    const at = (i: number) => insertText({ note: notes[i]!, alias: null, folder: "" }, notes, "shortest", "x.md");
    expect(at(0)).toBe("[[A/Same]]");
    expect(at(2)).toBe("[[A/Deep/Other]]");
    expect(at(3)).toBe("[[Z/Deep/Other]]");
    expect(at(4)).toBe("[[Y/Z/Deep/Other]]");
  });
  test("an alias is kept as the label", () => {
    const notes = [n("A/One", ["uno"])];
    expect(insertText({ note: notes[0]!, alias: "uno", folder: "" }, notes, "shortest", "x.md")).toBe("[[One|uno]]");
  });
});

describe("insertText: absolute", () => {
  const notes = [n("A/One"), n("Top")];
  test("the path from the Vault root", () => {
    expect(insertText({ note: notes[0]!, alias: null, folder: "" }, notes, "absolute", "B/x.md")).toBe("[[A/One]]");
    expect(insertText({ note: notes[1]!, alias: null, folder: "" }, notes, "absolute", "B/x.md")).toBe("[[Top]]");
  });
  test("with an alias", () => {
    expect(insertText({ note: n("A/One", ["uno"]), alias: "uno", folder: "" }, notes, "absolute", "x.md")).toBe("[[A/One|uno]]");
  });
});

describe("insertText: relative", () => {
  const notes = [n("A/One"), n("A/Sub/Two"), n("B/Three"), n("Top")];
  const at = (i: number, file: string) => insertText({ note: notes[i]!, alias: null, folder: "" }, notes, "relative", file);
  test("same folder", () => expect(at(0, "A/x.md")).toBe("[[One]]"));
  test("a subfolder", () => expect(at(1, "A/x.md")).toBe("[[Sub/Two]]"));
  test("a sibling folder goes through the parent", () => expect(at(2, "A/x.md")).toBe("[[../B/Three]]"));
  test("from a deeper folder", () => expect(at(3, "A/Sub/x.md")).toBe("[[../../Top]]"));
  test("from the root", () => expect(at(1, "x.md")).toBe("[[A/Sub/Two]]"));
});
