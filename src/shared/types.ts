// JSON model and API contract shared by client and server.

export type Subtask = {
  text: string;
  done: boolean;
};

export type Task = {
  text: string;
  done: boolean;
  /** Absent or empty when the task has no subtasks. */
  children?: Subtask[];
};

export type TodoList = {
  title: string;
  tasks: Task[];
};

/** A named filter text (PRD 5.14), stored in the frontmatter of the file. Names are unique. */
export type SavedFilter = {
  name: string;
  text: string;
};

export type TodoDocument = {
  lists: TodoList[];
  filters: SavedFilter[];
};

/** Body of a `422` response, and the error returned by the parser. Lines are 1-based. */
export type ParseError = {
  line: number;
  reason: string;
};

/** Data of the `change` SSE event: the new ETag and either the parsed document or the parse error of the invalid file. */
export type ChangeEvent = { etag: string; doc: TodoDocument } | { etag: string; error: ParseError };
