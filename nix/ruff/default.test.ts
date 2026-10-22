import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
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

it("composes standalone Ruff and mypy tools, checking without writes and fixing only tracked Python source", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-python-"));
  const repo = join(work, "consumer");
  try {
    mkdirSync(join(repo, "source with spaces"), { recursive: true });
    const ruffConfig = join(repo, "ruff.toml");
    const mypyConfig = join(repo, "mypy.ini");
    copyFileSync(
      new URL("../../etc/ruff/ruff.toml", import.meta.url),
      ruffConfig,
    );
    copyFileSync(
      new URL("../../etc/mypy/mypy.ini", import.meta.url),
      mypyConfig,
    );
    const original =
      'def greeting(name: str) -> str:\n    return f"Hello, {name}!"\n';
    const source = join(repo, "source with spaces/example.py");
    writeFileSync(source, original);
    const external = join(work, "external.py");
    writeFileSync(external, "def broken(): return missing_name\n");
    symlinkSync(external, join(repo, "linked.py"));
    const run = (command: string, args: string[] = [], cwd = repo) => {
      const result = spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        timeout: 120_000,
        env: {
          ...process.env,
          HOME: work,
          XDG_CACHE_HOME: join(work, "cache"),
        },
      });
      if (result.error) throw result.error;
      return {
        status: result.status,
        stdout: result.stdout,
        output: result.stdout + result.stderr,
      };
    };
    expect(
      run("git", ["init", "--quiet", "--initial-branch=main"]).status,
    ).toBe(0);
    expect(run("git", ["add", "."]).status).toBe(0);
    const build = (selector: string) => {
      const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      in (pkgs.lib.evalModules {
        modules = [ f.nixModules.ruff f.nixModules.mypy ]; specialArgs = { inherit pkgs; };
      }).config.quantile-co.factory.${selector}.package`;
      const result = run(
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
        work,
      );
      expect(result.status, result.output).toBe(0);
      return result.stdout.trim();
    };
    const lint = join(build("ruff.check"), "bin/check-python-ruff");
    const format = join(build("ruff.format.check"), "bin/check-python-format");
    const types = join(build("mypy.check"), "bin/check-python-mypy");
    const fix = join(build("ruff.fix"), "bin/fix-python");
    for (const check of [lint, format, types]) {
      expect(run(check).status).toBe(0);
    }
    expect(existsSync(join(repo, ".mypy_cache"))).toBe(false);

    for (const [checker, broken, diagnostic] of [
      [
        lint,
        "def greeting(name: str) -> str:\n    return missing_name\n",
        "F821",
      ],
      [
        format,
        "def greeting(name: str) -> str:\n    return f'Hello, {name}!'\n",
        "would be reformatted",
      ],
      [
        types,
        "def greeting(name: str) -> str:\n    return 42\n",
        "[return-value]",
      ],
    ]) {
      writeFileSync(source, broken);
      const finding = run(checker);
      expect(finding.status).not.toBe(0);
      expect(finding.output).toContain(diagnostic);
      expect(readFileSync(source, "utf8")).toBe(broken);
    }
    const ruffDefault = readFileSync(ruffConfig, "utf8");
    const assertion =
      'def greeting(name: str) -> str:\n    assert name\n    return f"Hello, {name}!"\n';
    writeFileSync(source, assertion);
    expect(run(lint).output).toContain("S101");
    writeFileSync(ruffConfig, `${ruffDefault}ignore = ["S101"]\n`);
    expect(run(lint).status).toBe(0);
    writeFileSync(ruffConfig, ruffDefault);

    const mypyDefault = readFileSync(mypyConfig, "utf8");
    const untyped = "def greeting(name):\n    return name\n";
    writeFileSync(source, untyped);
    expect(run(types).status).toBe(0);
    writeFileSync(
      mypyConfig,
      mypyDefault.replace(
        "disallow_untyped_defs = False",
        "disallow_untyped_defs = True",
      ),
    );
    const strict = run(types);
    expect(strict.status).not.toBe(0);
    expect(strict.output).toContain("[no-untyped-def]");
    writeFileSync(mypyConfig, mypyDefault);

    const fixable =
      "import os\n\ndef greeting(name: str) -> str:\n    return f'Hello, {name}!'\n";
    writeFileSync(source, fixable);
    const untracked = join(repo, "untracked.py");
    const bad = "def broken(): return missing_name\n";
    writeFileSync(untracked, bad);
    expect(run(lint).output).toContain("F401");
    expect(run(fix).status).toBe(0);
    expect(readFileSync(source, "utf8")).toBe(original);
    expect(readFileSync(untracked, "utf8")).toBe(bad);
    expect(readFileSync(external, "utf8")).toBe(
      "def broken(): return missing_name\n",
    );
    rmSync(untracked);
    for (const check of [lint, format, types]) {
      expect(run(check).status).toBe(0);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
