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

it("lints selected Markdown read-only with consumer-native rule overrides", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-markdown-"));
  const repo = join(work, "repo");
  try {
    mkdirSync(join(repo, "files"), { recursive: true });
    const config = join(repo, ".markdownlint-cli2.jsonc");
    const selected = join(repo, "files/guide with spaces.md");
    const accepted = "# Guide\n\n<picture>Consumer-owned markup.</picture>\n";
    const duplicate = "## Repeated\n\n## Repeated\n";
    copyFileSync(
      new URL(
        "../../etc/markdownlint-cli2/.markdownlint-cli2.jsonc",
        import.meta.url,
      ),
      config,
    );
    writeFileSync(selected, accepted);
    writeFileSync(join(repo, "unrelated.md"), duplicate);
    writeFileSync(join(work, "outside.md"), duplicate);
    symlinkSync(join(work, "outside.md"), join(repo, "files/linked.md"));
    const run = (command: string, args: string[] = []) => {
      const result = spawnSync(command, args, {
        cwd: repo,
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(
      run("git", ["init", "--quiet", "--initial-branch=main"]).status,
    ).toBe(0);
    expect(run("git", ["add", "."]).status).toBe(0);
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules {
      modules = [ f.nixModules.markdownlint-cli2 ];
      specialArgs = { inherit pkgs; };
    }).config.quantile.markdownlint-cli2.check.package`;
    const built = spawnSync(
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
    if (built.error) throw built.error;
    expect(built.status, built.stderr).toBe(0);
    const check = join(
      built.stdout.trim().split("\n")[0],
      "bin/check-markdown",
    );
    expect(run(check, ["files/*.md"]).status).toBe(0);
    const untracked = join(repo, "files/brackets[1].md");
    writeFileSync(untracked, duplicate);
    const invalid = run(check, ["files/*.md"]);
    expect(invalid.status).not.toBe(0);
    expect(invalid.output).toContain("brackets[1].md");
    expect(invalid.output).toContain("MD024");
    expect(readFileSync(untracked, "utf8")).toBe(duplicate);
    rmSync(untracked);
    writeFileSync(selected, duplicate);
    const tracked = run(check, ["files/*.md"]);
    expect(tracked.status).not.toBe(0);
    expect(tracked.output).toContain("MD024");
    expect(readFileSync(selected, "utf8")).toBe(duplicate);
    writeFileSync(selected, accepted);
    const longLine =
      "This is a readable line that exceeds the consumer's stricter limit.\n";
    writeFileSync(selected, `# Guide\n\n${longLine}`);
    expect(run(check, ["files/*.md"]).status).toBe(0);
    writeFileSync(
      config,
      readFileSync(config, "utf8").replace(
        '"line_length": 120',
        '"line_length": 40',
      ),
    );
    const strict = run(check, ["files/*.md"]);
    expect(strict.status).not.toBe(0);
    expect(strict.output).toContain("MD013");
    expect(readFileSync(selected, "utf8")).toContain(longLine);
    expect(existsSync(join(repo, ".git/hooks/pre-push"))).toBe(false);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
