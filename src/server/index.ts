import { serve } from "bun";
import homepage from "../client/index.html";
import { ensureTodoFile, resolveTodoFile } from "./config";

const todoFile = resolveTodoFile(process.env);
await ensureTodoFile(todoFile);

const server = serve({
  hostname: "127.0.0.1",
  port: 5173,
  routes: {
    "/": homepage,
  },
});

console.log(`Serving ${todoFile} on ${server.url}`);
