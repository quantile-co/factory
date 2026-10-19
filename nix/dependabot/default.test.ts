import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("selects ecosystems from one native Dependabot policy", () => {
  const root = new URL("../../", import.meta.url);
  const native = readFileSync(
    new URL("../../etc/dependabot/dependabot.yml", import.meta.url),
    "utf8",
  );
  const build = (ecosystems: string[]) => {
    const expression = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      cfg = (pkgs.lib.evalModules {
        modules = [ f.nixModules.dependabot ]; specialArgs = { inherit pkgs; };
      }).config;
    in cfg.quantile.dependabot.withUpdates [ ${ecosystems.map((name) => JSON.stringify(name)).join(" ")} ]`;
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
        expression,
      ],
      { encoding: "utf8", timeout: 150_000 },
    );
    if (result.error) throw result.error;
    return result;
  };
  const full = build(["github-actions", "npm", "opentofu", "nix"]);
  expect(full.status, full.stderr).toBe(0);
  expect(readFileSync(full.stdout.trim(), "utf8")).toBe(native);

  const selected = build(["github-actions", "opentofu", "nix"]);
  expect(selected.status, selected.stderr).toBe(0);
  const text = readFileSync(selected.stdout.trim(), "utf8");
  expect(text).toContain("version: 2");
  expect(text.match(/package-ecosystem:/g)).toHaveLength(3);
  expect(text).toContain("package-ecosystem: github-actions");
  expect(text).toContain("package-ecosystem: opentofu");
  expect(text).toContain("package-ecosystem: nix");
  expect(text).not.toContain("package-ecosystem: npm");
  expect(readFileSync(full.stdout.trim(), "utf8")).toBe(native);

  const unknown = build(["github-actions", "unknown"]);
  expect(unknown.status).not.toBe(0);
  expect(unknown.stderr).toContain(
    "Expected one native Dependabot update for unknown",
  );
  const empty = build([]);
  expect(empty.status).not.toBe(0);
  expect(empty.stderr).toContain("nonempty list of ecosystems");
}, 180_000);

it("checks the indexed Dependabot copy rather than a repaired working copy", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-dependabot-check-"));
  try {
    const root = new URL("../../", import.meta.url);
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules {
      modules = [ f.nixModules.dependabot ]; specialArgs = { inherit pkgs; };
    }).config.quantile.dependabot.check.package`;
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
    const command = join(built.stdout.trim(), "bin/check-dependabot");
    const expected = join(work, "selected policy.yml");
    const tracked = join(work, ".github/dependabot.yml");
    const policy = "version: 2\nupdates: []\n";
    writeFileSync(expected, policy);
    mkdirSync(join(work, ".github"));
    expect(spawnSync("git", ["init", "-q"], { cwd: work }).status).toBe(0);
    const check = () =>
      spawnSync(command, [expected], { cwd: work, encoding: "utf8" });
    expect(check().status).not.toBe(0); // Missing indexed file.
    writeFileSync(tracked, "version: 1\n");
    expect(
      spawnSync("git", ["add", ".github/dependabot.yml"], { cwd: work }).status,
    ).toBe(0);
    writeFileSync(tracked, policy);
    const stale = check();
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toContain(
      "Commit the selected Dependabot configuration",
    );
    expect(readFileSync(tracked, "utf8")).toBe(policy);
    expect(
      spawnSync("git", ["add", ".github/dependabot.yml"], { cwd: work }).status,
    ).toBe(0);
    expect(check().status).toBe(0);
    rmSync(expected);
    expect(check().status).not.toBe(0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
