{
  description = "Quantile software factory";

  inputs = {
    # Moving refs propose updates; flake.lock fixes exact revisions.
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
      shared = import ./nix { inherit inputs; };
    in
    shared
    // shared.lib.mkFlake {
      inherit (inputs) nixpkgs;
      modules = [ shared.nixModules.default ];
      nixpkgsConfig.allowUnfree = true;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      perSystem =
        { pkgs, factory }:
        let
          copy = source: {
            inherit source;
            mode = "copy";
          };
        in
        {
          # Public packages are aliases, not wrappers or an implicit shell bundle.
          exports = {
            inherit (pkgs)
              age
              bash
              bear
              buf
              cmake
              container-structure-test
              coreutils
              delve
              diffutils
              direnv
              docker-client
              duckdb
              gdb
              gh
              go
              gopls
              gotools
              jq
              k9s
              kustomize
              lnav
              meson
              minikube
              ngrok
              ninja
              nix
              pkg-config
              pnpm
              postgresql
              skopeo
              sqlc
              stripe-cli
              templ
              tilt
              uv
              valgrind
              ;
            gcloud = pkgs.google-cloud-sdk;
            helm = pkgs.kubernetes-helm;
            mockery = pkgs.go-mockery;
            nodejs = pkgs.nodejs_24;
            nss = pkgs.nssTools;
            python = pkgs.python3;
            githubWorkflowPlan = factory.github.workflows.plan.package;
            githubWorkflowApply = factory.github.workflows.apply.package;
          };

          packages =
            (with pkgs; [
              bash
              coreutils
              diffutils
              direnv
              nix
              git
              git-lfs
              opentofu
              tflint
              taplo
              google-cloud-sdk
              gh
              actionlint
              shellcheck
              shfmt
              jq
              nodejs_24
              pnpm
              conftest
              trivy
              typos
              vale
              yamllint
              semgrep
            ])
            ++ (with factory; [
              pi.package
              qmd.package
              prek.package
              prek.tools.package
              dependabot.check.package
              prek.check.package
              nixfmt.check.package
              deadnix.check.package
              statix.check.package
              editorconfig.check.package
              shellcheck.check.package
              shfmt.check.package
              markdownlint-cli2.check.package
              actionlint.check.package
              semgrep.test.package
              semgrep.check.package
              trivy.check.package
              typos.check.package
              vale.check.package
              yamllint.check.package
              taplo.check.package
              taplo.format.package
              opentofu.nonempty.package
              opentofu.format.package
              opentofu.check.package
              tflint.check.package
              conftest.check.package
              opentofu.fix.package
              nixfmt.fix.package
              shfmt.fix.package
              taplo.fix.package
              editorconfig.fix.package
            ]);

          # Only configurations used to develop this repository belong in its root.
          files = {
            "tsconfig.json" = copy (
              factory.typescript.withOverrides {
                compilerOptions = {
                  module = "ESNext";
                  moduleResolution = "Bundler";
                  types = [ "node" ];
                };
                include = [
                  "*.test.ts"
                  "nix/**/*.test.ts"
                  "tf/**/*.test.ts"
                ];
              }
            );
            ".editorconfig" = copy factory.editorconfig.configFile;
            ".editorconfig-checker.json" = copy factory.editorconfig.checker.configFile;
            ".markdownlint-cli2.jsonc" = copy factory.markdownlint-cli2.configFile;
            ".pre-commit-config.yaml" = copy factory.prek.configFile;
            ".cz.toml" = copy factory.commitizen.configFile;
            ".shellcheckrc" = copy factory.shellcheck.configFile;
            ".tflint.hcl" = copy factory.tflint.configFile;
            "taplo.toml" = copy factory.taplo.configFile;
            "trivy.yaml" = copy factory.trivy.configFile;
            "typos.toml" = copy factory.typos.configFile;
            ".vale.ini" = copy factory.vale.configFile;
            ".yamllint.yaml" = copy factory.yamllint.configFile;
            "biome.json" = copy factory.biome.configFile;
            ".github/actionlint.yaml" = copy factory.actionlint.configFile;

            ".github/workflows/check.yaml" = copy factory.github.workflows.check.configFile;
            ".github/workflows/test.yaml" = copy factory.github.workflows.test.configFile;
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
            ".pi/skills/deploy" = copy (factory.pi.skillsDir + "/deploy");
            ".pi/skills/day-zero-deploy" = copy (factory.pi.skillsDir + "/day-zero-deploy");
            ".qmd/index.yml" = copy factory.qmd.configFile;

            ".semgrep/tf" = copy (factory.semgrep.rulesDir + "/tf");
            ".semgrep/packs/typescript.yaml" = copy factory.semgrep.packs.typescript;
            ".semgrep/packs/terraform.yaml" = copy factory.semgrep.packs.terraform;
            ".semgrep/packs/github-actions.yaml" = copy factory.semgrep.packs.github-actions;
            ".semgrepignore" = copy factory.semgrep.ignoreFile;
          };
        };
    };
}
