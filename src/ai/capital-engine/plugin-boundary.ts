const FORBIDDEN_IMPORT_PATTERN =
  /(?:import(?:[\s\S]*?from\s*|\s*)|require\s*\()\s*["'`]([^"'`]+)["'`]/g;
const FORBIDDEN_MODULE_PARTS = [
  "broker",
  "credential",
  "ledger",
  "database",
  "db",
  "net",
  "http",
  "https",
  "fs",
];

export function findForbiddenPluginImports(source: string): string[] {
  const matches: string[] = [];
  for (const match of source.matchAll(FORBIDDEN_IMPORT_PATTERN)) {
    const specifier = match[1]?.toLowerCase();
    if (
      specifier &&
      FORBIDDEN_MODULE_PARTS.some((part) => specifier.includes(part))
    ) {
      matches.push(specifier);
    }
  }
  return matches;
}

export function assertPluginSourceSafe(source: string): void {
  const forbidden = findForbiddenPluginImports(source);
  if (forbidden.length > 0) {
    throw new Error(
      `Plugin imports forbidden modules: ${[...new Set(forbidden)].join(", ")}`,
    );
  }
}
