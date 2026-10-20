import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
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

it("runs consumer-native Google and Quantile prose rules read-only with scoped Git selection", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-vale-"));
  const outside = mkdtempSync(join(tmpdir(), "factory-vale-outside-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules { modules = [ f.nixModules.vale ]; specialArgs = { inherit pkgs; }; }).config.quantile.vale.check.package`;
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
    const check = join(built.stdout.trim(), "bin/check-vale");
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
    const config = join(work, ".vale.ini");
    copyFileSync(new URL("../../etc/vale/.vale.ini", import.meta.url), config);
    mkdirSync(join(work, "etc/vale"), { recursive: true });
    cpSync(
      new URL("../../etc/vale/styles", import.meta.url),
      join(work, "etc/vale/styles"),
      { recursive: true },
    );
    const baseline = readFileSync(config, "utf8");
    mkdirSync(join(work, "docs"));
    const guide = join(work, "docs/guide with spaces.md");
    const accepted = "# Guide\n\nReview checks before deploying.\n";
    writeFileSync(guide, accepted);
    expect(
      spawnSync("git", ["add", "docs/guide with spaces.md"], { cwd: work })
        .status,
    ).toBe(0);
    const heading = "# The Ultimate Guide to Devenv\n";
    writeFileSync(guide, heading);
    const rejected = run(["docs/*.md"]);
    expect(rejected.status).not.toBe(0);
    expect(rejected.output).toContain("Quantile.TemplatedHeadings");
    expect(rejected.output).toContain("Google.Headings");
    expect(readFileSync(guide, "utf8")).toBe(heading);
    writeFileSync(
      config,
      `${baseline.replace("Google.Headings = error", "Google.Headings = NO")}\nQuantile.TemplatedHeadings = NO\n`,
    );
    const overridden = run(["docs/*.md"]);
    expect(overridden.status, overridden.output).toBe(0);
    writeFileSync(config, baseline);
    writeFileSync(guide, accepted);
    const draft = join(work, "docs/draft.md");
    const filler = "# Draft\n\nIt is worth noting that the check runs.\n";
    writeFileSync(draft, filler);
    const untracked = run(["docs/*.md"]);
    expect(untracked.status).not.toBe(0);
    expect(untracked.output).toContain("Quantile.Filler");
    expect(readFileSync(draft, "utf8")).toBe(filler);
    const plainText = join(work, "docs/notes.txt");
    writeFileSync(plainText, "It is worth noting that the check runs.\n");
    const textResult = run(["docs/*.txt"]);
    expect(textResult.status).not.toBe(0);
    expect(textResult.output).toContain("Quantile.Filler");
    rmSync(plainText);
    const rejectedWords = join(
      work,
      "etc/vale/styles/config/vocabularies/Quantile/reject.txt",
    );
    writeFileSync(rejectedWords, "delightful\n");
    writeFileSync(draft, "# Draft\n\nA delightful workflow.\n");
    const vocabulary = run(["docs/*.md"]);
    expect(vocabulary.status).not.toBe(0);
    expect(vocabulary.output).toContain("Vale.Avoid");
    rmSync(draft);
    writeFileSync(join(work, ".gitignore"), "docs/ignored.md\n");
    writeFileSync(join(work, "docs/ignored.md"), filler);
    const external = join(outside, "outside.md");
    writeFileSync(external, filler);
    symlinkSync(external, join(work, "docs/linked.md"));
    expect(run(["docs/*.md"]).status).toBe(0);
    expect(run([":(bad)"]).status).not.toBe(0);
    rmSync(config);
    const missing = run(["docs/*.md"]);
    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain("requires consumer-native .vale.ini");
    const custom = join(work, "custom.ini");
    writeFileSync(custom, baseline);
    const env = { ...process.env, VALE_CONFIG_FILE: "custom.ini" };
    expect(run(["docs/*.md"], env).status).toBe(0);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}, 180_000);
