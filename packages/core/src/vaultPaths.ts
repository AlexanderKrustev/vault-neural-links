import { join } from "node:path";

// Runtime data lives inside the vault itself, mirroring how Obsidian nests
// its own .obsidian/ config folder.
const DATA_DIR_NAME = ".vault-neural-links";

export function resolveDataDir(vaultPath: string): string {
  return join(vaultPath, DATA_DIR_NAME);
}
