import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { manageFiles } from "./files.mjs";

const work = mkdtempSync(join(tmpdir(), "factory-files-"));
afterEach(() => rmSync(work, { recursive: true, force: true }));

function fixture() {
  const root = join(work, "repo");
  const source = join(work, "source");
  mkdirSync(root, { recursive: true });
  mkdirSync(source, { recursive: true });
  execFileSync("git", ["init", "-q", root]);
  return { root, source };
}

test("seed preserves edits, while copy restores changed regular files", () => {
  const { root, source } = fixture();
  const seed = join(source, "seed");
  const copy = join(source, "copy");
  writeFileSync(seed, "seed original\n");
  writeFileSync(copy, "copy original\n");
  const entries = {
    "seed.txt": { mode: "seed", source: seed },
    "copy.txt": { mode: "copy", source: copy },
  };
  manageFiles(root, entries, "materialize");
  writeFileSync(join(root, "seed.txt"), "user edit\n");
  writeFileSync(join(root, "copy.txt"), "manual edit\n");
  expect(() => manageFiles(root, entries, "check")).toThrow("copy.txt");
  manageFiles(root, entries, "materialize");
  manageFiles(root, entries, "check");
  expect(readFileSync(join(root, "seed.txt"), "utf8")).toBe("user edit\n");
  expect(readFileSync(join(root, "copy.txt"), "utf8")).toBe("copy original\n");
});

test("check catches indexed copy drift even after direnv refreshes the working tree", () => {
  const { root, source } = fixture();
  const expected = join(source, "config");
  writeFileSync(expected, "expected\n");
  const entries = { "config.txt": { mode: "copy", source: expected } };
  writeFileSync(join(root, "config.txt"), "committed drift\n");
  execFileSync("git", ["add", "config.txt"], { cwd: root });
  manageFiles(root, entries, "materialize");
  expect(readFileSync(join(root, "config.txt"), "utf8")).toBe("expected\n");
  expect(() => manageFiles(root, entries, "check")).toThrow("config.txt");
});

test("copies directories as regular files, detects nested drift, and refuses external symlinks", () => {
  const { root, source } = fixture();
  const rules = join(source, "rules");
  mkdirSync(rules);
  writeFileSync(join(rules, "rule.yaml"), "original\n");
  const entries = { rules: { mode: "copy", source: rules } };
  manageFiles(root, entries, "materialize");
  writeFileSync(join(root, "rules", "rule.yaml"), "edited\n");
  expect(() => manageFiles(root, entries, "check")).toThrow("rules");
  rmSync(join(root, "rules"), { recursive: true });
  symlinkSync(rules, join(root, "rules"));
  expect(() => manageFiles(root, entries, "materialize")).toThrow(
    "Refusing unmanaged symlink",
  );
});
