import { serve } from "bun";
import homepage from "./index.html";

const server = serve({
  hostname: "0.0.0.0",
  port: 5173,
  routes: {
    "/": homepage,
  },
});
