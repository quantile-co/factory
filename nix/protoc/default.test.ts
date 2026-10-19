import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps protoc plugins mergeable and replaces them with mkForce", () => {
  const root = new URL("../../", import.meta.url);
  const evaluate = (override: string) => {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      cfg = (pkgs.lib.evalModules {
        modules = [ f.nixModules.protoc { quantile.protoc.generators = ${override}; } ];
        specialArgs = { inherit pkgs; };
      }).config.quantile.protoc;
    in builtins.map pkgs.lib.getName cfg.generators`;
    const result = spawnSync(
      "nix",
      ["eval", "--json", "--impure", "--expr", expr],
      {
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as string[];
  };
  const appended = evaluate("pkgs.lib.mkAfter [ pkgs.hello ]");
  expect(appended).toHaveLength(3);
  expect(appended[2]).toBe("hello");
  expect(evaluate("pkgs.lib.mkForce [ pkgs.hello ]")).toEqual(["hello"]);
}, 150_000);

it("exposes protoc, Buf and Go/Connect generators while leaving generation explicit", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-protobuf-"));
  try {
    const build = (selector: string) => {
      const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
        config = (pkgs.lib.evalModules {
          modules = [ f.nixModules.protoc f.nixModules.buf ]; specialArgs = { inherit pkgs; };
        }).config;
      in ${selector}`;
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
    const protoc = join(
      build("config.quantile.protoc.package.out"),
      "bin/protoc",
    );
    const buf = join(build("config.quantile.buf.package.out"), "bin/buf");
    const go = join(
      build("(builtins.elemAt config.quantile.protoc.generators 0).out"),
      "bin/protoc-gen-go",
    );
    const connect = join(
      build("(builtins.elemAt config.quantile.protoc.generators 1).out"),
      "bin/protoc-gen-connect-go",
    );
    const run = (binary: string, args: string[]) => {
      const result = spawnSync(binary, args, {
        cwd: work,
        encoding: "utf8",
        timeout: 30_000,
      });
      if (result.error) throw result.error;
      expect(result.status, result.stdout + result.stderr).toBe(0);
      return result.stdout + result.stderr;
    };
    expect(run(protoc, ["--version"])).toContain("libprotoc");
    expect(run(buf, ["--version"])).toMatch(/\d+\.\d+/);
    for (const generator of [go, connect]) {
      expect(run(generator, ["--version"]).trim()).not.toBe("");
    }

    const sourceDir = join(work, "schema with spaces");
    mkdirSync(sourceDir);
    const proto =
      'syntax = "proto3";\npackage fixture;\nmessage Request { string name = 1; }\n';
    writeFileSync(join(sourceDir, "fixture.proto"), proto);
    const descriptor = join(work, "descriptor.bin");
    expect(existsSync(descriptor)).toBe(false);
    run(protoc, [
      `--proto_path=${sourceDir}`,
      `--descriptor_set_out=${descriptor}`,
      "fixture.proto",
    ]);
    expect(statSync(descriptor).size).toBeGreaterThan(0);
    expect(readFileSync(join(sourceDir, "fixture.proto"), "utf8")).toBe(proto);
    expect(readdirSync(sourceDir)).toEqual(["fixture.proto"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
