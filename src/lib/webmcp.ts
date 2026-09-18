/**
 * Typed, dependency-free facade over the WebMCP imperative API
 * (`document.modelContext`). WebMCP is experimental and origin-trial gated,
 * so every helper feature-detects and no-ops when the page isn't enrolled.
 */

export interface WebMCPToolAnnotations {
  /** Tool only reads page/terminal state and never mutates anything. */
  readOnlyHint?: boolean;
  /** Tool output may contain untrusted content (scraped text, market data). */
  untrustedContentHint?: boolean;
  /** Tool triggers changes with long-lived consequential effects. */
  consequentialHint?: boolean;
}

export interface WebMCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  /** Executes against a serializable JSON input and returns a string. */
  execute: (
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => string | Promise<string>;
  annotations?: WebMCPToolAnnotations;
}

export interface WebMCPRegisterOptions {
  signal?: AbortSignal;
  exposedTo?: string[];
}

interface WebMCPModelContext {
  registerTool(
    tool: WebMCPTool,
    options?: WebMCPRegisterOptions,
  ): Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<WebMCPTool[]>;
}

type WebMCPDocument = Document & { modelContext?: WebMCPModelContext };

/**
 * The page's modelContext when WebMCP is available on this origin,
 * otherwise null. Safe to call from a server bundle (guards `document`).
 */
export function getModelContext(): WebMCPModelContext | null {
  if (typeof document === "undefined") {
    return null;
  }
  const context = (document as WebMCPDocument).modelContext;
  return context && typeof context.registerTool === "function" ? context : null;
}

/** True when the browser exposes the WebMCP imperative API. */
export function isWebMCPAvailable(): boolean {
  return getModelContext() !== null;
}

/**
 * Register an array of tools in declaration order. Aborting `signal`
 * unregisters them (per the spec, without cancelling in-flight executions).
 * Returns true when at least one tool was registered.
 */
export async function registerWebMCPTools(
  tools: WebMCPTool[],
  options?: WebMCPRegisterOptions,
): Promise<boolean> {
  const context = getModelContext();
  if (!context) {
    return false;
  }
  const results = await Promise.allSettled(
    tools.map((tool) => context.registerTool(tool, options)),
  );
  return results.some((result) => result.status === "fulfilled");
}
