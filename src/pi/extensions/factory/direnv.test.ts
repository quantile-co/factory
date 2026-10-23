import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { trust } from "./direnv.ts";

let base: string;
let primary: string;
let child: string;
const run = (cwd: string, command: string, ...args: string[]) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const allowed = (cwd: string) =>
  JSON.parse(run(cwd, "direnv", "status", "--json")).state.foundRC.allowed;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "factory-trust-"));
  primary = join(base, "primary");
  child = join(base, "child");
  vi.stubEnv("DIRENV_CONFIG", join(base, "config"));
  vi.stubEnv("XDG_DATA_HOME", join(base, "data"));
  vi.stubEnv("XDG_CACHE_HOME", join(base, "cache"));
  vi.stubEnv("DIRENV_DIR", "");
  vi.stubEnv("DIRENV_WATCHES", "");
  vi.stubEnv("DIRENV_DIFF", "");
  mkdirSync(primary);
  run(primary, "git", "init", "-q", "-b", "main");
  writeFileSync(
    join(primary, ".envrc"),
    "touch env-executed\nexport FACTORY_TEST_ENV=approved\n",
  );
  run(primary, "git", "add", ".envrc");
  run(
    primary,
    "git",
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "initial",
  );
  run(primary, "git", "worktree", "add", "-qb", "task", child);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(base, { recursive: true, force: true });
});

it("reuses only existing primary approval without evaluating either environment", async () => {
  await expect(trust(primary, child)).rejects.toThrow(
    /Approve the reviewed primary/,
  );
  expect(allowed(primary)).toBe(1);
  expect(allowed(child)).toBe(1);
  run(primary, "direnv", "allow", primary);
  await trust(primary, child);
  expect(allowed(child)).toBe(0);
  expect(existsSync(join(primary, "env-executed"))).toBe(false);
  expect(existsSync(join(child, "env-executed"))).toBe(false);
  expect(
    run(
      child,
      "direnv",
      "exec",
      child,
      "sh",
      "-c",
      'printf %s "$FACTORY_TEST_ENV"',
    ),
  ).toBe("approved");
});

it.each([
  "changed child",
  "changed primary",
  "local override",
  "symlink",
  "denied child",
  "denied primary",
])("does not inherit trust for %s", async (kind) => {
  run(primary, "direnv", "allow", primary);
  if (kind === "changed child")
    writeFileSync(join(child, ".envrc"), "export DIFFERENT=1\n");
  if (kind === "changed primary") {
    const contents = `${readFileSync(join(primary, ".envrc"), "utf8")}export CHANGED=1\n`;
    writeFileSync(join(primary, ".envrc"), contents);
    writeFileSync(join(child, ".envrc"), contents);
    run(primary, "direnv", "allow", primary);
  }
  if (kind === "local override")
    writeFileSync(join(child, ".envrc.local"), "touch local-executed\n");
  if (kind === "symlink") {
    rmSync(join(child, ".envrc"));
    symlinkSync(join(primary, ".envrc"), join(child, ".envrc"));
  }
  if (kind === "denied child") run(child, "direnv", "deny", child);
  if (kind === "denied primary") run(primary, "direnv", "deny", primary);
  const before = allowed(child);
  await expect(trust(primary, child)).rejects.toThrow();
  expect(allowed(child)).toBe(before);
  expect(existsSync(join(child, "env-executed"))).toBe(false);
  expect(existsSync(join(child, "local-executed"))).toBe(false);
});

it("respects a separately approved child and does not require direnv in repositories without .envrc", async () => {
  writeFileSync(join(child, ".envrc"), "export SEPARATELY_REVIEWED=1\n");
  run(child, "direnv", "allow", child);
  await trust(primary, child);
  expect(allowed(primary)).toBe(1);
  expect(allowed(child)).toBe(0);
  rmSync(join(primary, ".envrc"));
  rmSync(join(child, ".envrc"));
  vi.stubEnv("PATH", "");
  await expect(trust(primary, child)).resolves.toBeUndefined();
});
