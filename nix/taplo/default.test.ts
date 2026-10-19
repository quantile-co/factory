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
import { expect, it } from "vitest";

it("validates and formats consumer TOML with native policy and an explicit tracked-only fix", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-taplo-"));
  const outside = mkdtempSync(join(tmpdir(), "factory-taplo-outside-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      cfg = (pkgs.lib.evalModules { modules = [ f.nixModules.taplo ]; specialArgs = { inherit pkgs; }; }).config.quantile.taplo;
    in [ cfg.check.package cfg.format.package cfg.fix.package ]`;
    const built = spawnSync(
      "nix",
      ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
      {
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    if (built.error) throw built.error;
    expect(built.status, built.stderr).toBe(0);
    const paths = built.stdout.trim().split("\n");
    const exe = (name: string) =>
      join(
        paths.find((path) => path.endsWith(`-${name}`)) ?? "",
        `bin/${name}`,
      );
    const run = (
      bin: string,
      args: string[] = [],
      env: NodeJS.ProcessEnv = {},
    ) => {
      const result = spawnSync(bin, args, {
        cwd: work,
        env: { ...process.env, ...env },
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(run("git", ["init", "-q"]).status).toBe(0);
    mkdirSync(join(work, "source with spaces"));
    mkdirSync(join(work, "excluded"));
    const config = join(work, "taplo.toml");
    copyFileSync(
      new URL("../../etc/taplo/taplo.toml", import.meta.url),
      config,
    );
    const baseline = readFileSync(config, "utf8");
    const configured = `exclude = ["excluded/*.toml"]\n${baseline}`;
    writeFileSync(config, configured);
    const target = join(work, "source with spaces/settings.toml");
    const formatted = "alpha = 1\nbeta  = 2\n";
    const unformatted = "beta=2\nalpha=1\n";
    writeFileSync(target, formatted);
    writeFileSync(join(work, "excluded/settings.toml"), "alpha = [\n");
    const untracked = join(work, "untracked.toml");
    writeFileSync(untracked, unformatted);
    const external = join(outside, "external.toml");
    writeFileSync(external, unformatted);
    symlinkSync(external, join(work, "linked.toml"));
    expect(
      run("git", [
        "add",
        "source with spaces/settings.toml",
        "excluded/settings.toml",
        "linked.toml",
      ]).status,
    ).toBe(0);
    const check = exe("check-taplo");
    const format = exe("check-taplo-format");
    const fix = exe("fix-taplo");
    expect(run(check).status).toBe(0);
    expect(run(format).status).toBe(0);
    writeFileSync(target, "alpha = [\n");
    expect(run(check).status).not.toBe(0);
    expect(readFileSync(target, "utf8")).toBe("alpha = [\n");
    writeFileSync(target, unformatted);
    expect(run(check).status).toBe(0);
    expect(run(format).status).not.toBe(0);
    expect(readFileSync(target, "utf8")).toBe(unformatted);
    expect(run(fix).status).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(formatted);
    expect(readFileSync(untracked, "utf8")).toBe(unformatted);
    expect(readFileSync(external, "utf8")).toBe(unformatted);
    expect(readFileSync(join(work, "excluded/settings.toml"), "utf8")).toBe(
      "alpha = [\n",
    );
    expect(run(format).status).toBe(0);
    writeFileSync(
      config,
      configured
        .replace(/reorder_keys\s*= true/, "reorder_keys = false")
        .replace(/align_entries\s*= true/, "align_entries = false"),
    );
    writeFileSync(target, "beta = 2\nalpha = 1\n");
    const overridden = run(format);
    expect(overridden.status, overridden.output).toBe(0);
    writeFileSync(
      config,
      configured +
        `\n[schema]\nenabled = true\npath = "file://${join(work, "missing-schema.json")}"\n`,
    );
    const missing = run(check);
    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain("missing-schema.json");
    rmSync(config);
    expect(run(check).output).toContain("requires consumer-native taplo.toml");
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}, 180_000);
