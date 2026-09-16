import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { assertPluginSourceSafe } from "../src/ai/capital-engine/plugin-boundary";

const pluginDirectory = join(
  process.cwd(),
  "src",
  "ai",
  "capital-engine",
  "plugins",
);

async function main(): Promise<void> {
  let files: string[];
  try {
    files = (await readdir(pluginDirectory)).filter((file) =>
      /\.(ts|tsx|js|jsx)$/.test(file),
    );
  } catch {
    files = [];
  }

  for (const file of files) {
    const source = await readFile(join(pluginDirectory, file), "utf8");
    assertPluginSourceSafe(source);
  }
}

await main();
