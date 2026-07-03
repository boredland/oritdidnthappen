import { showRoutes } from "hono/dev";
import { createApp } from "honox/server";
import type { Bindings } from "./global";
import { cleanupExpiredEvents } from "./lib/retention";

const app = createApp();

showRoutes(app);

// Cloudflare invokes `scheduled` on the Cron trigger (see wrangler.jsonc). We
// attach it to the Hono app rather than switching to `export default { fetch,
// scheduled }` so the default export stays the callable app that honox's build
// and the test harness rely on.
export default Object.assign(app, {
  scheduled(
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ): void {
    ctx.waitUntil(cleanupExpiredEvents(env));
  },
});
