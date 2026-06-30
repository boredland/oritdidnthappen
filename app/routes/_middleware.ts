import { createRoute } from "honox/factory";
import { secureHeaders } from "hono/secure-headers";

// Baseline security hygiene on every response: HSTS, nosniff, referrer policy,
// and clickjacking protection. CSP is intentionally omitted here — the app
// loads Google Fonts + inline JSON-LD and a tuned policy needs its own pass.
export default createRoute(
  secureHeaders({
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
  }),
);
