import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("loads runtime secrets on fresh shell/task entry and fails closed without serializing values", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-secretspec-"));
  const consumer = join(work, "consumer");
  const home = join(work, "home");
  const factory = `git+${new URL("../../", import.meta.url).href}`;
  const marker = `synthetic-${randomUUID()}`;
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const logs: string[] = [];
  try {
    mkdirSync(consumer);
    mkdirSync(home);
    // Reuse only Nix's download/evaluation cache, never the real HOME or provider configuration.
    const nixCache = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "nix");
    if (existsSync(nixCache)) {
      mkdirSync(join(home, ".cache"));
      symlinkSync(nixCache, join(home, ".cache", "nix"));
    }
    const env = {
      HOME: home, PATH: process.env.PATH, TMPDIR: work,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE, NIX_SSL_CERT_FILE: process.env.NIX_SSL_CERT_FILE,
      NIX_CONFIG: "experimental-features = nix-command flakes",
      GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
    };
    const run = (command: string, args: string[], extra: Record<string, string> = {}, success = true) => {
      const result = spawnSync(command, args, {
        cwd: consumer, env: { ...env, ...extra }, encoding: "utf8", timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (result.error) throw result.error;
      logs.push(result.stdout, result.stderr);
      if (success) expect(result.status, `${command}:\n${result.stdout}\n${result.stderr}`).toBe(0);
      else expect(result.status).not.toBe(0);
      return result.stdout;
    };
    const cli = join(run("nix", ["build", `${factory}#devenv-cli`, "--no-link", "--print-out-paths"]).trim(), "bin", "devenv");
    writeFileSync(join(consumer, "devenv.yaml"), `
inputs:
  factory:
    url: ${factory}
    flake: true
  nixpkgs:
    follows: factory/nixpkgs
  devenv:
    follows: factory/devenv
secretspec:
  enable: false
`);
    writeFileSync(join(consumer, "devenv.nix"), `
{ config, inputs, lib, ... }:
let
  check = ''
    actual=$(printf '%s' "$APP_SECRET" | sha256sum)
    test "''\${actual%% *}" = "$EXPECTED_DIGEST"
    touch child-ran
  '';
in {
  imports = [ inputs.factory.nixModules.secretspec ];
  cachix.enable = false;
  quantile.secretspec.configFile = ./manifest.toml;
  env.SECRETSPEC_FILE = "\${config.quantile.secretspec.configFile}";
  enterShell = lib.mkMerge [
    (lib.mkOrder 400 "set -x")
    (lib.mkBefore config.quantile.secretspec.shellHook)
    (lib.mkAfter ''
      case $- in *x*) ;; *) exit 19 ;; esac
      set +x
    '')
  ];
  scripts.probe.exec = check;
  tasks."fixture:secret".exec = check;
  tasks."fixture:dependent" = {
    after = [ "fixture:secret" ];
    exec = check + "\\ntouch dependent-ran";
  };
}
`);
    writeFileSync(join(consumer, "manifest.toml"), `
[project]
name = "factory-secret-consumer"
revision = "1.0"
[providers]
# File providers are relative to the manifest, which lives in the Nix store here.
fixture = "dotenv://${work}/provider.env"
[profiles.default]
PLACEHOLDER = { description = "Unused placeholder", required = false, providers = ["env"] }
[profiles.prod]
APP_SECRET = { description = "Synthetic runtime input", required = true, providers = ["fixture"] }
`);
    writeFileSync(join(consumer, ".gitignore"), ".devenv*\nsecretspec.toml\n*-ran\n");
    run("git", ["init", "--quiet", "--initial-branch=main"]);
    run("git", ["add", "devenv.nix", "devenv.yaml", "manifest.toml", ".gitignore"]);
    writeFileSync(join(work, "provider.env"), `APP_SECRET=${marker}\n`, { mode: 0o600 });
    const selected = { SECRETSPEC_PROFILE: "prod", EXPECTED_DIGEST: digest(marker) };
    const child = join(consumer, "child-ran");
    const manifest = join(consumer, "secretspec.toml");

    // Neither shell nor direct tasks need a generated root manifest on first entry.
    for (const args of [["shell", "--", "probe"], ["tasks", "run", "--mode", "before", "fixture:dependent"]]) {
      rmSync(manifest, { force: true });
      rmSync(child, { force: true });
      run(cli, ["--no-tui", ...args], selected);
      expect(existsSync(manifest)).toBe(false);
      expect(existsSync(child)).toBe(true);
    }
    expect(existsSync(join(consumer, "dependent-ran"))).toBe(true);

    const special = `${marker}\n'\"$()\\ spaces`;
    run(cli, ["--no-tui", "tasks", "run", "fixture:secret"], {
      ...selected, SECRETSPEC_PROVIDER: "env", APP_SECRET: special, EXPECTED_DIGEST: digest(special),
    });
    const exported = JSON.parse(run(cli, ["print-dev-env", "--json"], selected));
    const shell = exported.variables.out.value;
    const derivation = run("nix-store", ["--query", "--deriver", shell]).trim();
    expect(readFileSync(shell, "utf8")).not.toContain(marker);
    expect(readFileSync(derivation, "utf8")).not.toContain(marker);

    rmSync(join(work, "provider.env"));
    rmSync(child);
    run(cli, ["--no-tui", "tasks", "run", "fixture:secret"], selected, false);
    expect(existsSync(child)).toBe(false);
    expect(logs.at(-1)).toContain("APP_SECRET");
    // A credential-free default still starts even though the production provider has disappeared.
    run(cli, ["--no-tui", "shell", "--", "true"]);
    for (const log of logs) expect(log).not.toContain(marker);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
