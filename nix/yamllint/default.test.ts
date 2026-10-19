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

it("checks YAML with native policy, Git selection, and read-only duplicate-key rejection", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-yamllint-"));
  const outside = mkdtempSync(join(tmpdir(), "factory-yamllint-outside-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules { modules = [ f.nixModules.yamllint ]; specialArgs = { inherit pkgs; }; }).config.quantile.yamllint.check.package`;
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
    const check = join(built.stdout.trim(), "bin/check-yamllint");
    const run = (args: string[] = [], env = process.env) => {
      const result = spawnSync(check, args, {
        cwd: work,
        env,
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(spawnSync("git", ["init", "-q"], { cwd: work }).status).toBe(0);
    const config = join(work, ".yamllint.yaml");
    copyFileSync(
      new URL("../../etc/yamllint/.yamllint.yaml", import.meta.url),
      config,
    );
    const baseline = readFileSync(config, "utf8");
    mkdirSync(join(work, "files"));
    const source = join(work, "files/settings with spaces.yaml");
    writeFileSync(source, "enabled: true\n");
    expect(
      spawnSync("git", ["add", "files/settings with spaces.yaml"], {
        cwd: work,
      }).status,
    ).toBe(0);
    expect(run(["files/*.yaml"]).status).toBe(0);
    const invalid = "enabled: true\nenabled: false\n";
    const draft = join(work, "files/draft.yml");
    writeFileSync(draft, invalid);
    const rejected = run(["files/*.yml"]);
    expect(rejected.status).not.toBe(0);
    expect(rejected.output).toContain("key-duplicates");
    expect(readFileSync(draft, "utf8")).toBe(invalid);
    rmSync(draft);
    writeFileSync(
      config,
      baseline.replace(
        "document-start: disable",
        "document-start:\n    present: true",
      ),
    );
    const strict = run(["files/*.yaml"]);
    expect(strict.status).toBe(0);
    expect(strict.output).toContain("document-start");
    writeFileSync(config, baseline);
    mkdirSync(join(work, "etc/vale/styles/Google"), { recursive: true });
    writeFileSync(join(work, "etc/vale/styles/Google/invalid.yml"), invalid);
    writeFileSync(join(work, ".gitignore"), "files/ignored.yml\n");
    writeFileSync(join(work, "files/ignored.yml"), invalid);
    const external = join(outside, "external.yml");
    writeFileSync(external, invalid);
    symlinkSync(external, join(work, "files/linked.yml"));
    expect(run().status).toBe(0);
    expect(run([":(bad)"]).status).not.toBe(0);
    rmSync(config);
    const missing = run();
    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain("requires consumer-native .yamllint.yaml");
    const custom = join(work, "custom.yaml");
    writeFileSync(custom, baseline);
    expect(
      run(["files/*.yaml"], {
        ...process.env,
        YAMLLINT_CONFIG_FILE: "custom.yaml",
      }).status,
    ).toBe(0);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}, 180_000);
