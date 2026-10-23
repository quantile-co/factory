import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { type FileEntry, manageFiles } from "../files/default";

it("keeps the QMD output identity while substituting external fetchers", () => {
  const root = new URL("../../", import.meta.url);
  const result = spawnSync(
    "nix",
    [
      "--extra-experimental-features",
      "nix-command flakes",
      "eval",
      "--json",
      "--impure",
      "--expr",
      `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
  pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  cfg = (pkgs.lib.evalModules { modules = [ f.nixModules.qmd ]; specialArgs = { inherit pkgs; }; }).config;
in { selected = cfg.quantile-co.factory.qmd.package.outPath;
  upstream = f.inputs.llm-agents.packages.\${builtins.currentSystem}.qmd.outPath; }`,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (result.error) throw result.error;
  expect(result.status, result.stderr).toBe(0);
  const paths = JSON.parse(result.stdout) as {
    selected: string;
    upstream: string;
  };
  expect(paths.selected).toBe(paths.upstream);
}, 120_000);

it("keeps the indexed QMD seed clean on startup and preserves repository choices", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-qmd-seed-"));
  try {
    const root = join(work, "repo");
    const home = join(work, "home");
    mkdirSync(root);
    mkdirSync(home);
    const source = fileURLToPath(
      new URL("../../etc/qmd/index.yml", import.meta.url),
    );
    const canonical = readFileSync(source, "utf8");
    const entries: Record<string, FileEntry> = {
      ".qmd/index.yml": { source, mode: "seed" },
    };
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(root, ".gitignore"), "/.qmd/index.sqlite*\n");
    manageFiles(root, entries, "write");
    git("add", ".gitignore", ".qmd/index.yml");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-qm",
      "Fixture baseline",
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("QMD_") && key !== "INDEX_PATH",
      ),
    );
    Object.assign(env, {
      HOME: home,
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_CACHE_HOME: join(home, "cache"),
    });
    const config = join(root, ".qmd/index.yml");
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const args of [
        ["collection", "list"],
        ["collection", "list", "--json"],
      ]) {
        execFileSync("qmd", args, { cwd: root, env, timeout: 15_000 });
      }
      manageFiles(root, entries, "write");
      manageFiles(root, entries, "check");
      expect(readFileSync(config, "utf8")).toBe(canonical);
      expect(git("status", "--porcelain")).toBe("");
    }
    const customized = canonical
      .replace("path: .pi/memory", "path: .pi/custom-memory")
      .replace(/ {2}embed: .+/, "  embed: hf:example/custom/model.gguf");
    writeFileSync(config, customized);
    execFileSync("qmd", ["collection", "list"], {
      cwd: root,
      env,
      timeout: 15_000,
    });
    manageFiles(root, entries, "write");
    manageFiles(root, entries, "check");
    expect(readFileSync(config, "utf8")).toBe(customized);
    expect(git("status", "--porcelain")).toBe(" M .qmd/index.yml\n");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 120_000);
