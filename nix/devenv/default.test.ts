import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("refreshes managed directory links through Devenv without touching unowned paths", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-devenv-files-"));
  const consumer = join(work, "consumer");
  const home = join(work, "home");
  const factory = `git+${new URL("../../", import.meta.url).href}`;
  try {
    mkdirSync(consumer);
    mkdirSync(home);
    // Share download metadata, not user configuration or credentials.
    const nixCache = join(
      process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
      "nix",
    );
    if (existsSync(nixCache)) {
      mkdirSync(join(home, ".cache"));
      symlinkSync(nixCache, join(home, ".cache/nix"));
    }
    const env = {
      HOME: home,
      PATH: process.env.PATH,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE,
      NIX_SSL_CERT_FILE: process.env.NIX_SSL_CERT_FILE,
      NIX_CONFIG: "experimental-features = nix-command flakes",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    };
    const run = (command: string, args: string[], success = true) => {
      const result = spawnSync(command, args, {
        cwd: consumer,
        env,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (result.error) throw result.error;
      const output = result.stdout + result.stderr;
      if (success) expect(result.status, output).toBe(0);
      else expect(result.status, output).not.toBe(0);
      return { stdout: result.stdout, output };
    };
    const cli = join(
      run("nix", [
        "build",
        `${factory}#devenv-cli`,
        "--no-link",
        "--print-out-paths",
      ]).stdout.trim(),
      "bin/devenv",
    );
    writeFileSync(
      join(consumer, "devenv.yaml"),
      `
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
`,
    );
    const configuration = (enabled: boolean, declarations = true) => `
{ inputs, ... }: {
  imports = ${enabled ? "[ inputs.factory.devenvModules.files ]" : "[ ]"};
  cachix.enable = false;
  ${
    declarations
      ? `
  files.linked-rules.source = ./rules;
  files.other-link.source = ./other;
  files.regular.source = ./rules/example.txt;
  files.copied = { source = ./rules; copyMode = "copy"; };
  files.seeded = { source = ./rules; copyMode = "seed"; };
  `
      : ""
  }
}
`;
    const config = join(consumer, "devenv.nix");
    writeFileSync(config, configuration(false));
    for (const name of ["rules", "other"]) {
      mkdirSync(join(consumer, name));
      writeFileSync(join(consumer, name, "example.txt"), "original\n");
    }
    writeFileSync(
      join(consumer, ".gitignore"),
      ".devenv*\n/linked-rules\n/other-link\n/regular\n/copied\n/seeded\n",
    );
    run("git", ["init", "--quiet"]);
    run("git", [
      "add",
      "devenv.nix",
      "devenv.yaml",
      ".gitignore",
      "rules",
      "other",
    ]);
    const activate = (success = true) =>
      run(
        cli,
        ["--no-tui", "tasks", "run", "--show-output", "devenv:files"],
        success,
      );
    activate();
    const link = join(consumer, "linked-rules");
    const otherLink = join(consumer, "other-link");
    const old = readlinkSync(link);
    const oldOther = readlinkSync(otherLink);
    writeFileSync(join(consumer, "rules/example.txt"), "updated\n");
    writeFileSync(join(consumer, "other/example.txt"), "also updated\n");
    writeFileSync(join(consumer, "seeded/example.txt"), "local edit\n");
    // Negative control: the actual unmodified Devenv writer cannot update this layout.
    expect(activate(false).output).toContain("Permission denied");
    expect(readlinkSync(link)).toBe(old);
    writeFileSync(config, configuration(true));
    activate();
    expect(readlinkSync(link)).not.toBe(old);
    expect(readlinkSync(otherLink)).not.toBe(oldOther);
    expect(readFileSync(join(link, "example.txt"), "utf8")).toBe("updated\n");
    expect(lstatSync(join(link, "example.txt")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(old, "example.txt"), "utf8")).toBe("original\n");
    expect(readFileSync(join(consumer, "regular"), "utf8")).toBe("updated\n");
    expect(readFileSync(join(consumer, "copied/example.txt"), "utf8")).toBe(
      "updated\n",
    );
    expect(readFileSync(join(consumer, "seeded/example.txt"), "utf8")).toBe(
      "local edit\n",
    );
    const target = readlinkSync(link);
    const inode = lstatSync(link).ino;
    activate();
    expect(lstatSync(link).ino).toBe(inode);

    // A store link alone is insufficient proof of ownership.
    rmSync(link);
    symlinkSync(old, link);
    const state = join(consumer, ".devenv/state/files.json");
    const savedState = readFileSync(state, "utf8");
    const parsed = JSON.parse(savedState);
    parsed.managedFiles = parsed.managedFiles.filter(
      (name: string) => name !== "linked-rules",
    );
    writeFileSync(state, JSON.stringify(parsed));
    expect(activate(false).output).toContain("not recorded as Devenv-managed");
    expect(readlinkSync(link)).toBe(old);
    writeFileSync(state, savedState);

    // Even a recorded path must not authorize unlinking an external directory link.
    const foreign = join(work, "foreign");
    mkdirSync(foreign);
    writeFileSync(join(foreign, "keep"), "untouched");
    rmSync(link);
    symlinkSync(foreign, link);
    expect(activate(false).output).toContain(
      "Refusing to replace unmanaged link",
    );
    expect(readlinkSync(link)).toBe(foreign);
    expect(readFileSync(join(foreign, "keep"), "utf8")).toBe("untouched");
    rmSync(link);
    symlinkSync(target, link);

    // Removal still belongs to Devenv's cleanup, and an empty files map adds no dependency.
    writeFileSync(config, configuration(true, false));
    run(cli, ["--no-tui", "shell", "--", "true"]);
    expect(existsSync(link)).toBe(false);
    expect(existsSync(otherLink)).toBe(false);
    expect(existsSync(join(foreign, "keep"))).toBe(true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 240_000);

it("checks a consumer's nested Factory pins without accepting lock drift", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-consumer-locks-"));
  try {
    const factory = `git+${new URL("../../", import.meta.url).href}`;
    const build = spawnSync(
      "nix",
      [
        "build",
        `${factory}#check-devenv-locks`,
        "--no-link",
        "--print-out-paths",
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (build.error) throw build.error;
    expect(build.status, build.stderr).toBe(0);
    const command = join(build.stdout.trim(), "bin/check-devenv-locks");
    const pin = {
      original: { type: "github", repo: "devenv" },
      locked: { rev: "reviewed" },
    };
    const flake = {
      nodes: {
        root: { inputs: { factory: "factory" } },
        factory: { inputs: { devenv: "devenv" } },
        devenv: pin,
      },
    };
    const devenv = {
      nodes: {
        root: { inputs: { factory: "factory" } },
        factory: { inputs: { devenv: "devenv" } },
        devenv: pin,
      },
    };
    const flakePath = join(work, "flake.lock");
    const devenvPath = join(work, "devenv.lock");
    writeFileSync(flakePath, JSON.stringify(flake));
    writeFileSync(devenvPath, JSON.stringify(devenv));
    const check = (ci = "false", mode = "--ci", defaults = false) =>
      spawnSync(
        command,
        defaults
          ? []
          : [
              mode,
              "--flake-input",
              "factory",
              "flake.lock",
              "devenv.lock",
              "factory",
            ],
        {
          cwd: work,
          env: { ...process.env, CI: ci },
          encoding: "utf8",
          timeout: 30_000,
        },
      );
    expect(check().status).toBe(0);
    expect(check("false", "--ci", true).status).toBe(0);
    const followed = JSON.parse(JSON.stringify(devenv));
    followed.nodes.root.inputs = {
      dns: "dns",
      factory: ["dns", "factory"],
    };
    followed.nodes.dns = { inputs: { factory: "factory" } };
    writeFileSync(devenvPath, JSON.stringify(followed));
    expect(check().status).toBe(0);
    followed.nodes.devenv.locked.rev = "unreviewed";
    writeFileSync(devenvPath, JSON.stringify(followed));
    expect(check().status).not.toBe(0);
    devenv.nodes.devenv = { ...pin, locked: { rev: "other" } };
    writeFileSync(devenvPath, JSON.stringify(devenv));
    expect(check().status).not.toBe(0);

    // A working-copy repair must not hide a bad indexed pin in CI.
    expect(spawnSync("git", ["init", "-q"], { cwd: work }).status).toBe(0);
    expect(
      spawnSync("git", ["add", "flake.lock", "devenv.lock"], { cwd: work })
        .status,
    ).toBe(0);
    devenv.nodes.devenv = pin;
    writeFileSync(devenvPath, JSON.stringify(devenv));
    expect(check().status).toBe(0);
    expect(check("true").status).not.toBe(0);
    expect(check("true", "--ci", true).status).not.toBe(0);
    expect(check("false", "--git-index").status).not.toBe(0);
    expect(spawnSync("git", ["add", "devenv.lock"], { cwd: work }).status).toBe(
      0,
    );
    const aligned = check("true");
    expect(aligned.status, aligned.stdout + aligned.stderr).toBe(0);
    expect(check("true", "--ci", true).status).toBe(0);
    devenv.nodes.devenv = { ...pin, locked: { rev: "unstaged-drift" } };
    writeFileSync(devenvPath, JSON.stringify(devenv));
    expect(check("true").status).not.toBe(0);
    expect(check("true", "--ci", true).status).not.toBe(0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
