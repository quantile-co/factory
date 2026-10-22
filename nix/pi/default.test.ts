import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DefaultResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";

it("exposes readable native Pi settings and shared skills to a consumer", () => {
  const root = new URL("../../", import.meta.url);
  const evaluated = spawnSync(
    "nix",
    [
      "--extra-experimental-features",
      "nix-command flakes",
      "eval",
      "--raw",
      "--impure",
      "--expr",
      `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
  pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  cfg = (pkgs.lib.evalModules { modules = [ f.nixModules.pi ]; specialArgs = { inherit pkgs; }; }).config;
in builtins.toJSON {
  settings = builtins.readFile cfg.quantile-co.factory.pi.settingsFile;
  skills = {
    deploy = builtins.readFile (cfg.quantile-co.factory.pi.skillsDir + "/deploy/SKILL.md");
    day-zero-deploy = builtins.readFile (cfg.quantile-co.factory.pi.skillsDir + "/day-zero-deploy/SKILL.md");
    marimo-pair = builtins.readFile (cfg.quantile-co.factory.pi.skillsDir + "/marimo-pair/SKILL.md");
    nvim-pair = builtins.readFile (cfg.quantile-co.factory.pi.skillsDir + "/nvim-pair/SKILL.md");
    seo-audit = builtins.readFile (cfg.quantile-co.factory.pi.skillsDir + "/seo-audit/SKILL.md");
    web-design-guidelines = builtins.readFile (cfg.quantile-co.factory.pi.skillsDir + "/web-design-guidelines/SKILL.md");
    web-perf = builtins.readFile (cfg.quantile-co.factory.pi.skillsDir + "/web-perf/SKILL.md");
    web-quality-audit = builtins.readFile (cfg.quantile-co.factory.pi.skillsDir + "/web-quality-audit/SKILL.md");
    webapp-testing = builtins.readFile (cfg.quantile-co.factory.pi.skillsDir + "/webapp-testing/SKILL.md");
  };
}`,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (evaluated.error) throw evaluated.error;
  expect(evaluated.status, evaluated.stderr).toBe(0);
  const resolved = JSON.parse(evaluated.stdout);
  const settings = JSON.parse(resolved.settings);
  expect(settings).toEqual(
    JSON.parse(
      readFileSync(
        new URL("../../etc/pi/settings.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  expect(settings.packages).toContain("npm:pi-web-access@0.42.0");
  expect(settings.packages).toContain(
    "npm:@langfuse/pi-observability-plugin@0.1.2",
  );
  expect(settings.skills).toEqual([
    "./skills/deploy",
    "./skills/day-zero-deploy",
  ]);
  for (const name of [
    "deploy",
    "day-zero-deploy",
    "marimo-pair",
    "nvim-pair",
    "seo-audit",
    "web-design-guidelines",
    "web-perf",
    "web-quality-audit",
    "webapp-testing",
  ]) {
    const skill = resolved.skills[name];
    if (["deploy", "day-zero-deploy", "nvim-pair"].includes(name)) {
      expect(skill).toBe(
        readFileSync(
          new URL(`../../etc/pi/skills/${name}/SKILL.md`, import.meta.url),
          "utf8",
        ),
      );
    }
    expect(skill).toContain(`name: ${name}`);
    if (name === "deploy" || name === "day-zero-deploy") {
      expect(skill).toContain("existing");
    }
  }
});

it("loads one Factory entry point and upstream Herdr state with Pi, without shipping tests", async () => {
  const root = new URL("../../", import.meta.url);
  const built = spawnSync(
    "nix",
    [
      "build",
      "--no-link",
      "--print-out-paths",
      "--impure",
      "--expr",
      `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules { modules = [ f.nixModules.pi ]; specialArgs = { inherit pkgs; }; }).config.quantile-co.factory.pi.extensionsDir`,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  expect(built.status, built.stderr).toBe(0);
  const output = built.stdout.trim();
  expect(readdirSync(output).sort()).toEqual([
    "factory",
    "herdr-agent-state.ts",
  ]);
  expect(
    readdirSync(join(output, "factory")).some((name) =>
      name.includes(".test."),
    ),
  ).toBe(false);
  const work = mkdtempSync(join(tmpdir(), "factory-pi-load-"));
  try {
    const loader = new DefaultResourceLoader({
      cwd: work,
      agentDir: join(work, "agent"),
      settingsManager: SettingsManager.inMemory(),
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      additionalExtensionPaths: [
        join(output, "factory"),
        join(output, "herdr-agent-state.ts"),
      ],
    });
    await loader.reload();
    const { extensions, errors } = loader.getExtensions();
    expect(errors).toEqual([]);
    expect(extensions).toHaveLength(2);
    const factory = extensions.find((item) => item.tools.has("herdr_worktree"));
    expect(factory?.tools.has("foreground_terminal")).toBe(true);
    expect(extensions.every((item) => item.commands.size === 0)).toBe(true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 120_000);

it("ships opt-in skill scripts and validates nvim navigation arguments", () => {
  const root = new URL("../../", import.meta.url);
  const built = spawnSync(
    "nix",
    [
      "build",
      "--no-link",
      "--print-out-paths",
      "--impure",
      "--expr",
      `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules {
      modules = [ f.nixModules.pi ]; specialArgs = { inherit pkgs; };
    }).config.quantile-co.factory.pi.skillsDir`,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (built.error) throw built.error;
  expect(built.status, built.stderr).toBe(0);
  const skills = built.stdout.trim();
  const nvim = join(skills, "nvim-pair/scripts/nvctl");
  const marimo = join(skills, "marimo-pair/scripts/discover-servers.sh");
  const execute = join(skills, "marimo-pair/scripts/execute-code.sh");
  expect(
    readFileSync(join(skills, "performance/references/MEASUREMENT.md"), "utf8"),
  ).toContain("measurement");
  for (const script of [nvim, marimo, execute]) {
    const syntax = spawnSync("bash", ["-n", script], { encoding: "utf8" });
    expect(syntax.status, syntax.stderr).toBe(0);
  }
  const work = mkdtempSync(join(tmpdir(), "factory-pi-skills-"));
  try {
    const bin = join(work, "bin");
    mkdirSync(bin);
    const fakeNvim = join(bin, "nvim");
    writeFileSync(
      fakeNvim,
      '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$NVIM_LOG"\n',
    );
    chmodSync(fakeNvim, 0o755);
    const file = join(work, "file with spaces.txt");
    writeFileSync(file, "hello\n");
    const env = {
      ...process.env,
      NVIM_SOCKET: join(work, "socket"),
      NVIM_LOG: join(work, "nvim.log"),
      PATH: `${bin}:${process.env.PATH ?? ""}`,
    };
    const goto = spawnSync("bash", [nvim, "goto", file, "17"], {
      cwd: work,
      env,
      encoding: "utf8",
    });
    expect(goto.status, goto.stderr).toBe(0);
    expect(readFileSync(env.NVIM_LOG, "utf8")).toContain(
      `--remote-tab ${file}`,
    );
    expect(readFileSync(env.NVIM_LOG, "utf8")).toContain("<Cmd>17<CR>");
    const invalid = spawnSync("bash", [nvim, "goto", file, "17<CR>"], {
      cwd: work,
      env,
      encoding: "utf8",
    });
    expect(invalid.status).not.toBe(0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
