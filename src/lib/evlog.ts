import { createFsDrain } from "evlog/fs";
import { createEvlog } from "evlog/next";
import { createInstrumentation } from "evlog/next/instrumentation/create";

// evlog's framework export is named useLogger; we re-export it as getLogger
// because it is a request-scoped logger, not a React hook — the misleading
// use* name trips rules-of-hooks linters (biome + react-doctor).
const { useLogger: getLogger, withEvlog, log, createError } = createEvlog({
  service: "viipers-web",
  drain: process.env.NODE_ENV === "production" ? undefined : createFsDrain(),
});

export { getLogger, withEvlog, log, createError };

export const { register, onRequestError } = createInstrumentation({
  service: "viipers-web",
});
