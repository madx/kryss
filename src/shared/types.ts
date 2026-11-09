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

export type TodoDocument = {
  lists: TodoList[];
};

/** Body of a `422` response, and the error returned by the parser. Lines are 1-based. */
export type ParseError = {
  line: number;
  reason: string;
};
