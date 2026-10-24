import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("renders with the pinned headless browser without host tools or browser caches", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    cfg = pkgs.lib.evalModules { modules = [ f.nixModules.playwright ]; specialArgs = { inherit pkgs; }; };
    in cfg.config.quantile-co.factory.playwright.withVersion "1.64.1"`;
  const built = spawnSync(
    "nix",
    ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
    {
      encoding: "utf8",
      timeout: 180_000,
    },
  );
  expect(built.status, built.stderr).toBe(0);
  const home = mkdtempSync(join(tmpdir(), "factory-playwright-"));
  try {
    const html = join(home, "index.html");
    writeFileSync(
      html,
      '<!doctype html>\n<html lang="en">\n  <head><title>Browser smoke test</title></head>\n  <body>\n    <p>pinned browser</p>\n    <script>document.body.dataset.executed = "yes";</script>\n  </body>\n</html>\n',
    );
    const result = spawnSync(
      join(built.stdout.trim(), "bin/chromium-headless-shell"),
      ["--no-sandbox", "--disable-gpu", "--dump-dom", `file://${html}`],
      {
        env: { HOME: home, PATH: "/no-host-tools", XDG_CACHE_HOME: home },
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('data-executed="yes"');
    expect(result.stdout).toContain("pinned browser");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 210_000);

it("checks the selected browser version, including consumer overrides", () => {
  const root = new URL("../../", import.meta.url);
  const evaluate = (version: string) =>
    spawnSync(
      "nix",
      [
        "eval",
        "--impure",
        "--raw",
        "--expr",
        `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      browser = (pkgs.writeShellScriptBin "browser" "exit 0") // { playwrightVersion = "custom"; };
      cfg = pkgs.lib.evalModules {
        modules = [ f.nixModules.playwright { quantile-co.factory.playwright.package = browser; } ];
        specialArgs = { inherit pkgs; };
      };
      selected = cfg.config.quantile-co.factory.playwright.withVersion ${JSON.stringify(version)};
      in if selected.outPath == browser.outPath then "selected" else "wrong package"`,
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
  const accepted = evaluate("custom");
  expect(accepted.status, accepted.stderr).toBe(0);
  expect(accepted.stdout).toBe("selected");
  const rejected = evaluate("different");
  expect(rejected.status).not.toBe(0);
  expect(rejected.stderr).toContain("must match Factory's pinned browser");
}, 150_000);
