import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = `git+${new URL("../../", import.meta.url).href}`;

it("wires the overridable module, public package and development shell on each platform", () => {
  const wiring = JSON.parse(
    execFileSync(
      "nix",
      [
        "eval",
        "--json",
        "--impure",
        "--expr",
        `let f = builtins.getFlake ${JSON.stringify(root)};
        in builtins.map (system: let
          pkgs = f.inputs.nixpkgs.legacyPackages.\${system};
          evaluate = modules: (pkgs.lib.evalModules {
            inherit modules; specialArgs = { inherit pkgs; factoryInputs = f.inputs; };
          }).config.quantile-co.factory;
          module = evaluate [ f.nixModules.langfuse ];
          aggregate = evaluate [ f.nixModules.default ];
          overridden = evaluate [
            f.nixModules.langfuse
            { quantile-co.factory.langfuse.package = pkgs.hello; }
          ];
          package = f.packages.\${system}.langfuse;
        in {
          moduleExport = module.langfuse.package == package;
          aggregateExport = aggregate.langfuse.package == package;
          inShell = builtins.elem package f.devShells.\${system}.default.nativeBuildInputs;
          overridable = overridden.langfuse.package == pkgs.hello;
        }) [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ]`,
      ],
      { encoding: "utf8", timeout: 120_000 },
    ),
  );
  for (const platform of wiring) {
    expect(platform.moduleExport).toBe(true);
    expect(platform.aggregateExport).toBe(true);
    expect(platform.inShell).toBe(true);
    expect(platform.overridable).toBe(true);
  }
}, 120_000);

it("runs the packaged CLI and bundled API discovery without host tools or credentials", () => {
  const output = execFileSync(
    "nix",
    ["build", `${root}#langfuse`, "--no-link", "--print-out-paths"],
    { encoding: "utf8", timeout: 180_000 },
  ).trim();
  const home = mkdtempSync(join(tmpdir(), "factory-langfuse-"));
  try {
    const run = (...args: string[]) =>
      execFileSync(join(output, "bin/langfuse"), args, {
        cwd: home,
        env: { HOME: home, PATH: "/no-host-tools" },
        encoding: "utf8",
        timeout: 30_000,
      });
    expect(run("--version").trim()).toBe("1.2.4");
    expect(run("api", "--help")).toContain("Resources:");
    expect(run("api", "help", "traces", "list")).toContain("--limit");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 210_000);
