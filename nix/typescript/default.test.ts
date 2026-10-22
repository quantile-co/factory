import { spawnSync } from "node:child_process";
import {
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

it("checks selected nested TypeScript with a hoisted project compiler and no emitted build data", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-typescript-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      config = (pkgs.lib.evalModules { modules = [ f.nixModules.typescript ]; specialArgs = { inherit pkgs; }; }).config;
      rendered = config.quantile.typescript.withOverrides {
        compilerOptions = { composite = true; incremental = true; outDir = "dist"; tsBuildInfoFile = "build info.tsbuildinfo"; };
        include = [ "source with spaces/*.ts" ];
      };
    in [ config.quantile.typescript.check.package pkgs.typescript rendered ]`;
    const built = spawnSync(
      "nix",
      ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
      {
        encoding: "utf8",
        timeout: 150_000,
      },
    );
    if (built.error) throw built.error;
    expect(built.status, built.stderr).toBe(0);
    const paths = built.stdout.trim().split("\n");
    const check = join(
      paths.find((path) => path.endsWith("-check-typescript")) ?? "",
      "bin/check-typescript",
    );
    const typescript = paths.find((path) => /-typescript-\d/.test(path));
    if (!typescript) throw new Error("Nix did not build TypeScript");
    const baseConfig = paths.find((path) => path.endsWith("-tsconfig.json"));
    if (!baseConfig) throw new Error("Nix did not render TypeScript config");
    const run = (args: string[] = []) => {
      const result = spawnSync(check, args, {
        cwd: work,
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(spawnSync("git", ["init", "-q"], { cwd: work }).status).toBe(0);
    const project = join(work, "packages/first project");
    const folder = join(project, "source with spaces");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(project, "package.json"),
      '{"private":true,"type":"module"}\n',
    );
    const config = join(project, "tsconfig.json");
    const tsconfig = JSON.parse(readFileSync(baseConfig, "utf8"));
    expect(tsconfig.compilerOptions).toMatchObject({
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      incremental: true,
    });
    writeFileSync(config, readFileSync(baseConfig));
    const previousInfo = join(project, "build info.tsbuildinfo");
    writeFileSync(previousInfo, "preserve an existing compiler cache\n");
    const source = join(folder, "example.ts");
    const valid = "export const value: number = 3;\n";
    writeFileSync(source, valid);
    const track = spawnSync("git", ["add", "packages/first project"], {
      cwd: work,
    });
    expect(track.status).toBe(0);
    const missing = run();
    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain("Missing project-local tsc");
    mkdirSync(join(work, "node_modules/.bin"), { recursive: true });
    symlinkSync(
      join(typescript, "bin/tsc"),
      join(work, "node_modules/.bin/tsc"),
    );
    const accepted = run();
    expect(accepted.status, accepted.output).toBe(0);
    expect(readFileSync(previousInfo, "utf8")).toBe(
      "preserve an existing compiler cache\n",
    );
    expect(existsSync(join(project, "dist"))).toBe(false);
    const invalid = valid.replace("= 3", '= "wrong"');
    writeFileSync(source, invalid);
    const rejected = run();
    expect(rejected.status).not.toBe(0);
    expect(rejected.output).toContain("TS2322");
    expect(readFileSync(source, "utf8")).toBe(invalid);
    writeFileSync(source, valid);
    writeFileSync(
      config,
      `${JSON.stringify({ ...tsconfig, include: ["other.ts"] })}\n`,
    );
    writeFileSync(join(project, "other.ts"), "export const other = true;\n");
    const excluded = run();
    expect(excluded.status).not.toBe(0);
    expect(excluded.output).toContain(
      "Selected TypeScript file is not included",
    );
    expect(readFileSync(previousInfo, "utf8")).toBe(
      "preserve an existing compiler cache\n",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 220_000);
