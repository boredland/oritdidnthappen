import { createRoute } from "honox/factory";
import { handleOAuthCallback } from "../../../lib/oauth";

export default createRoute((c) => handleOAuthCallback(c, "dropbox"));
