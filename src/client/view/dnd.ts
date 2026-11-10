// Drag and drop with Pragmatic drag and drop.
// The whole row is the drag source (no handle) and a drop target, an empty list (`ul.tasks`) is a drop target too.
// Lists are dragged by their whole header (All view only) onto any list panel: top half before, bottom half after (PRD 5.4).
// List drags and task drags are separate drag types (`data.type`), so a list never lands in a task row and a task never reorders lists.
// The DOM is rebuilt on every change, so `refresh` is called after each render: it drops the old registrations and registers the new elements.
// The drop zone is derived from the pointer position in the row (see dnd-zone.ts) and checked with `validateDrop`: a refused zone shows no indicator and does nothing.
import { draggable, dropTargetForElements, monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import type { TodoDocument } from "../../shared/types";
import { getNode, moveList, moveTask, validateDrop, type Drop, type ListPlace, type TaskPath } from "../logic";
import { zoneFromPointer, type Zone } from "./dnd-zone";

type Source = { path: TaskPath };
type ListOver = { list: number; place: ListPlace; element: HTMLElement };
type Over = { drop: Drop; element: HTMLElement; zone: Zone | "end" } | null;

function rowPath(row: HTMLElement): TaskPath {
  const { list, task, child } = row.dataset;
  return { list: Number(list), task: Number(task), ...(child === undefined ? {} : { child: Number(child) }) };
}

export function setupDnd(main: HTMLElement, deps: { getDoc(): TodoDocument | null; commit(doc: TodoDocument): void; canDragLists(): boolean; moveList(list: number, target: number, place: ListPlace): void }) {
  let cleanups: Array<() => void> = [];
  let indicated: HTMLElement | null = null;

  const clearIndicator = () => {
    indicated?.removeAttribute("data-drop");
    indicated = null;
  };

  /** "After" a parent that has subtasks inserts the task as its first child (see moveTask), so the line is drawn at the subtask level. */
  function shownZone(over: NonNullable<Over>, source: TaskPath): string {
    if (over.zone !== "after" || over.element.dataset.child !== undefined) return over.zone;
    if (getNode(deps.getDoc()!, source)?.children?.length) return "after"; // a task with subtasks goes after the whole parent
    return over.element.parentElement?.querySelector(":scope > .subtasks > li:not([data-reveal]):not(:has(.task-new))") ? "child" : "after";
  }

  /** The drop under the pointer, or null when there is none or when it is refused. */
  function resolve(source: Source, target: { element: Element; data: Record<string | symbol, unknown> }, y: number): Over {
    const doc = deps.getDoc();
    if (!doc) return null;
    const element = target.element as HTMLElement;
    if (target.data.kind === "list") {
      const drop: Drop = { kind: "end", list: Number(element.dataset.list) };
      return validateDrop(doc, source.path, drop).ok ? { drop, element, zone: "end" } : null;
    }
    const path = rowPath(element);
    const rect = element.getBoundingClientRect();
    const childOk = validateDrop(doc, source.path, { kind: "child", target: path }).ok;
    const zone = zoneFromPointer(y, rect.top, rect.height, childOk);
    const drop: Drop = { kind: zone, target: path };
    return validateDrop(doc, source.path, drop).ok ? { drop, element, zone } : null;
  }

  function currentOver(args: { source: { data: Record<string | symbol, unknown> }; location: { current: { dropTargets: Array<{ element: Element; data: Record<string | symbol, unknown> }>; input: { clientY: number } } } }): Over {
    const target = args.location.current.dropTargets[0]; // innermost target
    if (!target) return null;
    return resolve(args.source.data as unknown as Source, target, args.location.current.input.clientY);
  }

  type Args = Parameters<typeof currentOver>[0];
  const isList = (args: Args) => args.source.data.type === "list";

  /** The list drop under the pointer, or null when it would not change the order. */
  function currentListOver(args: Args): ListOver | null {
    const target = args.location.current.dropTargets[0];
    const doc = deps.getDoc();
    if (!target || !doc) return null;
    const element = target.element as HTMLElement;
    const list = Number(element.dataset.list);
    const rect = element.getBoundingClientRect();
    const zone = zoneFromPointer(args.location.current.input.clientY, rect.top, rect.height, false);
    const place: ListPlace = zone === "before" ? "before" : "after";
    const from = (args.source.data as { list: number }).list;
    return moveList(doc, from, list, place) ? { list, place, element } : null;
  }

  const stopMonitor = monitorForElements({
    onDrag(args) {
      clearIndicator();
      if (isList(args)) {
        const over = currentListOver(args);
        if (over) {
          over.element.setAttribute("data-drop", over.place);
          indicated = over.element;
        }
        return;
      }
      const over = currentOver(args);
      if (over) {
        over.element.setAttribute("data-drop", shownZone(over, (args.source.data as unknown as Source).path));
        indicated = over.element;
      }
    },
    onDrop(args) {
      if (isList(args)) {
        const over = currentListOver(args);
        clearIndicator();
        if (over) deps.moveList((args.source.data as { list: number }).list, over.list, over.place);
        return;
      }
      const over = currentOver(args);
      clearIndicator();
      if (!over) return;
      const doc = deps.getDoc();
      const result = doc && moveTask(doc, (args.source.data as unknown as Source).path, over.drop);
      if (result) deps.commit(result.doc);
    },
  });

  function refresh() {
    for (const stop of cleanups) stop();
    cleanups = [];
    clearIndicator();
    for (const row of Array.from(main.querySelectorAll<HTMLElement>(".task-row"))) {
      if (row.dataset.list === undefined) continue; // the empty row of a positional add is not part of the document
      cleanups.push(
        draggable({
          element: row,
          canDrag: () => row.querySelector(".cm-editor") === null, // never drag from an open editor
          getInitialData: () => ({ type: "task", path: rowPath(row) }),
          onDragStart: () => row.setAttribute("data-dragging", "true"),
          onDrop: () => row.removeAttribute("data-dragging"),
        }),
        dropTargetForElements({ element: row, canDrop: ({ source }) => source.data.type === "task", getData: () => ({ kind: "row" }), getDropEffect: () => "move" }),
      );
    }
    // Only empty lists are list targets: in a non-empty list, the drop zones of the rows are enough.
    for (const ul of Array.from(main.querySelectorAll<HTMLElement>("ul.tasks"))) {
      if (ul.childElementCount === 0) cleanups.push(dropTargetForElements({ element: ul, canDrop: ({ source }) => source.data.type === "task", getData: () => ({ kind: "list" }), getDropEffect: () => "move" }));
    }
    for (const panel of Array.from(main.querySelectorAll<HTMLElement>("section.list"))) {
      const header = panel.querySelector<HTMLElement>(":scope > .list-header");
      if (!header) continue;
      const list = Number(panel.dataset.list);
      cleanups.push(
        // While the name input or the delete alert is open the header is not a drag source at all, so that the input keeps its own text selection.
        ...(header.querySelector(".name-input, .alert") !== null
          ? []
          : [
              draggable({
                element: header,
                // Not from an icon button, and only in the "All" view.
                canDrag: ({ input }) => deps.canDragLists() && !document.elementFromPoint(input.clientX, input.clientY)?.closest(".icon-button"),
                getInitialData: () => ({ type: "list", list }),
                onDragStart: () => panel.setAttribute("data-dragging", "true"),
                onDrop: () => panel.removeAttribute("data-dragging"),
              }),
            ]),
        dropTargetForElements({ element: panel, canDrop: ({ source }) => source.data.type === "list", getData: () => ({ kind: "panel" }), getDropEffect: () => "move" }),
      );
    }
  }

  return {
    refresh,
    destroy() {
      for (const stop of cleanups) stop();
      cleanups = [];
      stopMonitor();
    },
  };
}
