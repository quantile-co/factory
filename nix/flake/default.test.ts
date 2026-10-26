import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("evaluates caller-composed named modules and consumer overrides", () => {
  const expression = `let
    f = builtins.getFlake ${JSON.stringify(`git+${new URL("../../", import.meta.url).href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    evaluate = names: select: let
      cfg = (pkgs.lib.evalModules {
        specialArgs = { inherit pkgs; };
        modules = map (name: f.nixModules.\${name}) names ++ pkgs.lib.optional (builtins.elem "flake" names) {
          quantile-co.factory.files.package = pkgs.hello;
        };
      }).config.quantile-co.factory;
    in (select cfg).drvPath;
  in {
    actionlint = evaluate [ "actionlint" "shellcheck" ] (cfg: cfg.actionlint.check.package);
    flake = evaluate [ "flake" "files" ] (cfg: cfg.flake.outputs.packages.files);
    git = evaluate [ "git" "prek" "commitizen" "gitleaks" ] (cfg: cfg.git.prePush.package);
    keepSorted = evaluate [ "keep-sorted" "prek" ] (cfg: cfg.keep-sorted.check.package);
    prek = evaluate [ "prek" "commitizen" "gitleaks" ] (cfg: cfg.prek.check.package);
    kubeconform = evaluate [ "kubeconform" ] (cfg: cfg.kubeconform.check.package);
    expectedFiles = pkgs.hello.drvPath;
  }`;
  const result = JSON.parse(
    execFileSync("nix", ["eval", "--json", "--impure", "--expr", expression], {
      encoding: "utf8",
      timeout: 120_000,
    }),
  );
  expect(result.flake).toBe(result.expectedFiles);
  expect(
    Object.values(result).every((path) => String(path).endsWith(".drv")),
  ).toBe(true);
}, 150_000);

it("requires sibling imports only when a dependent default is evaluated", () => {
  const expression = `let
    f = builtins.getFlake ${JSON.stringify(`git+${new URL("../../", import.meta.url).href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    configuration = overrides: (pkgs.lib.evalModules {
      specialArgs = { inherit pkgs; };
      modules = [ f.nixModules.prek overrides ];
    }).config.quantile-co.factory;
  in `;
  const evaluate = (selection: string) => {
    const result = spawnSync(
      "nix",
      ["eval", "--raw", "--impure", "--expr", expression + selection],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (result.error) throw result.error;
    return result;
  };
  const standalone = evaluate("(configuration {}).prek.package.drvPath");
  expect(standalone.status, standalone.stderr).toBe(0);

  const dependent = evaluate("(configuration {}).prek.check.package.drvPath");
  expect(dependent.status).not.toBe(0);
  expect(dependent.stderr).toContain("attribute 'commitizen' missing");

  const replaced = evaluate(`(configuration {
    quantile-co.factory.prek.tools.package = pkgs.hello;
  }).prek.check.package.drvPath`);
  expect(replaced.status, replaced.stderr).toBe(0);
}, 150_000);

it("wires explicit packages and local/generated files without repository policy", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-flake-"));
  try {
    const factory = `git+${new URL("../../", import.meta.url).href}`;
    const expression = `let
      f = builtins.getFlake ${JSON.stringify(factory)};
      system = builtins.currentSystem;
      pkgs = f.inputs.nixpkgs.legacyPackages.\${system};
      configuration = (pkgs.lib.evalModules {
        specialArgs = { inherit pkgs; factoryInputs = f.inputs; };
        modules = [ f.nixModules.default ({ config, ... }: {
          quantile-co.factory.flake.packages = {
            hello = pkgs.hello;
            unsupported = pkgs.hello.overrideAttrs { meta.platforms = []; };
            broken = pkgs.hello.overrideAttrs { meta.broken = true; };
          };
          quantile-co.factory.flake.devShell.packages = [ pkgs.hello ];
          quantile-co.factory.flake.devShell.shellHook = pkgs.lib.concatStringsSep "\\n" [
            config.quantile-co.factory.files.shellHook
            config.quantile-co.factory.pi.shellHook
            config.quantile-co.factory.uv.shellHook
          ];
          quantile-co.factory.files.entries = {
              "copy.txt" = { source = pkgs.writeText "generated" "generated\\n"; mode = "copy"; };
              "README.md" = {
                source = config.quantile-co.factory.readme.withProject { name = "Example"; description = "Example project"; };
                mode = "seed";
              };
          };
        }) ];
      }).config.quantile-co.factory;
      outputs = configuration.flake.outputs;
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
    expect(evaluate(`builtins.attrNames outputs.packages`)).toEqual([
      "files",
      "hello",
    ]);
    const wiring = evaluate(`{
      shell = map toString outputs.devShells.default.nativeBuildInputs;
      unselectedHook = (pkgs.lib.evalModules {
        modules = [ f.nixModules.default ];
        specialArgs = { inherit pkgs; factoryInputs = f.inputs; };
      }).config.quantile-co.factory.flake.outputs.devShells.default.shellHook;
      selected = [ (toString pkgs.hello) (toString outputs.packages.files) ];
      python = "\${pkgs.python3}/bin/python3";
      libraries = pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux
        (pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib pkgs.zlib ] + ":");
      darwinHook = (f.inputs.nixpkgs.lib.evalModules {
        modules = [ f.nixModules.uv ];
        specialArgs.pkgs = f.inputs.nixpkgs.legacyPackages.aarch64-darwin;
      }).config.quantile-co.factory.uv.shellHook;
      nodePinned = f.packages.\${system}.nodejs_24 == pkgs.nodejs_24;
      bashAlias = f.packages.\${system}.bash == pkgs.bash;
      aggregatePiPinned = configuration.pi.package == f.inputs.llm-agents.packages.\${system}.pi;
      rulesSourcePinned = configuration.semgrep.packs == (pkgs.lib.evalModules {
        modules = [ f.nixModules.semgrep ];
        specialArgs = { inherit pkgs; rulesSource = f.inputs.semgrep-rules; };
      }).config.quantile-co.factory.semgrep.packs;
      namedPiPinned = (pkgs.lib.evalModules {
        modules = [ f.nixModules.pi ];
        specialArgs = { inherit pkgs; llmAgents = f.inputs.llm-agents; };
      }).config.quantile-co.factory.pi.package == f.inputs.llm-agents.packages.\${system}.pi;
      herdrPinned = f.packages.\${system}.herdr == f.inputs.llm-agents.packages.\${system}.herdr;
      herdrInShell = builtins.elem f.packages.\${system}.herdr f.devShells.\${system}.default.nativeBuildInputs;
      optionalTools = map (name: {
        exported = builtins.hasAttr name f.packages.\${system};
        selected = builtins.elem f.packages.\${system}.\${name} f.devShells.\${system}.default.nativeBuildInputs;
      }) [ "curl" "ffmpeg" "yt-dlp" "marimo" "xdg-utils" "libsecret" ];
      lighthouseLinuxOnly = builtins.hasAttr "google-lighthouse" f.packages.aarch64-linux
        && !(builtins.hasAttr "google-lighthouse" f.packages.aarch64-darwin);
    }`);
    expect(wiring.shell).toEqual(wiring.selected);
    expect(wiring.unselectedHook).toBe("");
    expect(wiring.darwinHook).not.toContain("LD_LIBRARY_PATH");
    expect(wiring.nodePinned).toBe(true);
    expect(wiring.bashAlias).toBe(true);
    expect(wiring.herdrPinned).toBe(true);
    expect(wiring.namedPiPinned).toBe(true);
    expect(wiring.aggregatePiPinned).toBe(true);
    expect(wiring.rulesSourcePinned).toBe(true);
    expect(wiring.herdrInShell).toBe(true);
    expect(
      wiring.optionalTools.every(
        (tool: { exported: boolean; selected: boolean }) =>
          tool.exported && !tool.selected,
      ),
    ).toBe(true);
    expect(wiring.lighthouseLinuxOnly).toBe(true);

    const output = execFileSync(
      "nix",
      [
        "build",
        "--no-link",
        "--print-out-paths",
        "--impure",
        "--expr",
        `${expression}outputs.packages.files`,
      ],
      { encoding: "utf8", timeout: 120_000 },
    ).trim();
    execFileSync("git", ["init", "-q"], { cwd: root });
    const nested = join(root, "nested");
    mkdirSync(nested);
    // Replay the same native environment script, as a cached direnv entry does.
    const environment = execFileSync(
      "nix",
      [
        "print-dev-env",
        "--impure",
        "--expr",
        `${expression}outputs.devShells.default`,
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    const enter = () =>
      execFileSync(
        "bash",
        [
          "-c",
          `${environment}
printf '%s\\0%s\\0%s\\0%s\\0%s' "$PI_MEMORY_DIR" "$PI_MEMORY_EXIT_SUMMARY" "$UV_PYTHON" "$UV_PYTHON_DOWNLOADS" "$LD_LIBRARY_PATH"
`,
        ],
        {
          cwd: nested,
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_PATH: "",
            NODE_OPTIONS: "",
            PI_MEMORY_DIR: "/wrong/checkout",
            PI_MEMORY_EXIT_SUMMARY: "1",
            UV_PYTHON: "/wrong/python",
            UV_PYTHON_DOWNLOADS: "automatic",
            LD_LIBRARY_PATH: "/existing/library",
          },
        },
      ).split("\0");
    const expectedEnvironment = [
      join(root, ".pi/memory"),
      "0",
      wiring.python,
      "never",
      `${wiring.libraries}/existing/library`,
    ];
    expect(enter()).toEqual(expectedEnvironment);
    const run = (action: string) =>
      execFileSync(join(output, "bin/factory-files"), [action], {
        cwd: root,
        env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
      });
    expect(readFileSync(join(root, "README.md"), "utf8")).toContain(
      "<h1>Example</h1>",
    );
    execFileSync("git", ["add", "copy.txt", "README.md"], { cwd: root });
    writeFileSync(join(root, "README.md"), "# Repository-owned README\n");
    writeFileSync(join(root, "copy.txt"), "changed copy\n");
    expect(enter()).toEqual(expectedEnvironment);
    run("check");
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe(
      "# Repository-owned README\n",
    );
    expect(readFileSync(join(root, "copy.txt"), "utf8")).toBe("generated\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 180_000);

it("initializes the native downstream starter and preserves repository-owned workspace seeds", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-starter-"));
  try {
    const checkout = `git+${new URL("../../", import.meta.url).href}`;
    // Lock to the immutable Git-filtered store snapshot, not an unlocked dirty checkout.
    const snapshot = execFileSync(
      "nix",
      [
        "eval",
        "--offline",
        "--raw",
        "--impure",
        "--expr",
        `(builtins.getFlake ${JSON.stringify(checkout)}).outPath`,
      ],
      { encoding: "utf8" },
    ).trim();
    const factory = `path:${snapshot}`;
    const options = { cwd: root, encoding: "utf8" as const, timeout: 120_000 };
    execFileSync("git", ["init", "-q"], options);
    execFileSync(
      "nix",
      ["flake", "init", "--offline", "--template", `${factory}#default`],
      options,
    );
    const flake = join(root, "flake.nix");
    writeFileSync(
      flake,
      readFileSync(flake, "utf8").replace(
        '"github:quantile-co/factory"',
        JSON.stringify(factory),
      ),
    );
    execFileSync("git", ["add", "flake.nix"], options);
    execFileSync("nix", ["flake", "lock", "--offline"], options);
    // Cold consumers may need pinned binary-cache tools not yet in this store.
    const environment = execFileSync("nix", ["print-dev-env"], options);
    const enter = () =>
      execFileSync("bash", ["-c", environment], {
        ...options,
        env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
      });
    enter();
    expect(existsSync(join(root, "node_modules"))).toBe(false);
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    );
    const version = execFileSync(
      "nix",
      ["eval", "--offline", "--raw", ".#pnpm.version"],
      options,
    ).trim();
    expect(manifest.packageManager).toBe(`pnpm@${version}`);
    expect(manifest.private).toBe(true);
    expect(readFileSync(join(root, ".envrc"), "utf8")).toContain("use flake");
    const selected = {
      "package.json": `${JSON.stringify({ ...manifest, name: "reviewed-project" }, null, 2)}\n`,
      "pnpm-workspace.yaml": `${readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")}# Repository-owned workspace.\n`,
      "turbo.json": `${JSON.stringify({ ...JSON.parse(readFileSync(join(root, "turbo.json"), "utf8")), ui: "stream" }, null, 2)}\n`,
    };
    execFileSync("git", ["add", "."], options);
    for (const [name, contents] of Object.entries(selected))
      writeFileSync(join(root, name), contents);
    enter();
    const files = execFileSync(
      "nix",
      ["build", "--offline", "--no-link", "--print-out-paths", ".#files"],
      options,
    ).trim();
    execFileSync(join(files, "bin/factory-files"), ["check"], options);
    for (const [name, contents] of Object.entries(selected))
      expect(readFileSync(join(root, name), "utf8")).toBe(contents);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 180_000);
