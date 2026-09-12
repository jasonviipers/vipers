import { createFsDrain } from "evlog/fs";
import { createEvlog } from "evlog/next";
import { createInstrumentation } from "evlog/next/instrumentation/create";

export const { withEvlog, useLogger, log, createError } = createEvlog({
  service: "viipers-web",
  drain: process.env.NODE_ENV === "production" ? undefined : createFsDrain(),
});

export const { register, onRequestError } = createInstrumentation({
  service: "viipers-web",
});
