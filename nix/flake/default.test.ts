import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("wires explicit packages and local/generated files without repository policy", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-flake-"));
  try {
    const factory = `git+${new URL("../../", import.meta.url).href}`;
    const expression = `let
      f = builtins.getFlake ${JSON.stringify(factory)};
      system = builtins.currentSystem;
      pkgs = f.inputs.nixpkgs.legacyPackages.\${system};
      outputs = f.lib.mkFlake {
        inherit (f.inputs) nixpkgs;
        systems = [ system ];
        modules = [ f.nixModules.readme ];
        perSystem = { pkgs, factory }: {
          packages = {
            hello = pkgs.hello;
            unsupported = pkgs.hello.overrideAttrs { meta.platforms = []; };
            broken = pkgs.hello.overrideAttrs { meta.broken = true; };
          };
          devShell = {
            packages = [ pkgs.hello ];
            files = {
              "copy.txt" = { source = pkgs.writeText "generated" "generated\\n"; mode = "copy"; };
              "README.md" = {
                source = factory.readme.withProject { name = "Example"; description = "Example project"; };
                mode = "seed";
              };
            };
          };
        };
      };
    in `;
    const evaluate = (result: string) =>
      JSON.parse(
        execFileSync(
          "nix",
          ["eval", "--json", "--impure", "--expr", expression + result],
          {
            encoding: "utf8",
            timeout: 120_000,
          },
        ),
      );
    expect(evaluate(`builtins.attrNames outputs.packages.\${system}`)).toEqual([
      "files",
      "hello",
    ]);
    const wiring = evaluate(`{
      shell = map toString outputs.devShells.\${system}.default.nativeBuildInputs;
      selected = [ (toString pkgs.hello) (toString outputs.packages.\${system}.files) ];
      nodePinned = f.packages.\${system}.nodejs_24 == pkgs.nodejs_24;
      bashAlias = f.packages.\${system}.bash == pkgs.bash;
      herdrPinned = f.packages.\${system}.herdr == f.inputs.llm-agents.packages.\${system}.herdr;
      herdrInShell = builtins.elem f.packages.\${system}.herdr f.devShells.\${system}.default.nativeBuildInputs;
    }`);
    expect(wiring.shell).toEqual(wiring.selected);
    expect(wiring.nodePinned).toBe(true);
    expect(wiring.bashAlias).toBe(true);
    expect(wiring.herdrPinned).toBe(true);
    expect(wiring.herdrInShell).toBe(true);

    const output = execFileSync(
      "nix",
      [
        "build",
        "--no-link",
        "--print-out-paths",
        "--impure",
        "--expr",
        `${expression}outputs.packages.\${system}.files`,
      ],
      { encoding: "utf8", timeout: 120_000 },
    ).trim();
    execFileSync("git", ["init", "-q"], { cwd: root });
    const run = (action: string) =>
      execFileSync(join(output, "bin/factory-files"), [action], { cwd: root });
    run("write");
    expect(readFileSync(join(root, "README.md"), "utf8")).toContain(
      "<h1>Example</h1>",
    );
    execFileSync("git", ["add", "copy.txt", "README.md"], { cwd: root });
    writeFileSync(join(root, "README.md"), "# Repository-owned README\n");
    writeFileSync(join(root, "copy.txt"), "changed copy\n");
    run("write");
    run("check");
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe(
      "# Repository-owned README\n",
    );
    expect(readFileSync(join(root, "copy.txt"), "utf8")).toBe("generated\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 180_000);
