import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("renders with the pinned headless browser without host tools or browser caches", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    cfg = pkgs.lib.evalModules { modules = [ f.nixModules.playwright ]; specialArgs = { inherit pkgs; }; };
    in cfg.config.quantile.playwright.package`;
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
    copyFileSync(new URL("./fixtures/browser.html", import.meta.url), html);
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
