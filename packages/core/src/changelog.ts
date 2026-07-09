import { appendFile } from "node:fs/promises";
import { join } from "node:path";

const CHANGELOG_FILE_NAME = "changes.jsonl";

export interface ChangelogEntry {
  ts: string;
  action: "create" | "update";
  file: string;
  reason: string;
}

export async function appendChangelogEntry(
  vaultPath: string,
  entry: Omit<ChangelogEntry, "ts"> & { ts?: string },
): Promise<void> {
  const full: ChangelogEntry = { ts: new Date().toISOString(), ...entry };
  const line = `${JSON.stringify(full)}\n`;
  await appendFile(join(vaultPath, CHANGELOG_FILE_NAME), line, "utf8");
}
