import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("exposes overridable age and encrypts synthetic data offline", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    pkg = override: (pkgs.lib.evalModules {
      modules = [ f.nixModules.age override ]; specialArgs = { inherit pkgs; };
    }).config.quantile-co.factory.age.package.out;
  in [ (pkg {}) (pkg { quantile-co.factory.age.package = pkgs.hello; }) ]`;
  const built = spawnSync(
    "nix",
    ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (built.error) throw built.error;
  expect(built.status, built.stderr).toBe(0);
  const paths = built.stdout.trim().split("\n");
  const replacement = paths.find((path) => existsSync(join(path, "bin/hello")));
  const selected = paths.find((path) => path !== replacement);
  if (!selected || !replacement) throw new Error(built.stdout);
  const work = mkdtempSync(join(tmpdir(), "factory-age-"));
  try {
    const run = (bin: string, args: string[], input?: string) => {
      const result = spawnSync(join(selected, "bin", bin), args, {
        cwd: work,
        env: { ...process.env, HOME: work },
        input,
        encoding: "utf8",
        timeout: 30_000,
      });
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    };
    expect(run("age", ["--version"])).toMatch(/v?\d+\.\d+/);
    const identity = join(work, "identity.txt");
    const ciphertext = join(work, "ciphertext.age");
    run("age-keygen", ["-o", identity]);
    expect(statSync(identity).mode & 0o777).toBe(0o600);
    const recipient = run("age-keygen", ["-y", identity]).trim();
    expect(recipient).toMatch(/^age1/);
    const marker = `synthetic-${randomUUID()}\n`;
    run("age", ["-r", recipient, "-o", ciphertext], marker);
    expect(run("age", ["-d", "-i", identity, ciphertext])).toBe(marker);
    expect(
      spawnSync(join(replacement, "bin/hello"), [], { encoding: "utf8" })
        .stdout,
    ).toContain("Hello, world!");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
