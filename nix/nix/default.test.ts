import { spawnSync } from "node:child_process";
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
import { expect, it } from "vitest";

it("checks Git-selected Nix source without mutation and formats only tracked regular files on request", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-nix-"));
  const repo = join(work, "repo");
  try {
    mkdirSync(join(repo, "source with spaces"), { recursive: true });
    const target = join(repo, "source with spaces/value.nix");
    const good = "{ answer = 42; }\n";
    const bad = "{answer=42;}\n";
    writeFileSync(target, good);
    const external = join(work, "external.nix");
    writeFileSync(external, bad);
    symlinkSync(external, join(repo, "source with spaces/linked.nix"));
    const run = (command: string, args: string[] = []) => {
      const result = spawnSync(command, args, {
        cwd: repo,
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(
      run("git", ["init", "--quiet", "--initial-branch=main"]).status,
    ).toBe(0);
    expect(run("git", ["add", "."]).status).toBe(0);
    const build = (selector: string) => {
      const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      in (pkgs.lib.evalModules {
        modules = [ f.nixModules.nix ]; specialArgs = { inherit pkgs; };
      }).config.quantile.nix.${selector}.package`;
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
        { encoding: "utf8", timeout: 120_000 },
      );
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim().split("\n")[0];
    };
    const format = join(build("check.format"), "bin/check-nixfmt");
    const deadnix = join(build("check.deadnix"), "bin/check-deadnix");
    const statix = join(build("check.statix"), "bin/check-statix");
    const fix = join(build("fix"), "bin/fix-nixfmt");
    expect(run(format).status).toBe(0);
    expect(run(deadnix).status).toBe(0);
    expect(run(statix).status).toBe(0);
    expect(existsSync(join(repo, ".git/hooks/pre-push"))).toBe(false);

    writeFileSync(target, bad);
    const untracked = join(repo, "source with spaces/untracked.nix");
    writeFileSync(untracked, bad);
    const scope = ["source with spaces/*.nix"];
    const invalid = run(format, scope);
    expect(invalid.status).not.toBe(0);
    expect(invalid.output).toContain("not formatted");
    expect(readFileSync(target, "utf8")).toBe(bad);
    expect(readFileSync(untracked, "utf8")).toBe(bad);
    expect(run(fix, scope).status).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(good);
    expect(readFileSync(untracked, "utf8")).toBe(bad);
    expect(readFileSync(external, "utf8")).toBe(bad);
    rmSync(untracked);

    const unused = join(repo, "source with spaces/unused.nix");
    writeFileSync(unused, "let\n  unused = 1;\nin\n{ }\n");
    const dead = run(deadnix, ["source with spaces/unused.nix"]);
    expect(dead.status).not.toBe(0);
    expect(dead.output).toContain("Unused let binding");
    expect(readFileSync(unused, "utf8")).toContain("unused = 1");
    rmSync(unused);

    const pattern = join(repo, "source with spaces/pattern.nix");
    writeFileSync(pattern, "{ }: { }\n");
    const lint = run(statix, ["source with spaces/pattern.nix"]);
    expect(lint.status).not.toBe(0);
    expect(lint.output).toContain("empty pattern");
    expect(readFileSync(pattern, "utf8")).toBe("{ }: { }\n");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
