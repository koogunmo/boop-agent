import type { AppType } from "@boop/worker";
import { hc } from "hono/client";

export const rpc = hc<AppType>("/");
