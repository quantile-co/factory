{
  description = "Quantile software factory";

  # Pinned upstream sources; exact revisions live in flake.lock.
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    llm-agents.url = "github:numtide/llm-agents.nix/main";
    semgrep-rules = {
      url = "github:semgrep/semgrep-rules/develop";
      flake = false;
    };
  };

  outputs =
    inputs:
    let
      lib = inputs.nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      # This repository's selections, using the same modules exposed to consumers.
      project =
        { config, pkgs, ... }:
        let
          factory = config.quantile-co.factory;
          agents = inputs.llm-agents.packages.${pkgs.stdenv.hostPlatform.system};
          copy = source: {
            inherit source;
            mode = "copy";
          };
        in
        {
          quantile-co.factory = {
            github.workflows.layers = [ "infrastructure" ];

            # Public package outputs.
            flake.packages = {
              amp = agents.amp;
              herdr = agents.herdr;
              hunk = agents.hunk;
              bash = pkgs.bash;
              coreutils = pkgs.coreutils;
              diffutils = pkgs.diffutils;
              curl = pkgs.curl;
              ffmpeg = pkgs.ffmpeg;
              yt-dlp = pkgs.yt-dlp;
              marimo = pkgs.marimo;
              # The CLI's Nixpkgs metadata omits its Chromium platform restriction.
              google-lighthouse = pkgs.google-lighthouse.overrideAttrs (previous: {
                meta = previous.meta // {
                  inherit (pkgs.chromium.meta) platforms;
                };
              });
              xdg-utils = pkgs.xdg-utils;
              libsecret = pkgs.libsecret;
              direnv = pkgs.direnv;
              git = pkgs.git;
              jq = pkgs.jq;
              nix = pkgs.nix;
              shfmt = pkgs.shfmt;
              age = pkgs.age;
              gh = pkgs.gh;
              lnav = pkgs.lnav;
              bear = pkgs.bear;
              cmake = pkgs.cmake;
              meson = pkgs.meson;
              ninja = pkgs.ninja;
              pkg-config = pkgs.pkg-config;
              delve = pkgs.delve;
              gdb = pkgs.gdb;
              valgrind = pkgs.valgrind;
              go = pkgs.go;
              gopls = pkgs.gopls;
              gotools = pkgs.gotools;
              go-mockery = pkgs.go-mockery;
              nodejs_24 = pkgs.nodejs_24;
              pnpm = pkgs.pnpm;
              python3 = pkgs.python3;
              uv = pkgs.uv;
              buf = pkgs.buf;
              sqlc = pkgs.sqlc;
              templ = pkgs.templ;
              container-structure-test = pkgs.container-structure-test;
              docker-client = pkgs.docker-client;
              skopeo = pkgs.skopeo;
              k9s = pkgs.k9s;
              kubernetes-helm = pkgs.kubernetes-helm;
              kustomize = pkgs.kustomize;
              minikube = pkgs.minikube;
              tilt = pkgs.tilt;
              google-cloud-sdk = pkgs.google-cloud-sdk;
              ngrok = pkgs.ngrok;
              nssTools = pkgs.nssTools;
              stripe-cli = pkgs.stripe-cli;
              duckdb = pkgs.duckdb;
              postgresql = pkgs.postgresql;
              clickhouse = pkgs.clickhouse;
              tailscale = pkgs.tailscale;
              clickhousectl = factory.clickhousectl.package;
              langfuse = factory.langfuse.package;
            };

            # Development tools and ordered shell initialization.
            flake.devShell = {
              shellHook = lib.concatStringsSep "\n" [
                factory.files.shellHook
                factory.pi.shellHook
              ];
              packages = [
                pkgs.bash
                pkgs.coreutils
                pkgs.gnutar
                pkgs.gzip
                pkgs.diffutils
                pkgs.direnv
                pkgs.git
                pkgs.git-lfs
                pkgs.jq
                pkgs.nix
                pkgs.nodejs_24
                pkgs.pnpm
                pkgs.conftest
                pkgs.gh
                pkgs.google-cloud-sdk
                pkgs.gitleaks
                pkgs.opentofu
                pkgs.tflint
                pkgs.actionlint
                pkgs.semgrep
                pkgs.shellcheck
                pkgs.shfmt
                pkgs.taplo
                pkgs.trivy
                pkgs.typos
                pkgs.vale
                pkgs.yamllint
                agents.herdr
                agents.amp
                agents.hunk
                pkgs.clickhouse
                pkgs.tailscale
                factory.clickhousectl.package
                factory.langfuse.package
                factory.pi.package
                factory.qmd.package
                factory.prek.package
                factory.prek.tools.package
                factory.dependabot.check.package
                factory.prek.check.package
                factory.nixfmt.check.package
                factory.deadnix.check.package
                factory.statix.check.package
                factory.editorconfig.check.package
                factory.shellcheck.check.package
                factory.shfmt.check.package
                factory.markdownlint-cli2.check.package
                factory.actionlint.check.package
                factory.semgrep.test.package
                factory.semgrep.check.package
                factory.trivy.check.package
                factory.typos.check.package
                factory.vale.check.package
                factory.yamllint.check.package
                factory.taplo.check.package
                factory.taplo.format.package
                factory.opentofu.nonempty.package
                factory.opentofu.format.package
                factory.opentofu.check.package
                factory.tflint.check.package
                factory.conftest.check.package
                factory.opentofu.fix.package
                factory.nixfmt.fix.package
                factory.shfmt.fix.package
                factory.taplo.fix.package
                factory.editorconfig.fix.package
              ];
            };

            # Native configuration: managed copies and repository-owned seeds.
            files.entries = {
              "README.md" = {
                source = factory.readme.withProject {
                  name = "Quantile factory";
                  description = "Quantile software factory";
                };
                mode = "seed";
              };
              "package.json" = {
                source = factory.pnpm.packageJsonFile;
                mode = "seed";
              };
              "pnpm-workspace.yaml" = {
                source = factory.pnpm.workspaceFile;
                mode = "seed";
              };
              "turbo.json" = {
                source = factory.turbo.configFile;
                mode = "seed";
              };
              "LICENSE" = copy factory.license.mitFile;
              ".gitignore" = copy factory.git.ignoreFile;
              ".envrc" = copy factory.direnv.configFile;
              ".husky/pre-push" = copy factory.husky.prePushFile;
              ".editorconfig" = copy factory.editorconfig.configFile;
              ".editorconfig-checker.json" = copy factory.editorconfig.checker.configFile;
              ".markdownlint-cli2.jsonc" = copy factory.markdownlint-cli2.configFile;
              ".pre-commit-config.yaml" = copy factory.prek.configFile;
              ".gitleaks.toml" = copy factory.gitleaks.configFile;
              ".cz.toml" = copy factory.commitizen.configFile;
              ".shellcheckrc" = copy factory.shellcheck.configFile;
              ".tflint.hcl" = copy factory.tflint.configFile;
              "statix.toml" = copy (
                pkgs.writeText "statix.toml" ''
                  # Prefer explicit, qualified package assignments in this repository.
                  disabled = ["manual_inherit_from"]
                ''
              );
              "taplo.toml" = copy factory.taplo.configFile;
              "trivy.yaml" = copy factory.trivy.configFile;
              "typos.toml" = copy factory.typos.configFile;
              ".vale.ini" = copy factory.vale.configFile;
              ".vale" = copy factory.vale.stylesDirectory;
              ".yamllint.yaml" = copy factory.yamllint.configFile;
              "biome.json" = copy factory.biome.configFile;
              "tsconfig.json" = copy (
                factory.typescript.withOverrides {
                  compilerOptions = {
                    module = "ESNext";
                    moduleResolution = "Bundler";
                    allowImportingTsExtensions = true;
                    types = [ "node" ];
                  };
                  include = [
                    "*.test.ts"
                    "nix/**/*.test.ts"
                    "tf/**/*.test.ts"
                    "apps/**/*.ts"
                    "packages/**/*.ts"
                  ];
                  exclude = [
                    "**/dist/**"
                    "**/node_modules/**"
                  ];
                }
              );
              ".github/actionlint.yaml" = copy factory.actionlint.configFile;
              ".github/workflows/check.yaml" = copy factory.github.workflows.check.configFile;
              ".github/workflows/test.yaml" = copy factory.github.workflows.test.configFile;
              ".github/workflows/build.yaml" = copy ./etc/github/workflows/build-packages.yaml;
              ".github/workflows/plan.yaml" = copy factory.github.workflows.plan.configFile;
              ".github/workflows/apply.yaml" = copy factory.github.workflows.apply.configFile;
              ".github/dependabot.yml" = copy (
                factory.dependabot.withUpdates [
                  "github-actions"
                  "npm"
                  "opentofu"
                  "nix"
                ]
              );
              ".pi/settings.json" = copy factory.pi.settingsFile;
              ".qmd/index.yml" = {
                source = factory.qmd.configFile;
                mode = "seed";
              };
              ".semgrep/tf" = copy (factory.semgrep.rulesDir + "/tf");
              ".semgrep/tests/tf" = copy (factory.semgrep.test.fixturesDir + "/tf");
              ".semgrep/packs/typescript.yaml" = copy factory.semgrep.packs.typescript;
              ".semgrep/packs/terraform.yaml" = copy factory.semgrep.packs.terraform;
              ".semgrep/packs/github-actions.yaml" = copy factory.semgrep.packs.github-actions;
              ".semgrepignore" = copy factory.semgrep.ignoreFile;
            };
          };
        };

      # Evaluate the module configuration once for each supported system.
      configurations = lib.genAttrs systems (
        system:
        (lib.evalModules {
          specialArgs = {
            pkgs = import inputs.nixpkgs {
              inherit system;
              config.allowUnfree = true;
            };
            factoryInputs = inputs;
          };
          modules = [
            ./nix
            project
          ];
        }).config.quantile-co.factory.flake.outputs
      );
    in
    {
      # Native module entry points for consumers.
      nixModules = {
        default = ./nix;
        actionlint = ./nix/actionlint;
        biome = ./nix/biome;
        checkov = ./nix/checkov;
        clang-format = ./nix/clang-format;
        clang-tidy = ./nix/clang-tidy;
        clickhousectl = ./nix/clickhousectl;
        commitizen = ./nix/commitizen;
        conftest = ./nix/conftest;
        deadnix = ./nix/deadnix;
        dependabot = ./nix/dependabot;
        direnv = ./nix/direnv;
        editorconfig = ./nix/editorconfig;
        emscripten = ./nix/emscripten;
        files = ./nix/files;
        firebase = ./nix/firebase;
        flake = ./nix/flake;
        git = ./nix/git;
        github = ./nix/github;
        gitleaks = ./nix/gitleaks;
        gofumpt = ./nix/gofumpt;
        goimports = ./nix/goimports;
        golangci-lint = ./nix/golangci-lint;
        husky = ./nix/husky;
        keep-sorted = ./nix/keep-sorted;
        knip = ./nix/knip;
        kubeconform = ./nix/kubeconform;
        kubectl = ./nix/kubectl;
        langfuse = ./nix/langfuse;
        license = ./nix/license;
        markdownlint-cli2 = ./nix/markdownlint-cli2;
        mypy = ./nix/mypy;
        nixfmt = ./nix/nixfmt;
        opa = ./nix/opa;
        opentofu = ./nix/opentofu;
        pi = ./nix/pi;
        playwright = ./nix/playwright;
        pnpm = ./nix/pnpm;
        prek = ./nix/prek;
        prettier = ./nix/prettier;
        protoc = ./nix/protoc;
        qmd = ./nix/qmd;
        readme = ./nix/readme;
        resend-cli = ./nix/resend-cli;
        ruff = ./nix/ruff;
        semgrep = ./nix/semgrep;
        shellcheck = ./nix/shellcheck;
        shfmt = ./nix/shfmt;
        statix = ./nix/statix;
        taplo = ./nix/taplo;
        tflint = ./nix/tflint;
        trivy = ./nix/trivy;
        turbo = ./nix/turbo;
        typescript = ./nix/typescript;
        typos = ./nix/typos;
        vale = ./nix/vale;
        wabt = ./nix/wabt;
        wasm-tools = ./nix/wasm-tools;
        yamllint = ./nix/yamllint;
      };

      templates.default = {
        path = ./etc/flake;
        description = "Minimal Factory-backed pnpm/Turbo workspace.";
        welcomeText = ''
          Initialize Git if needed, then stage flake.nix before evaluating it.
          Run nix develop to create the native configuration seeds.
          Review and stage those files, approve .envrc with direnv allow,
          then run pnpm install to generate this repository's own lockfile.
          Add real app/package tasks before treating an empty task graph as validation.
        '';
      };

      # Project the evaluated per-system outputs into the flake interface.
      packages = builtins.mapAttrs (_: configuration: configuration.packages) configurations;
      devShells = builtins.mapAttrs (_: configuration: configuration.devShells) configurations;
    };
}
