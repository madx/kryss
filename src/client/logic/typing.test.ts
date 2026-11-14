import { describe, expect, test } from "bun:test";
import { composedEdit, emptyPairRemoval, linkEdit, toggleMarker, typedEdit, type Edit, type Pair } from "./typing";

// Test notation: `|` is the cursor, `‹` and `›` delimit a selection.
function parse(s: string): { text: string; from: number; to: number } {
  const a = s.indexOf("‹");
  if (a >= 0) {
    const b = s.indexOf("›");
    return { text: s.slice(0, a) + s.slice(a + 1, b) + s.slice(b + 1), from: a, to: b - 1 };
  }
  const c = s.indexOf("|");
  return { text: s.replace("|", ""), from: c, to: c };
}
function show(text: string, e: Edit): string {
  const out = text.slice(0, e.from) + e.insert + text.slice(e.to);
  return e.anchor === e.head ? out.slice(0, e.anchor) + "|" + out.slice(e.anchor) : out.slice(0, e.anchor) + "‹" + out.slice(e.anchor, e.head) + "›" + out.slice(e.head);
}
/** Types `ch` at the marked position and returns the marked result, or null when the keystroke stays native. */
function type(s: string, ch: string, pairs: Pair[] = []): string | null {
  const { text, from, to } = parse(s);
  const e = typedEdit(text, from, to, ch, pairs);
  return e === null ? null : show(text, e);
}
function typeEdit(s: string, ch: string, pairs: Pair[] = []): Edit {
  const { text, from, to } = parse(s);
  return typedEdit(text, from, to, ch, pairs)!;
}

describe("pairs", () => {
  test.each([
    ["*", "*|*"],
    ["_", "_|_"],
    ["`", "`|`"],
    ["[", "[|]"],
    ["(", "(|)"],
    ['"', '"|"'],
  ])("%s pairs at the end of the text, after a space and before a space", (ch, out) => {
    expect(type("|", ch)).toBe(out);
    expect(type("a |", ch)).toBe("a " + out);
    expect(type("a | b", ch)).toBe("a " + out + " b");
  });
  test("a character pairs before a closing character", () => {
    for (const next of [")", "]", "}", '"', "'", "`", ".", ",", ";", ":", "!", "?", "*", "_", "~", "="]) {
      expect(type(`a |${next}`, "(")).toBe(`a (|)${next}`);
    }
  });
  test("a character pairs inside another pair, after a marker or a bracket", () => {
    expect(type("**|**", "_")).toBe("**_|_**");
    expect(type("[label]|", "(")).toBe("[label](|)");
    expect(type("(|)", '"')).toBe('("|")');
  });
  test("snake_case, 2*3, don\"t and f(x) stay literal", () => {
    expect(type("snake|case", "_")).toBeNull();
    expect(type("snake|", "_")).toBeNull();
    expect(type("2|3", "*")).toBeNull();
    expect(type("2|", "*")).toBeNull();
    expect(type("don|t", '"')).toBeNull();
    expect(type("f|x", "(")).toBeNull();
    expect(type("f|", "(")).toBeNull();
  });
  test("a character stays literal before a letter", () => {
    expect(type("|word", "*")).toBeNull();
    expect(type("é|", "_")).toBeNull();
  });
  test("a pair is tracked at the position of its closer", () => {
    expect(typeEdit("a |", "(").track).toEqual({ at: 3, closer: ")", open: 1 });
    expect(typeEdit("|", "[").track).toEqual({ at: 1, closer: "]", open: 1 });
  });
  test("other characters stay native", () => {
    expect(type("|", "a")).toBeNull();
    expect(type("|", "{")).toBeNull();
    expect(type("|", "'")).toBeNull();
    expect(type("|", "<")).toBeNull();
    expect(type("|", "$")).toBeNull();
  });
});

describe("~ and =", () => {
  test("a first ~ or = stays literal", () => {
    expect(type("|", "~")).toBeNull();
    expect(type("a |", "=")).toBeNull();
  });
  test("the second one pairs: ~~|~~ and ==|==", () => {
    expect(type("~|", "~")).toBe("~~|~~");
    expect(type("a ~| b", "~")).toBe("a ~~|~~ b");
    expect(type("=|", "=")).toBe("==|==");
    expect(typeEdit("=|", "=").track).toEqual({ at: 2, closer: "==", open: 2 });
  });
  test("a == inside a word or a comparison stays literal", () => {
    expect(type("a=|", "=")).toBeNull();
    expect(type("a=|b", "=")).toBeNull();
    expect(type("1~|", "~")).toBeNull();
  });
  test("a second one before a letter stays literal", () => {
    expect(type("~|x", "~")).toBeNull();
  });
  test("a third one does not pair again", () => {
    expect(type("~~|", "~")).toBeNull();
    expect(type("==|", "=")).toBeNull();
  });
});

describe("growth", () => {
  test("*|* grows to **|** and [|] to [[|]]", () => {
    const star: Pair = { at: 1, closer: "*", open: 1 };
    expect(type("*|*", "*", [star])).toBe("**|**");
    expect(typeEdit("*|*", "*", [star]).track).toEqual({ at: 2, closer: "**", open: 2 });
    expect(typeEdit("*|*", "*", [star]).drop).toBe(1);
    expect(type("[|]", "[", [{ at: 1, closer: "]", open: 1 }])).toBe("[[|]]");
  });
  test("no growth when text was typed inside the pair", () => {
    expect(type("*a|*", "*", [{ at: 2, closer: "*", open: 1 }])).toBe("*a*|");
  });
  test("no growth when the pair is not tracked: the plain rule applies", () => {
    expect(type("(|)", "(")).toBe("((|))");
  });
});

describe("stepping over a closer", () => {
  test("a typed closer moves past its tracked pair", () => {
    expect(type("(a|)", ")", [{ at: 2, closer: ")", open: 1 }])).toBe("(a)|");
    expect(type('"a|"', '"', [{ at: 2, closer: '"', open: 1 }])).toBe('"a"|');
    expect(type("[a|]", "]", [{ at: 2, closer: "]", open: 1 }])).toBe("[a]|");
  });
  test("a step drops the pair", () => {
    const e = typeEdit("(a|)", ")", [{ at: 2, closer: ")", open: 1 }]);
    expect(e.drop).toBe(2);
    expect(e.track).toBeUndefined();
  });
  test("a two-character closer is stepped over one character at a time", () => {
    const pair: Pair = { at: 6, closer: "**", open: 2 };
    expect(type("**bold|**", "*", [pair])).toBe("**bold*|*");
    const e = typeEdit("**bold|**", "*", [pair]);
    expect(e.track).toEqual({ at: 7, closer: "*", open: 2 });
    expect(type("**bold*|*", "*", [e.track!])).toBe("**bold**|");
  });
  test("an untracked closer is not stepped over", () => {
    expect(type("(a|)", ")")).toBeNull();
    expect(type("(a|)", ")", [{ at: 9, closer: ")", open: 1 }])).toBeNull();
  });
  test("a tracked pair of another character does not step", () => {
    expect(type("(a|)", "]", [{ at: 2, closer: ")", open: 1 }])).toBeNull();
  });
});

describe("Backspace on an empty pair", () => {
  const removal = (s: string, pairs: Pair[]) => {
    const { text, from } = parse(s);
    const r = emptyPairRemoval(text, from, pairs);
    return r === null ? null : text.slice(0, r.from) + text.slice(r.to);
  };
  test.each([
    ["a *|* b", { at: 3, closer: "*", open: 1 }, "a  b"],
    ["a **|** b", { at: 4, closer: "**", open: 2 }, "a  b"],
    ["a ==|== b", { at: 4, closer: "==", open: 2 }, "a  b"],
    ["a ~~|~~ b", { at: 4, closer: "~~", open: 2 }, "a  b"],
    ["a [[|]] b", { at: 4, closer: "]]", open: 2 }, "a  b"],
    ["a [|] b", { at: 3, closer: "]", open: 1 }, "a  b"],
    ["a (|) b", { at: 3, closer: ")", open: 1 }, "a  b"],
    ['a "|" b', { at: 3, closer: '"', open: 1 }, "a  b"],
    ["a `|` b", { at: 3, closer: "`", open: 1 }, "a  b"],
    ["a _|_ b", { at: 3, closer: "_", open: 1 }, "a  b"],
  ] as [string, Pair, string][])("%s", (s, pair, out) => {
    expect(removal(s, [pair])).toBe(out);
  });
  test("a pair with text inside, an untracked pair and a partly stepped pair are left to the native Backspace", () => {
    expect(removal("(a|)", [{ at: 2, closer: ")", open: 1 }])).toBeNull();
    expect(removal("(|)", [])).toBeNull();
    expect(removal("**a*|*", [{ at: 4, closer: "*", open: 2 }])).toBeNull();
  });
});

describe("wrapping a selection", () => {
  test.each([
    ["*", "*", "*"],
    ["_", "_", "_"],
    ["`", "`", "`"],
    ["~", "~", "~"],
    ["=", "=", "="],
    ["[", "[", "]"],
    ["(", "(", ")"],
    ['"', '"', '"'],
  ])("%s wraps and keeps the selection", (ch, open, close) => {
    expect(type("a ‹word› b", ch)).toBe(`a ${open}‹word›${close} b`);
  });
  test("it ignores the surrounding characters", () => {
    expect(type("sn‹ak›e", "_")).toBe("sn_‹ak›_e");
  });
  test("typing again adds a layer: ~~, ==, ** and [[", () => {
    expect(type(type("‹x›", "~")!, "~")).toBe("~~‹x›~~");
    expect(type(type("‹x›", "=")!, "=")).toBe("==‹x›==");
    expect(type(type("‹x›", "*")!, "*")).toBe("**‹x›**");
    expect(type(type("‹x›", "[")!, "[")).toBe("[[‹x›]]");
  });
  test("a wrap tracks no pair", () => {
    expect(typeEdit("‹x›", "*").track).toBeUndefined();
  });
  test("other characters replace natively", () => {
    expect(type("‹x›", "a")).toBeNull();
    expect(type("‹x›", "{")).toBeNull();
    expect(type("‹x›", ")")).toBeNull();
  });
});

describe("Ctrl+B and Ctrl+I", () => {
  const toggle = (s: string, marker: "**" | "_") => {
    const { text, from, to } = parse(s);
    return show(text, toggleMarker(text, from, to, marker));
  };
  test("a selection is wrapped and stays selected, bold in ** and italic in _", () => {
    expect(toggle("a ‹word› b", "**")).toBe("a **‹word›** b");
    expect(toggle("a ‹word› b", "_")).toBe("a _‹word›_ b");
  });
  test("markers just inside the selection are removed, italic in _ or *", () => {
    expect(toggle("a ‹**word**› b", "**")).toBe("a ‹word› b");
    expect(toggle("a ‹_word_›", "_")).toBe("a ‹word›");
    expect(toggle("a ‹*word*› b", "_")).toBe("a ‹word› b");
  });
  test("markers just outside the selection are removed, italic in _ or *", () => {
    expect(toggle("a **‹word›** b", "**")).toBe("a ‹word› b");
    expect(toggle("a _‹word›_ b", "_")).toBe("a ‹word› b");
    expect(toggle("a *‹word›* b", "_")).toBe("a ‹word› b");
  });
  test("italic over bold wraps in _, and bold over italic wraps", () => {
    expect(toggle("**‹word›**", "_")).toBe("**_‹word›_**");
    expect(toggle("_‹word›_", "**")).toBe("_**‹word›**_");
    expect(toggle("*‹word›*", "**")).toBe("***‹word›***");
  });
  test("a run of three asterisks is both: each toggle removes its own part", () => {
    expect(toggle("***‹word›***", "_")).toBe("**‹word›**");
    expect(toggle("***‹word›***", "**")).toBe("*‹word›*");
  });
  test("with no selection and no span the pair is inserted with the cursor between, whatever surrounds it", () => {
    expect(toggle("a|b", "**")).toBe("a**|**b");
    expect(toggle("a|b", "_")).toBe("a_|_b");
  });
  test("the inserted pair is tracked", () => {
    expect(toggleMarker("ab", 1, 1, "**").track).toEqual({ at: 3, closer: "**", open: 2 });
    expect(toggleMarker("ab", 1, 1, "_").track).toEqual({ at: 2, closer: "_", open: 1 });
  });
  test("with no selection and the cursor inside a span, the markers are removed and the cursor stays on its text", () => {
    expect(toggle("**bo|ld**", "**")).toBe("bo|ld");
    expect(toggle("a **bo|ld** b", "**")).toBe("a bo|ld b");
    expect(toggle("**bold|**", "**")).toBe("bold|");
    expect(toggle("**|bold**", "**")).toBe("|bold");
    expect(toggle("_it|alic_", "_")).toBe("it|alic");
    expect(toggle("*it|alic*", "_")).toBe("it|alic");
  });
  test("the span that holds the cursor is chosen among several", () => {
    expect(toggle("**a** **b|c**", "**")).toBe("**a** b|c");
    expect(toggle("**a|** **bc**", "**")).toBe("a| **bc**");
  });
  test("the cursor between two spans is not in a span", () => {
    expect(toggle("**a** b| **c**", "**")).toBe("**a** b**|** **c**");
  });
  test("an italic span in a bold one, and a bold one in an italic one, are different spans", () => {
    expect(toggle("**bo|ld**", "_")).toBe("**bo_|_ld**");
    expect(toggle("_it|alic_", "**")).toBe("_it**|**alic_");
  });
  test("a lone underscore of a word is not a span", () => {
    expect(toggle("snake_ca|se", "_")).toBe("snake_ca_|_se");
  });
  test("three asterisks around the cursor hold bold and italic", () => {
    expect(toggle("***ab|c***", "_")).toBe("**ab|c**");
    expect(toggle("***ab|c***", "**")).toBe("*ab|c*");
  });
  test("an empty pair is removed by the same key", () => {
    expect(toggle("a **|** b", "**")).toBe("a | b");
    expect(toggle("a _|_ b", "_")).toBe("a | b");
    expect(toggle("a *|* b", "_")).toBe("a | b");
    expect(toggle("**|**", "_")).toBe("**_|_**");
  });
});

describe("dead keys (composition)", () => {
  // `before` and `after` are the document before and after the composition, with the cursor marked in `before` and the composed character in `after`.
  const composed = (before: string, after: string, pairs: Pair[] = []) => {
    const { text, from } = parse(before);
    const e = composedEdit(text, after, from, pairs);
    return e === null ? null : show(after, e);
  };
  test("a composed backtick pairs like a typed one", () => {
    expect(composed("a |", "a `")).toBe("a `|`");
    expect(composed("|", "`")).toBe("`|`");
  });
  test("a composed backtick inside a word stays literal", () => {
    expect(composed("ab|", "ab`")).toBeNull();
  });
  test("a first composed ~ stays literal and the second gives ~~|~~", () => {
    expect(composed("a |", "a ~")).toBeNull();
    expect(composed("a ~|", "a ~~")).toBe("a ~~|~~");
  });
  test("a composed ~ steps over a tracked ~~ closer, one character at a time", () => {
    const pairs: Pair[] = [{ at: 4, closer: "~~", open: 2 }];
    expect(composed("~~x|~~", "~~x~~~", pairs)).toBe("~~x~|~");
  });
  test("an accented letter, several characters, or another change are not typed pairs", () => {
    expect(composed("a |", "a ẽ")).toBeNull();
    expect(composed("a |", "a ~~")).toBeNull();
    expect(composed("a |", "b `")).toBeNull();
    expect(composed("a |", "a ")).toBeNull();
  });
  test("the dropped pair is given as a position of the document after the composition", () => {
    const e = composedEdit("~~x~~", "~~x~~~", 3, [{ at: 4, closer: "~~", open: 2 }])!;
    expect(e.drop).toBe(4);
    expect(e.track).toEqual({ at: 4, closer: "~", open: 2 });
  });
});

describe("Ctrl+K", () => {
  const link = (s: string, clipboard: string | null) => {
    const { text, from, to } = parse(s);
    return show(text, linkEdit(text, from, to, clipboard));
  };
  test("a selection and a URL give [selection](url) with the cursor after it", () => {
    expect(link("a ‹word› b", "https://example.com/x")).toBe("a [word](https://example.com/x)| b");
  });
  test("no selection and a URL give [|](url)", () => {
    expect(link("a | b", "http://example.com")).toBe("a [|](http://example.com) b");
  });
  test("the URL is trimmed", () => {
    expect(link("‹w›", "  https://example.com/a\n")).toBe("[w](https://example.com/a)|");
  });
  test("another text, another scheme, a whitespace, an empty clipboard or a failed read fall back to an empty URL", () => {
    for (const clip of ["hello", "ftp://example.com", "https://example.com/a b", "two https://example.com", "", "   ", null]) {
      expect(link("a ‹word›", clip)).toBe("a [word](|)");
      expect(link("a |", clip)).toBe("a [|]()");
    }
  });
  test("the label has [, ] and \\ escaped", () => {
    expect(link("‹a[1]\\b›", "https://example.com")).toBe("[a\\[1\\]\\\\b](https://example.com)|");
    expect(link("‹a[1]›", null)).toBe("[a\\[1\\]](|)");
  });
});
