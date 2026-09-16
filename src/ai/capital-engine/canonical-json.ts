export function canonicalise(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalise(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
