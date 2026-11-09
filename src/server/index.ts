import { serve } from "bun";
import homepage from "../client/index.html";
import { createApp } from "./app";
import { ensureTodoFile, resolveTodoFile } from "./config";

const todoFile = resolveTodoFile(process.env);
await ensureTodoFile(todoFile);

const app = createApp({ file: todoFile });

const server = serve({
  hostname: "127.0.0.1",
  port: process.env.PORT ? Number(process.env.PORT) : 5173,
  routes: {
    "/": homepage,
    "/api/*": app.fetch,
  },
});

console.log(`Serving ${todoFile} on ${server.url}`);
