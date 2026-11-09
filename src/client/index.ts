// Client entry point, built by Bun.
import { createApi, subscribeEvents } from "./api";
import { createStore } from "./store";
import { isTextField, undoActionFor } from "./shortcuts";
import { isEditing } from "./view/edit-text";
import { mountApp } from "./view/app";

const store = createStore({ api: createApi(), storage: localStorage });
mountApp(
  {
    header: document.getElementById("app-header")!,
    banners: document.getElementById("banners")!,
    main: document.getElementById("app-main")!,
  },
  store,
);

// The task editor and the add inputs keep their own undo, the global one applies once they are left.
window.addEventListener("keydown", (e) => {
  const action = undoActionFor(e);
  if (!action || isEditing() || isTextField(e.target)) return;
  e.preventDefault();
  if (action === "undo") store.undo();
  else store.redo();
});

window.addEventListener("beforeunload", (e) => {
  if (store.hasPendingChanges()) {
    e.preventDefault();
    e.returnValue = ""; // legacy browsers need a value for the confirmation dialog
  }
});

void store.load();
subscribeEvents(store.onExternalChange, store.onReconnect);
