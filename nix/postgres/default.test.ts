import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("exposes PostgreSQL and NSS tools without creating a database or certificate store", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-postgres-"));
  try {
    const build = (option: string, output: "out" | "tools") => {
      const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      in (pkgs.lib.evalModules {
        modules = [ f.nixModules.postgres ]; specialArgs = { inherit pkgs; };
      }).config.quantile.postgres.${option}.${output}`;
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
      return result.stdout.trim();
    };
    const postgres = build("package", "out");
    const nss = build("nss.package", "tools");
    const env = {
      ...process.env,
      HOME: work,
      PGDATA: join(work, "uninitialized-db"),
      XDG_CONFIG_HOME: work,
    };
    const run = (path: string, args: string[]) => {
      const result = spawnSync(path, args, {
        cwd: work,
        env,
        encoding: "utf8",
        timeout: 15_000,
      });
      if (result.error) throw result.error;
      return result;
    };
    for (const binary of ["psql", "postgres"]) {
      const version = run(join(postgres, "bin", binary), ["--version"]);
      expect(version.status, version.stderr).toBe(0);
      expect(version.stdout).toMatch(/PostgreSQL\) \d+/);
    }
    // certutil -H prints help and exits 1 without opening an NSS database.
    const certutil = run(join(nss, "bin/certutil"), ["-H"]);
    expect(certutil.status).toBe(1);
    expect(certutil.stdout + certutil.stderr).toContain(
      "Add a certificate to the database",
    );
    expect(readdirSync(work)).toEqual([]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
