import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
