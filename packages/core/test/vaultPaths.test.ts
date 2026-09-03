import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertVaultRelativePath,
  isVaultRelativePath,
  resolveInsideVault,
  resolveNoteFile,
  VaultPathError,
} from "../src/vaultPaths.js";
import { listNotes, readNote, toFilePath, writeNote } from "../src/notes.js";

describe("assertVaultRelativePath", () => {
  it("normalizes separators and drops redundant segments", () => {
    expect(assertVaultRelativePath("MOCs/General")).toBe("MOCs/General");
    expect(assertVaultRelativePath("./MOCs//General")).toBe("MOCs/General");
    expect(assertVaultRelativePath("MOCs\\General")).toBe("MOCs/General");
  });

  it("rejects parent-directory escapes, in either separator style", () => {
    expect(() => assertVaultRelativePath("../outside/evil")).toThrow(VaultPathError);
    expect(() => assertVaultRelativePath("Notes/../../outside/evil")).toThrow(VaultPathError);
    // Rejected on POSIX too: a backslash-shaped traversal must not survive
    // validation on one platform and take effect on another.
    expect(() => assertVaultRelativePath("..\\outside\\evil")).toThrow(VaultPathError);
  });

  it("rejects absolute paths in POSIX, Windows drive-letter and UNC forms", () => {
    expect(() => assertVaultRelativePath("/etc/passwd")).toThrow(VaultPathError);
    expect(() => assertVaultRelativePath("C:/Windows/secret")).toThrow(VaultPathError);
    expect(() => assertVaultRelativePath("C:secret")).toThrow(VaultPathError);
    expect(() => assertVaultRelativePath("\\\\server\\share\\secret")).toThrow(VaultPathError);
  });

  it("rejects the tool's own data dir and the Obsidian config dir at any depth", () => {
    expect(() => assertVaultRelativePath(".vault-neural-links/link-weights")).toThrow(VaultPathError);
    expect(() => assertVaultRelativePath(".obsidian/workspace")).toThrow(VaultPathError);
    expect(() => assertVaultRelativePath("Notes/.obsidian/plugins/x")).toThrow(VaultPathError);
  });

  it("rejects empty paths and NUL bytes", () => {
    expect(() => assertVaultRelativePath("")).toThrow(VaultPathError);
    expect(() => assertVaultRelativePath("   ")).toThrow(VaultPathError);
    expect(() => assertVaultRelativePath("./")).toThrow(VaultPathError);
    expect(() => assertVaultRelativePath("Notes/ok\0.md")).toThrow(VaultPathError);
  });

  it("keeps ordinary note paths, including dots inside a name", () => {
    expect(isVaultRelativePath("Analysis/2026-09-02 v1.2 report")).toBe(true);
    expect(isVaultRelativePath("MOCs/General")).toBe(true);
    expect(isVaultRelativePath("../x")).toBe(false);
  });
});

describe("resolveInsideVault", () => {
  const vault = resolve(join(tmpdir(), "vnl-containment-vault"));

  it("resolves a relative path under the vault root", () => {
    expect(resolveInsideVault(vault, "MOCs/General")).toBe(join(vault, "MOCs", "General"));
  });

  it("never returns a path outside the vault root", () => {
    for (const bad of ["../outside", "Notes/../../outside", "/etc/passwd"]) {
      let resolved: string | undefined;
      try {
        resolved = resolveInsideVault(vault, bad);
      } catch (err) {
        expect(err).toBeInstanceOf(VaultPathError);
        continue;
      }
      expect(resolved!.startsWith(vault + sep)).toBe(true);
    }
  });

  it("appends .md exactly once for note paths", () => {
    expect(resolveNoteFile(vault, "Notes/A")).toBe(join(vault, "Notes", "A.md"));
    expect(resolveNoteFile(vault, "Notes/A.md")).toBe(join(vault, "Notes", "A.md"));
    expect(() => resolveNoteFile(vault, "")).toThrow(VaultPathError);
  });
});

describe("note I/O containment", () => {
  let root: string;
  let vault: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vnl-vault-"));
    vault = join(root, "vault");
    await mkdir(join(vault, "Notes"), { recursive: true });
    await mkdir(join(root, "outside"), { recursive: true });
    await writeFile(join(vault, "Notes", "Inside.md"), "---\ntype: note\n---\n\nbody\n", "utf8");
    await writeFile(join(root, "outside", "Secret.md"), "---\n---\n\nsecret\n", "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads a note inside the vault", async () => {
    const note = await readNote(vault, "Notes/Inside");
    expect(note?.body.trim()).toBe("body");
  });

  it("refuses to read a note outside the vault", async () => {
    await expect(readNote(vault, "../outside/Secret")).rejects.toBeInstanceOf(VaultPathError);
  });

  it("refuses to write a note outside the vault, and creates nothing", async () => {
    await expect(
      writeNote(vault, "../outside/Evil", { frontmatter: {}, body: "pwned" }),
    ).rejects.toBeInstanceOf(VaultPathError);
    await expect(readFile(join(root, "outside", "Evil.md"), "utf8")).rejects.toThrow();
  });

  it("refuses to write into the tool's own data dir", async () => {
    await expect(
      writeNote(vault, ".vault-neural-links/link-weights", { frontmatter: {}, body: "x" }),
    ).rejects.toBeInstanceOf(VaultPathError);
  });

  it("toFilePath rejects an escaping path rather than returning one", () => {
    expect(toFilePath(vault, "Notes/Inside")).toBe(join(vault, "Notes", "Inside.md"));
    expect(() => toFilePath(vault, "../outside/Secret")).toThrow(VaultPathError);
  });

  it("refuses to list a folder outside the vault", async () => {
    await expect(listNotes(vault, { folder: "../outside" })).rejects.toBeInstanceOf(VaultPathError);
    await expect(listNotes(vault, { folder: "Notes" })).resolves.toEqual(["Notes/Inside"]);
  });
});
