import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("scans history and Git-selected working files, rejecting shallow history", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-gitleaks-"));
  const run = (bin: string, args: string[]) => {
    const result = spawnSync(bin, args, {
      cwd: work,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (result.error) throw result.error;
    return result;
  };
  try {
    writeFileSync(join(work, "file.txt"), "public fixture\n");
    expect(run("git", ["init", "-q"]).status).toBe(0);
    expect(run("git", ["add", "file.txt"]).status).toBe(0);
    writeFileSync(join(work, ".git/shallow"), `${"0".repeat(40)}\n`);
    const root = new URL("../../", import.meta.url);
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules {
      modules = [ f.nixModules.gitleaks ]; specialArgs = { inherit pkgs; };
    }).config.quantile-co.factory.gitleaks.check.package`;
    const built = run("nix", [
      "build",
      "--no-link",
      "--print-out-paths",
      "--impure",
      "--expr",
      expr,
    ]);
    expect(built.status, built.stderr).toBe(0);
    const rejected = run(`${built.stdout.trim()}/bin/check-gitleaks`, []);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stdout + rejected.stderr).toContain(
      "requires an unshallow checkout",
    );
    rmSync(join(work, ".git/shallow"));
    for (const [key, value] of Object.entries({
      "user.name": "Fixture",
      "user.email": "fixture@example.invalid",
      "commit.gpgsign": "false",
      "core.hooksPath": "/dev/null",
    })) {
      expect(run("git", ["config", key, value]).status).toBe(0);
    }
    writeFileSync(join(work, ".gitignore"), "node_modules/\n");
    expect(run("git", ["add", "."]).status).toBe(0);
    expect(run("git", ["commit", "-qm", "clean fixture"]).status).toBe(0);
    const scan = () => run(`${built.stdout.trim()}/bin/check-gitleaks`, []);
    // Synthetic token, never a provider credential.
    const secret = `token = "${"ghp_"}${"aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0iL3oR6"}"\n`;
    mkdirSync(join(work, "node_modules"));
    writeFileSync(join(work, "node_modules", "ignored.txt"), secret);
    symlinkSync("node_modules/ignored.txt", join(work, "generated.txt"));
    expect(scan().status).toBe(0);

    writeFileSync(join(work, "untracked.txt"), secret);
    expect(scan().status).not.toBe(0);
    rmSync(join(work, "untracked.txt"));
    writeFileSync(join(work, "file.txt"), secret);
    expect(scan().status).not.toBe(0);

    expect(run("git", ["add", "file.txt"]).status).toBe(0);
    expect(
      run("git", ["commit", "-qm", "synthetic historical secret"]).status,
    ).toBe(0);
    writeFileSync(join(work, "file.txt"), "public fixture\n");
    expect(run("git", ["add", "file.txt"]).status).toBe(0);
    expect(
      run("git", ["commit", "-qm", "remove synthetic secret"]).status,
    ).toBe(0);
    expect(scan().status).not.toBe(0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
