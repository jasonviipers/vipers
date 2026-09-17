/**
 * bun test preload (registered in bunfig.toml [test].preload).
 *
 * The project's server modules import "server-only", which throws when the
 * bundler doesn't classify the importer as a server component — which is
 * always under bun test, breaking several test files outright. Stubbing the
 * module here matches what Next.js does for genuine server-side execution.
 *
 * Scope guard: this stub only affects bun test processes (bunfig.toml is not
 * read by `next dev`/`next build`), so the real client-boundary guard stays
 * fully in force for the app.
 */
import { plugin } from "bun";

plugin({
  name: "server-only-stub",
  setup(build) {
    build.module("server-only", () => ({
      exports: {},
      loader: "object",
    }));
  },
});
