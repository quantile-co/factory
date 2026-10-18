import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("runs the Google Cloud CLI without credentials and allows package overrides", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-gcp-"));
  try {
    const build = (override = "") => {
      const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      in (pkgs.lib.evalModules {
        modules = [ f.nixModules.gcp ${override} ];
        specialArgs = { inherit pkgs; };
      }).config.quantile.gcp.gcloud.package`;
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
        { encoding: "utf8", timeout: 150_000 },
      );
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim().split("\n")[0];
    };

    const gcloud = spawnSync(join(build(), "bin/gcloud"), ["--version"], {
      cwd: work,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: work,
        CLOUDSDK_CONFIG: join(work, "gcloud"),
        CLOUDSDK_CORE_DISABLE_USAGE_REPORTING: "true",
        CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK: "true",
        CLOUDSDK_CORE_DISABLE_PROMPTS: "true",
      },
    });
    if (gcloud.error) throw gcloud.error;
    expect(gcloud.status, gcloud.stderr).toBe(0);
    expect(gcloud.stdout).toContain("Google Cloud SDK");
    expect(
      readdirSync(work, { recursive: true, encoding: "utf8" }).some((path) =>
        path.endsWith("application_default_credentials.json"),
      ),
    ).toBe(false);

    const hello = spawnSync(
      join(build("{ quantile.gcp.gcloud.package = pkgs.hello; }"), "bin/hello"),
      [],
      { encoding: "utf8" },
    );
    if (hello.error) throw hello.error;
    expect(hello.status, hello.stderr).toBe(0);
    expect(hello.stdout).toContain("Hello, world!");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
