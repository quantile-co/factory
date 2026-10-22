import { spawnSync } from "node:child_process";
import {
  copyFileSync,
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
import { expect, it } from "vitest";

it("checks Go lint without mutation and scopes fixes to tracked sources", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-go-"));
  const repo = join(work, "repo");
  const module = join(repo, "module with spaces");
  const source = join(module, "value with spaces.go");
  const external = join(work, "external.go");
  const good =
    "// Package example supplies a fixture.\npackage example\n\n// Value returns a fixture value.\nfunc Value() int { return 3 }\n";
  const badlyFormatted = good.replace(
    "func Value() int { return 3 }",
    "func Value()int{return 3}",
  );
  try {
    mkdirSync(module, { recursive: true });
    mkdirSync(join(module, "nested"));
    copyFileSync(
      new URL("../../etc/golangci-lint/.golangci.yml", import.meta.url),
      join(repo, ".golangci.yml"),
    );
    writeFileSync(
      join(module, "go.mod"),
      "module example.invalid/fixture\n\ngo 1.26.0\n",
    );
    writeFileSync(source, good);
    writeFileSync(
      join(module, "nested/go.mod"),
      "module example.invalid/nested\n\ngo 1.26.0\n",
    );
    writeFileSync(join(module, "nested/nested.go"), badlyFormatted);
    writeFileSync(external, badlyFormatted);
    symlinkSync(external, join(module, "linked.go"));
    const env = {
      ...process.env,
      HOME: work,
      GOPROXY: "off",
      GOSUMDB: "off",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const exec = (command: string, args: string[], extraEnv = {}) => {
      const result = spawnSync(command, args, {
        cwd: repo,
        env: { ...env, ...extraEnv },
        encoding: "utf8",
        timeout: 90_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(
      exec("git", ["init", "--quiet", "--initial-branch=main"]).status,
    ).toBe(0);
    expect(exec("git", ["add", "."]).status).toBe(0);
    const build = (selector: string, override = "") => {
      const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      in (pkgs.lib.evalModules {
        modules = [ f.nixModules.golangci-lint ${override} ];
        specialArgs = { inherit pkgs; };
      }).config.quantile-co.factory.golangci-lint.${selector}.package`;
      const result = spawnSync(
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
        { encoding: "utf8", timeout: 150_000 },
      );
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim().split("\n")[0];
    };
    const check = join(build("check"), "bin/check-golangci-lint");
    const fix = join(build("fix"), "bin/fix-golangci-lint");
    const roots = ["module with spaces"];
    expect(exec(check, roots).status).toBe(0);
    writeFileSync(source, badlyFormatted);
    const unformattedCheck = exec(check, roots);
    expect(unformattedCheck.status, unformattedCheck.output).toBe(0);
    expect(readFileSync(source, "utf8")).toBe(badlyFormatted);
    writeFileSync(
      join(module, "untracked.go"),
      "package example\nfunc Other()int{return 4}\n",
    );
    expect(exec(fix, roots).status).toBe(0);
    expect(readFileSync(source, "utf8")).toBe(badlyFormatted);
    expect(readFileSync(join(module, "nested/nested.go"), "utf8")).toBe(
      badlyFormatted,
    );
    expect(readFileSync(external, "utf8")).toBe(badlyFormatted);
    expect(readFileSync(join(module, "untracked.go"), "utf8")).toContain(
      "Other()int",
    );
    expect(existsSync(join(module, "go.sum"))).toBe(false);
    rmSync(join(module, "untracked.go"));

    writeFileSync(
      source,
      good.replace("// Value returns", "// FIXME: revisit\n// Value returns"),
    );
    expect(exec(check, roots).output).toContain("godox");
    const config = join(repo, ".golangci.yml");
    writeFileSync(
      config,
      readFileSync(config, "utf8").replace("    - godox\n", ""),
    );
    expect(exec(check, roots).status).toBe(0);

    const fakeLint =
      '{ quantile-co.factory.golangci-lint.package = pkgs.writeShellScriptBin "golangci-lint" "printf changed > go.sum"; }';
    const guardedFix = join(build("fix", fakeLint), "bin/fix-golangci-lint");
    writeFileSync(source, badlyFormatted);
    const blocked = exec(guardedFix, roots);
    expect(blocked.status).not.toBe(0);
    expect(blocked.output).toContain("would change module/workspace metadata");
    expect(readFileSync(source, "utf8")).toBe(badlyFormatted);
    expect(existsSync(join(module, "go.sum"))).toBe(false);

    writeFileSync(source, good);
    writeFileSync(
      join(repo, "go.work"),
      'go 1.26.0\n\nuse "./module with spaces"\n',
    );
    expect(exec(check, roots, { GO_WORK_FILE: "go.work" }).status).toBe(0);
    writeFileSync(join(repo, "go.work"), 'go 1.26.0\n\nuse "../outside"\n');
    const escaped = exec(check, roots, { GO_WORK_FILE: "go.work" });
    expect(escaped.status).not.toBe(0);
    expect(escaped.output).toContain(
      "Go local module paths must stay inside the checkout",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 240_000);
