import { spawnSync } from "node:child_process";
import {
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
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("checks without editing and safely fixes consumer files using the store-backed Biome template", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const work = mkdtempSync(join(tmpdir(), "factory-biome-"));
  const env = {
    HOME: join(work, "home"),
    PATH: process.env.PATH,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE,
    NIX_SSL_CERT_FILE: process.env.NIX_SSL_CERT_FILE,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    // Reuse the already-installed tools; this fixture must never reinstall shared dependencies.
    pnpm_config_verify_deps_before_run: "false",
  };
  const run = (command: string, args: string[], success = true) => {
    const result = spawnSync(command, args, {
      cwd: work,
      env,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (result.error) throw result.error;
    if (success) expect(result.status, result.stdout + result.stderr).toBe(0);
    else {
      expect(result.status, result.stdout + result.stderr).not.toBe(0);
      return result.stdout + result.stderr;
    }
    return result.stdout.trim();
  };
  try {
    for (const dir of ["home", "nix", "tf", "etc/biome", "etc/semgrep"]) {
      mkdirSync(join(work, dir), { recursive: true });
    }
    const config = run("nix", [
      "--extra-experimental-features",
      "nix-command flakes",
      "eval",
      "--raw",
      "--impure",
      "--expr",
      `
        let
          factory = builtins.getFlake ${JSON.stringify(`git+${new URL("../../", import.meta.url).href}`)};
          pkgs = factory.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
          config = (pkgs.lib.evalModules {
            modules = [ factory.nixModules.ts ];
            specialArgs = { inherit pkgs; };
          }).config;
        in "\${config.quantile.ts.biome.configFile}"
      `,
    ]);
    expect(config).toMatch(/^\/nix\/store\//);
    symlinkSync(config, join(work, "biome.json"));
    symlinkSync(join(root, "node_modules"), join(work, "node_modules"));
    for (const file of [
      "package.json",
      "tsconfig.json",
      "etc/biome/default.json",
    ]) {
      copyFileSync(join(root, file), join(work, file));
    }
    writeFileSync(join(work, ".gitignore"), "node_modules/\nignored.ts\n");
    run("git", ["init", "--quiet", "--initial-branch=main"]);
    const untouched = [
      "README.md",
      "tf/README.md",
      "ignored.ts",
      "etc/semgrep/fixture.jsonc",
    ];
    for (const file of untouched)
      writeFileSync(join(work, file), "deliberately unformatted fixture\n");
    const source = join(work, "nix", "probe.test.ts");
    const original = "export const answer=42\n";
    writeFileSync(source, original);
    expect(run("pnpm", ["run", "check"], false)).toContain("format");
    expect(readFileSync(source, "utf8")).toBe(original);
    run("pnpm", ["run", "fix"]);
    const fixed = readFileSync(source, "utf8");
    expect(fixed).not.toBe(original);
    run("pnpm", ["run", "check"]);
    run("pnpm", ["run", "fix"]);
    expect(readFileSync(source, "utf8")).toBe(fixed);
    for (const file of untouched) {
      expect(readFileSync(join(work, file), "utf8")).toBe(
        "deliberately unformatted fixture\n",
      );
    }
    // A formatted, type-correct lint violation must still fail the read-only command.
    writeFileSync(source, "export const answer: any = 42;\n");
    expect(run("pnpm", ["run", "check"], false)).toContain("noExplicitAny");
    expect(readFileSync(source, "utf8")).toBe(
      "export const answer: any = 42;\n",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
