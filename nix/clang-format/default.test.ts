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

it("checks C/C++ source without rewriting, requires real compile flags, and fixes only selected tracked files", () => {
  const factory = fileURLToPath(new URL("../../", import.meta.url));
  const work = mkdtempSync(join(tmpdir(), "factory-clang-"));
  const repo = join(work, "consumer");
  const env = {
    HOME: join(work, "home"),
    PATH: process.env.PATH,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE,
    NIX_SSL_CERT_FILE: process.env.NIX_SSL_CERT_FILE,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  const run = (
    cwd: string,
    command: string,
    args: string[],
    overrides: Record<string, string> = {},
  ) => {
    const result = spawnSync(command, args, {
      cwd,
      env: { ...env, ...overrides },
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: result.stdout,
      output: result.stdout + result.stderr,
    };
  };
  try {
    mkdirSync(repo);
    mkdirSync(env.HOME);
    const prelude = `
      let
        factory = builtins.getFlake ${JSON.stringify(`git+file:${factory}`)};
        pkgs = factory.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
        tools = (pkgs.lib.evalModules {
          modules = [ factory.nixModules.clang-format factory.nixModules.clang-tidy ];
          specialArgs = { inherit pkgs; };
        }).config.quantile-co.factory;
    `;
    const expression = `${prelude} in {
        formatCheck = tools.clang-format.check.package.outPath;
        formatFix = tools.clang-format.fix.package.outPath;
        tidyCheck = tools.clang-tidy.check.package.outPath;
        compiler = "\${pkgs.clang}/bin/clang";
      }
    `;
    const evalResult = run(factory, "nix", [
      "--extra-experimental-features",
      "nix-command flakes",
      "eval",
      "--json",
      "--impure",
      "--expr",
      expression,
    ]);
    expect(evalResult.status, evalResult.output).toBe(0);
    const paths = JSON.parse(evalResult.stdout) as Record<string, string>;
    const built = run(factory, "nix", [
      "--extra-experimental-features",
      "nix-command flakes",
      "build",
      "--no-link",
      "--impure",
      "--expr",
      `${prelude} in [ tools.clang-format.check.package tools.clang-format.fix.package tools.clang-tidy.check.package ]`,
    ]);
    expect(built.status, built.output).toBe(0);

    run(repo, "git", ["init", "--quiet", "--initial-branch=main"]);
    copyFileSync(
      join(factory, "etc/clang-format/.clang-format"),
      join(repo, ".clang-format"),
    );
    copyFileSync(
      join(factory, "etc/clang-tidy/.clang-tidy"),
      join(repo, ".clang-tidy"),
    );
    const source = join(repo, "main.c");
    const unformatted = "int main(void){return 0;}\n";
    writeFileSync(source, unformatted);
    mkdirSync(join(repo, "vendor"));
    writeFileSync(join(repo, "vendor", "ignored.c"), unformatted);
    writeFileSync(join(repo, "untracked.c"), unformatted);
    const outside = join(work, "outside.c");
    writeFileSync(outside, unformatted);
    symlinkSync(outside, join(repo, "linked.c"));
    writeFileSync(join(repo, "binary.c"), Buffer.from([0, 1, 2, 3]));
    run(repo, "git", [
      "add",
      ".clang-format",
      ".clang-tidy",
      "main.c",
      "vendor/ignored.c",
      "linked.c",
      "binary.c",
    ]);

    const formatCheck = join(paths.formatCheck, "bin/check-clang-format");
    const formatFix = join(paths.formatFix, "bin/fix-clang-format");
    const tidyCheck = join(paths.tidyCheck, "bin/check-clang-tidy");
    const failedFormat = run(repo, formatCheck, []);
    expect(failedFormat.status).not.toBe(0);
    expect(failedFormat.output).toContain("main.c");
    expect(readFileSync(source, "utf8")).toBe(unformatted);
    expect(run(repo, formatFix, []).status).toBe(0);
    const formatted = readFileSync(source, "utf8");
    expect(formatted).not.toBe(unformatted);
    expect(run(repo, formatCheck, []).status).toBe(0);
    expect(run(repo, formatFix, []).status).toBe(0);
    expect(readFileSync(source, "utf8")).toBe(formatted);
    for (const file of ["vendor/ignored.c", "untracked.c"]) {
      expect(readFileSync(join(repo, file), "utf8")).toBe(unformatted);
    }
    expect(readFileSync(outside, "utf8")).toBe(unformatted);

    const badAnalysis =
      "int main(void) {\n    int *pointer = 0;\n    return *pointer;\n}\n";
    writeFileSync(source, badAnalysis);
    const databaseDir = join(repo, "build flags");
    const tidyEnv = { CLANG_TIDY_COMPILE_COMMANDS_DIR: databaseDir };
    expect(run(repo, tidyCheck, ["main.c"], tidyEnv).output).toContain(
      "requires a compilation database",
    );
    mkdirSync(databaseDir);
    const database = join(databaseDir, "compile_commands.json");
    const entry = (file: string) => [
      {
        directory: repo,
        file,
        arguments: [paths.compiler, "-c", file],
      },
    ];
    writeFileSync(database, JSON.stringify(entry("other.c")));
    expect(run(repo, tidyCheck, ["main.c"], tidyEnv).output).toContain(
      "No compilation database entry",
    );
    writeFileSync(database, JSON.stringify(entry("main.c")));
    const analysis = run(repo, tidyCheck, ["main.c"], tidyEnv);
    expect(analysis.status).not.toBe(0);
    expect(analysis.output).toContain("clang-analyzer-core.NullDereference");
    expect(readFileSync(source, "utf8")).toBe(badAnalysis);
    writeFileSync(source, formatted);
    expect(run(repo, tidyCheck, ["main.c"], tidyEnv).status).toBe(0);

    mkdirSync(join(repo, "source with spaces"));
    const header = join(repo, "source with spaces/probe.hpp");
    writeFileSync(header, "int answer( void );\n");
    run(repo, "git", ["add", "source with spaces/probe.hpp"]);
    expect(run(repo, formatCheck, []).output).toContain("probe.hpp");
    expect(run(repo, formatFix, ["source with spaces/probe.hpp"]).status).toBe(
      0,
    );
    expect(readFileSync(header, "utf8")).not.toBe("int answer( void );\n");
    expect(readFileSync(source, "utf8")).toBe(formatted);

    writeFileSync(
      join(repo, ".clang-format"),
      "BasedOnStyle: LLVM\nIndentWidth: 2\nColumnLimit: 100\nAllowShortFunctionsOnASingleLine: None\n",
    );
    writeFileSync(source, "int main(void) {\n    return 0;\n}\n");
    expect(run(repo, formatCheck, ["main.c"]).status).not.toBe(0);
    expect(run(repo, formatFix, ["main.c"]).status).toBe(0);
    expect(readFileSync(source, "utf8")).toContain("\n  return 0;\n");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
