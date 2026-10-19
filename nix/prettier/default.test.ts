import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("checks native Prettier rules and ignores without mutation, then fixes only selected tracked files", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-prettier-"));
  const repo = join(work, "consumer");
  try {
    for (const dir of ["source with spaces", "excluded", "build", "docs"]) {
      mkdirSync(join(repo, dir), { recursive: true });
    }
    const config = join(repo, ".prettierrc.json");
    const ignore = join(repo, ".prettierignore");
    copyFileSync(
      new URL("../../etc/prettier/.prettierrc.json", import.meta.url),
      config,
    );
    copyFileSync(
      new URL("../../etc/prettier/.prettierignore", import.meta.url),
      ignore,
    );
    appendFileSync(
      ignore,
      "excluded/**\n!excluded/keep.json\n/root-only.json\n",
    );
    writeFileSync(join(repo, ".gitignore"), "ignored.json\n");
    const good = '{\n  "enabled": true\n}\n';
    const fixed = '{ "enabled": true }\n';
    const bad = '{"enabled":true}\n';
    const target = join(repo, "source with spaces/settings.json");
    const keep = join(repo, "excluded/keep.json");
    writeFileSync(target, good);
    writeFileSync(keep, good);
    for (const file of [
      "excluded/other.json",
      "build/bad.json",
      "root-only.json",
    ]) {
      writeFileSync(join(repo, file), "invalid JSON\n");
    }
    writeFileSync(join(repo, "ignored.json"), "invalid JSON\n");
    const prose = `${"word ".repeat(30).trim()}\n`;
    const markdown = join(repo, "docs/prose.md");
    writeFileSync(markdown, prose);
    const external = join(work, "external.json");
    writeFileSync(external, bad);
    symlinkSync(external, join(repo, "linked.json"));
    const run = (
      command: string,
      args: string[],
      env = process.env,
      cwd = repo,
    ) => {
      const result = spawnSync(command, args, {
        cwd,
        env,
        encoding: "utf8",
        timeout: 120_000,
      });
      if (result.error) throw result.error;
      return {
        status: result.status,
        stdout: result.stdout,
        output: result.stdout + result.stderr,
      };
    };
    expect(
      run("git", ["init", "--quiet", "--initial-branch=main"]).status,
    ).toBe(0);
    expect(run("git", ["add", "."]).status).toBe(0);
    const build = (selector: string) => {
      const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      in (pkgs.lib.evalModules {
        modules = [ f.nixModules.prettier ]; specialArgs = { inherit pkgs; };
      }).config.quantile.prettier.${selector}`;
      const built = run(
        "nix",
        [
          "--extra-experimental-features",
          "nix-command flakes",
          "build",
          "--no-link",
          "--print-out-paths",
          "--impure",
          "--expr",
          expr,
        ],
        process.env,
        work,
      );
      expect(built.status, built.output).toBe(0);
      return built.stdout.trim();
    };
    const check = join(build("check.package"), "bin/check-prettier");
    const fix = join(build("fix.package"), "bin/fix-prettier");
    const prettier = join(build("package"), "bin/prettier");
    const env = {
      ...process.env,
      HOME: work,
      PRETTIER_BIN: prettier,
    };
    const missingTool = run(check, ["*.json"], { ...env, PRETTIER_BIN: "" });
    expect(missingTool.status).not.toBe(0);
    expect(missingTool.output).toContain("Set PRETTIER_BIN");
    expect(run(check, ["*.json"], env).status).toBe(0);

    writeFileSync(target, bad);
    writeFileSync(keep, bad);
    const untracked = join(repo, "untracked.json");
    writeFileSync(untracked, bad);
    const finding = run(check, ["*.json"], env);
    expect(finding.status).not.toBe(0);
    expect(finding.output).toContain("Code style issues found");
    expect(readFileSync(target, "utf8")).toBe(bad);
    expect(run(fix, ["*.json"], env).status).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(fixed);
    expect(readFileSync(keep, "utf8")).toBe(fixed);
    expect(readFileSync(untracked, "utf8")).toBe(bad);
    expect(readFileSync(join(repo, "excluded/other.json"), "utf8")).toBe(
      "invalid JSON\n",
    );
    expect(readFileSync(join(repo, "build/bad.json"), "utf8")).toBe(
      "invalid JSON\n",
    );
    expect(readFileSync(join(repo, "root-only.json"), "utf8")).toBe(
      "invalid JSON\n",
    );
    expect(readFileSync(external, "utf8")).toBe(bad);
    rmSync(untracked);
    expect(run(check, ["*.json"], env).status).toBe(0);

    const native = JSON.parse(readFileSync(config, "utf8"));
    writeFileSync(config, JSON.stringify({ ...native, printWidth: 60 }));
    expect(run(check, ["*.md"], env).status).not.toBe(0);
    expect(readFileSync(markdown, "utf8")).toBe(prose);
    expect(run(fix, ["*.md"], env).status).toBe(0);
    expect(
      readFileSync(markdown, "utf8").trimEnd().split("\n").length,
    ).toBeGreaterThan(1);
    expect(
      readFileSync(markdown, "utf8")
        .trimEnd()
        .split("\n")
        .every((line) => line.length <= 60),
    ).toBe(true);
    expect(run(check, ["*.md"], env).status).toBe(0);

    const unknown = join(repo, "source.unknown");
    writeFileSync(unknown, "unsupported\n");
    const unsupported = run(check, ["*.unknown"], env);
    expect(unsupported.status).not.toBe(0);
    expect(unsupported.output).toContain("No parser could be inferred");
    expect(readFileSync(unknown, "utf8")).toBe("unsupported\n");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
