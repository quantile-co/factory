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
            modules = [ factory.nixModules.biome ];
            specialArgs = { inherit pkgs; };
          }).config;
        in "\${config.quantile-co.factory.biome.configFile}"
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
    mkdirSync(join(work, ".pi/skills/external"), { recursive: true });
    writeFileSync(
      join(work, ".pi/skills/external/example.ts"),
      "not typescript\n",
    );
    run("pnpm", [
      "exec",
      "biome",
      "check",
      "--no-errors-on-unmatched",
      ".pi/skills",
    ]);
    const untouched = [
      "README.md",
      "tf/README.md",
      "ignored.ts",
      "etc/semgrep/fixture.jsonc",
    ];
    for (const file of untouched)
      writeFileSync(join(work, file), "deliberately unformatted fixture\n");
    const selected = [
      "nix",
      "tf",
      "package.json",
      "tsconfig.json",
      "etc/biome",
    ];
    const check = (success = true) =>
      run(
        "pnpm",
        ["exec", "biome", "check", "--error-on-warnings", ...selected],
        success,
      );
    const fix = () =>
      run("pnpm", [
        "exec",
        "biome",
        "check",
        "--write",
        "--error-on-warnings",
        ...selected,
      ]);
    const source = join(work, "nix", "probe.test.ts");
    const original = "export const answer=42\n";
    writeFileSync(source, original);
    expect(check(false)).toContain("format");
    expect(readFileSync(source, "utf8")).toBe(original);
    fix();
    const fixed = readFileSync(source, "utf8");
    expect(fixed).not.toBe(original);
    check();
    fix();
    expect(readFileSync(source, "utf8")).toBe(fixed);
    for (const file of untouched) {
      expect(readFileSync(join(work, file), "utf8")).toBe(
        "deliberately unformatted fixture\n",
      );
    }
    // A formatted, type-correct lint violation must still fail the read-only command.
    writeFileSync(source, "export const answer: any = 42;\n");
    expect(check(false)).toContain("noExplicitAny");
    expect(readFileSync(source, "utf8")).toBe(
      "export const answer: any = 42;\n",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);

it("formats a native file for consumer placement without changing its source or import base", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-biome-format-"));
  try {
    const source = join(work, "template.cjs");
    const original = "module.exports=require('./value.cjs')\n";
    writeFileSync(source, original);
    const built = spawnSync(
      "nix",
      [
        "build",
        "--no-link",
        "--print-out-paths",
        "--impure",
        "--expr",
        `let
        f = builtins.getFlake ${JSON.stringify(`git+${new URL("../../", import.meta.url).href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
        cfg = (pkgs.lib.evalModules {
          modules = [ f.nixModules.biome ]; specialArgs = { inherit pkgs; };
        }).config.quantile-co.factory.biome;
      in cfg.formatFile "postcss.config.cjs" (builtins.path { path = ${JSON.stringify(source)}; name = "template.cjs"; })`,
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (built.error) throw built.error;
    expect(built.status, built.stderr).toBe(0);
    const formatted = built.stdout.trim();
    expect(formatted).toMatch(/^\/nix\/store\//);
    expect(readFileSync(source, "utf8")).toBe(original);
    const destination = join(work, "postcss.config.cjs");
    copyFileSync(formatted, destination);
    writeFileSync(
      join(work, "value.cjs"),
      "module.exports = { answer: 42 };\n",
    );
    const loaded = spawnSync(
      process.execPath,
      ["-p", "require(process.argv[1]).answer", destination],
      { encoding: "utf8", timeout: 10_000 },
    );
    expect(loaded.status, loaded.stderr).toBe(0);
    expect(loaded.stdout.trim()).toBe("42");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
