// Client entry point, built by Bun.
import { createApi, subscribeEvents } from "./api";
import { createStore } from "./store";
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

window.addEventListener("beforeunload", (e) => {
  if (store.hasPendingChanges()) {
    e.preventDefault();
    e.returnValue = ""; // legacy browsers need a value for the confirmation dialog
  }
});

void store.load();
subscribeEvents(store.onExternalChange, store.onReconnect);
