import type { TodoDocument } from "../../shared/types";

/** Compact fixture: two lists, one with a parent having two subtasks. */
export function sample(): TodoDocument {
  return {
    filters: [],
    lists: [
      {
        title: "A",
        tasks: [
          { text: "a0", done: false },
          { text: "a1", done: false, children: [{ text: "a1x", done: false }, { text: "a1y", done: false }] },
          { text: "a2", done: false },
        ],
      },
      { title: "Empty", tasks: [] },
    ],
  };
}

export function frozen<T>(value: T): T {
  const freeze = (v: unknown): void => {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      Object.freeze(v);
      Object.values(v).forEach(freeze);
    }
  };
  freeze(value);
  return value;
}
