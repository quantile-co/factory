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

it("checks tracked text without mutation and fixes only eligible EOFs on demand", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-editorconfig-"));
  try {
    const build = (selector: string, override = "") => {
      const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      in (pkgs.lib.evalModules {
        modules = [ f.nixModules.editorconfig ${override} ];
        specialArgs = { inherit pkgs; };
      }).config.quantile.editorconfig.${selector}.package`;
      const result = spawnSync(
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
        { encoding: "utf8", timeout: 120_000 },
      );
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim().split("\n")[0];
    };
    const run = (binary: string, args: string[] = []) => {
      const result = spawnSync(binary, args, {
        cwd: work,
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    const source = join(work, "source with spaces/example.txt");
    const excluded = join(work, "excluded/example.txt");
    const cpp = join(work, "example.cpp");
    const binary = join(work, "binary.bin");
    const external = join(
      tmpdir(),
      `factory-editorconfig-external-${process.pid}.txt`,
    );
    mkdirSync(join(work, "source with spaces"));
    mkdirSync(join(work, "excluded"));
    copyFileSync(
      new URL("../../etc/editorconfig/.editorconfig", import.meta.url),
      join(work, ".editorconfig"),
    );
    const checkerConfig = JSON.parse(
      readFileSync(
        new URL(
          "../../etc/editorconfig/.editorconfig-checker.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    checkerConfig.Exclude.push("^excluded/");
    writeFileSync(
      join(work, ".editorconfig-checker.json"),
      `${JSON.stringify(checkerConfig)}\n`,
    );
    writeFileSync(source, "first\n  second\n");
    writeFileSync(cpp, "int main() {\n  return 0;\n}\n");
    writeFileSync(excluded, "excluded without newline");
    writeFileSync(join(work, "devenv.lock"), "lock without newline");
    writeFileSync(binary, Buffer.from([0, 1, 2]));
    writeFileSync(external, "external without newline");
    symlinkSync(external, join(work, "linked.txt"));
    run("git", ["init", "--quiet"]);
    run("git", [
      "add",
      ".editorconfig",
      ".editorconfig-checker.json",
      "source with spaces/example.txt",
      "example.cpp",
      "excluded/example.txt",
      "devenv.lock",
      "binary.bin",
      "linked.txt",
    ]);
    const check = join(build("check"), "bin/check-editorconfig");
    const fix = join(build("fix"), "bin/fix-editorconfig-eof");
    const original = readFileSync(source);
    try {
      const twoSpaces = run(check);
      expect(twoSpaces.status).not.toBe(0);
      expect(twoSpaces.output).toContain("example.cpp");
      writeFileSync(cpp, "int main() {\n    return 0;\n}\n");
      expect(run(check).status).toBe(0);
      writeFileSync(source, original.subarray(0, -1));
      const failing = run(check);
      expect(failing.status).not.toBe(0);
      expect(failing.output).toContain("final newline");
      expect(readFileSync(source)).toEqual(original.subarray(0, -1));
      writeFileSync(join(work, "untracked.txt"), "untracked without newline");
      expect(run(fix).status).toBe(0);
      expect(readFileSync(source)).toEqual(original);
      expect(run(check).status).toBe(0);
      writeFileSync(source, Buffer.concat([original, Buffer.from("\n\n")]));
      expect(run(fix).status).toBe(0);
      expect(readFileSync(source)).toEqual(original);
      expect(run(fix).status).toBe(0);
      for (const path of [
        excluded,
        external,
        join(work, "untracked.txt"),
        join(work, "devenv.lock"),
      ]) {
        expect(readFileSync(path, "utf8")).toContain("without newline");
      }
      expect(readFileSync(binary)).toEqual(Buffer.from([0, 1, 2]));
      expect(readFileSync(join(work, "linked.txt"), "utf8")).toBe(
        "external without newline",
      );
      rmSync(join(work, ".editorconfig"));
      expect(run(check).output).toContain("Missing consumer .editorconfig");
      copyFileSync(
        new URL("../../etc/editorconfig/.editorconfig", import.meta.url),
        join(work, ".editorconfig"),
      );
      const badFixer = build(
        "fix",
        '{ quantile.editorconfig.fixer.package = pkgs.writeShellScriptBin "end-of-file-fixer" "echo FIXTURE_EOF_FAILURE >&2; exit 23"; }',
      );
      const failedFix = run(join(badFixer, "bin/fix-editorconfig-eof"));
      expect(failedFix.status).toBe(23);
      expect(failedFix.output).toContain("FIXTURE_EOF_FAILURE");
    } finally {
      rmSync(external, { force: true });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
