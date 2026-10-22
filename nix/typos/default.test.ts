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

it("checks scoped tracked and untracked prose using native vocabulary and exclusions without editing files", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-typos-"));
  const outside = mkdtempSync(join(tmpdir(), "factory-typos-outside-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules { modules = [ f.nixModules.typos ]; specialArgs = { inherit pkgs; }; }).config.quantile-co.factory.typos.check.package`;
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
    const check = join(built.stdout.trim(), "bin/check-typos");
    const run = (args: string[] = []) => {
      const result = spawnSync(check, args, {
        cwd: work,
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(spawnSync("git", ["init", "-q"], { cwd: work }).status).toBe(0);
    const config = join(work, "typos.toml");
    copyFileSync(
      new URL("../../etc/typos/typos.toml", import.meta.url),
      config,
    );
    const baseline = readFileSync(config, "utf8");
    mkdirSync(join(work, "files"));
    const accepted = join(work, "files/prose with spaces.txt");
    writeFileSync(accepted, "A valid configuration stays unchanged.\n");
    const add = spawnSync("git", ["add", "files/prose with spaces.txt"], {
      cwd: work,
    });
    expect(add.status).toBe(0);
    const typo = "configura" + "ton";
    const misspelled = `A misspelled ${typo} must fail.\n`;
    const target = join(work, "files/failing file.txt");
    writeFileSync(target, misspelled);
    const rejected = run(["files/*.txt"]);
    expect(rejected.status).not.toBe(0);
    expect(rejected.output).toContain("configuration");
    expect(readFileSync(target, "utf8")).toBe(misspelled);
    expect(run([":(bad)"]).status).not.toBe(0);
    writeFileSync(
      config,
      `${baseline}\n[default.extend-words]\n${typo} = "${typo}"\n`,
    );
    expect(run(["files/*.txt"]).status).toBe(0);
    writeFileSync(
      config,
      baseline.replace(
        '  "package-lock.json",',
        '  "package-lock.json",\n  "files/failing file.txt",',
      ),
    );
    expect(run(["files/*.txt"]).status).toBe(0);
    mkdirSync(join(work, "ignored"));
    writeFileSync(join(work, ".gitignore"), "ignored/\n");
    writeFileSync(join(work, "ignored/not-checked.txt"), misspelled);
    for (const styles of [".vale/Google", "etc/vale/styles/Google"]) {
      mkdirSync(join(work, styles), { recursive: true });
      writeFileSync(join(work, styles, "upstream.txt"), misspelled);
    }
    expect(run().status).toBe(0);
    mkdirSync(join(work, ".hidden"));
    const hidden = join(work, ".hidden/prose.txt");
    writeFileSync(hidden, misspelled);
    const hiddenCheck = run();
    expect(hiddenCheck.status).not.toBe(0);
    expect(hiddenCheck.output).toContain(".hidden/prose.txt");
    rmSync(hidden);
    const external = join(outside, "external.txt");
    writeFileSync(external, misspelled);
    symlinkSync(external, join(work, "files/linked.txt"));
    expect(run().status).toBe(0);
    expect(readFileSync(external, "utf8")).toBe(misspelled);
    rmSync(config);
    expect(run().output).toContain("requires consumer-native typos.toml");
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}, 180_000);
