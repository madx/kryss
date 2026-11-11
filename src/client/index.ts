// Client entry point, built by Bun.
import { createApi, createFile, listFiles, subscribeEvents } from "./api";
import { chooseFile, fileHref, LAST_FILE_KEY } from "./logic/files";
import { createStore } from "./store";
import { mountApp } from "./view/app";
import { mountEmptyVault } from "./view/empty-vault";

const roots = {
  header: document.getElementById("app-header")!,
  banners: document.getElementById("banners")!,
  main: document.getElementById("app-main")!,
};
const safe = <T>(fn: () => T): T | null => {
  try {
    return fn();
  } catch {
    return null; // storage can be unavailable
  }
};

/** Opening a file is a navigation to its `?file=`. */
const openFile = (path: string) => location.assign(fileHref(path));
const vaultCalls = {
  list: async () => {
    const result = await listFiles();
    return result.kind === "vault" ? result.files : null;
  },
  create: createFile,
  open: openFile,
};

const listing = await listFiles();
let file: string | null = null;
if (listing.kind === "vault") {
  file = chooseFile(new URLSearchParams(location.search).get("file"), safe(() => localStorage.getItem(LAST_FILE_KEY)), listing.files);
  if (file === null) {
    mountEmptyVault(roots, vaultCalls);
  } else {
    safe(() => localStorage.setItem(LAST_FILE_KEY, file!));
    history.replaceState(null, "", fileHref(file)); // a reload or a bookmark returns to this file
  }
}

if (listing.kind !== "vault" || file !== null) {
  const store = createStore({ api: createApi(file), storage: localStorage, file });
  mountApp(roots, store, localStorage, file === null ? undefined : { file, ...vaultCalls });

  window.addEventListener("beforeunload", (e) => {
    if (store.hasPendingChanges()) {
      e.preventDefault();
      e.returnValue = ""; // legacy browsers need a value for the confirmation dialog
    }
  });

  void store.load();
  subscribeEvents(store.onExternalChange, store.onReconnect, file);
}
