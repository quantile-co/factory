import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("runs strict JSON checks from one consumer-owned Prek config without installing hooks", () => {
  const root = new URL("../../", import.meta.url);
  const repo = mkdtempSync(join(tmpdir(), "factory-json-"));
  try {
    const build = (selector: string) => {
      const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      in (pkgs.lib.evalModules {
        modules = [ f.nixModules.json ];
        specialArgs = { inherit pkgs; };
      }).config.quantile.json.${selector}.package`;
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
    const run = (command: string, args: string[] = [], input?: string) => {
      const result = spawnSync(command, args, {
        cwd: repo,
        input,
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.error) throw result.error;
      return {
        status: result.status,
        output: result.stdout + result.stderr,
        stdout: result.stdout,
      };
    };
    const source = join(repo, "source with spaces/settings.json");
    const config = join(repo, ".pre-commit-config.yaml");
    mkdirSync(join(repo, "source with spaces"));
    copyFileSync(
      new URL("../../etc/git/.pre-commit-config.yaml", import.meta.url),
      config,
    );
    writeFileSync(source, '{"enabled": true}\n');
    writeFileSync(
      join(repo, "tsconfig.json"),
      '{\n  // JSONC, deliberately excluded\n  "compilerOptions": {}\n}\n',
    );
    expect(
      run("git", ["init", "--quiet", "--initial-branch=main"]).status,
    ).toBe(0);
    expect(run("git", ["add", "."]).status).toBe(0);
    const jq = join(build("jq"), "bin/jq");
    const parsed = run(
      jq,
      ["-er", ".plan.storage"],
      '{"plan":{"storage":"gcs"}}',
    );
    expect(parsed.status, parsed.output).toBe(0);
    expect(parsed.stdout.trim()).toBe("gcs");
    const check = join(build("check"), "bin/check-json");
    expect(run(check).status).toBe(0);
    expect(existsSync(join(repo, ".git/hooks/pre-push"))).toBe(false);

    for (const [text, diagnostic] of [
      ['{"enabled": true,}\n', "Failed to json decode"],
      ['{"enabled": true, "enabled": false}\n', "Duplicate key"],
      ["{}\n{}\n", "Extra data"],
    ]) {
      writeFileSync(source, text);
      const rejected = run(check);
      expect(rejected.status).not.toBe(0);
      expect(rejected.output).toContain(diagnostic);
      expect(readFileSync(source, "utf8")).toBe(text);
    }
    writeFileSync(source, '{"enabled": true}\n');
    writeFileSync(
      config,
      readFileSync(config, "utf8").replace("tsconfig\\.json$", "^$"),
    );
    const strict = run(check);
    expect(strict.status).not.toBe(0);
    expect(strict.output).toContain("tsconfig.json: Failed to json decode");
    expect(existsSync(join(repo, ".git/hooks/pre-push"))).toBe(false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}, 150_000);
