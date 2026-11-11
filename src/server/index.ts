import { serve } from "bun";
import homepage from "../client/index.html";
import { createApp } from "./app";
import { ensureTodoFile, resolveHost, resolveTodoFile, resolveVault } from "./config";

const vault = await resolveVault(process.env).catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});

let app;
let served: string;
if (vault) {
  app = createApp({ vault });
  served = `the Vault ${vault.vaultDir}`;
} else {
  const todoFile = resolveTodoFile(process.env);
  await ensureTodoFile(todoFile);
  app = createApp({ file: todoFile });
  served = todoFile;
}

const server = serve({
  hostname: resolveHost(process.env),
  port: process.env.PORT ? Number(process.env.PORT) : 5173,
  routes: {
    "/": homepage,
    "/api/*": app.fetch,
  },
});

console.log(`Serving ${served} on ${server.url}`);
