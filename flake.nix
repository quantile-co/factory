{
  description = "Quantile software factory";

  # Moving refs propose updates; flake.lock fixes exact revisions.
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
      factory = import ./nix { inherit inputs; };
    in
    factory
    // factory.lib.mkFlake {
      inherit (inputs) nixpkgs;
      modules = [ factory.nixModules.default ];
      nixpkgsConfig.allowUnfree = true;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      perSystem =
        { pkgs, factory }:
        let
          herdr = inputs.llm-agents.packages.${pkgs.stdenv.hostPlatform.system}.herdr;
          copy = source: {
            inherit source;
            mode = "copy";
          };
        in
        {
          # Public flake packages for downstreams; this does not install them in the shell.
          packages = {
            inherit herdr;
            inherit (pkgs) bash coreutils diffutils;
            inherit (pkgs)
              direnv
              git
              jq
              nix
              shfmt
              ;
            inherit (pkgs) age gh lnav;
            inherit (pkgs) bear cmake meson;
            inherit (pkgs) ninja pkg-config;
            inherit (pkgs) delve gdb valgrind;
            inherit (pkgs) go gopls gotools;
            inherit (pkgs) go-mockery;
            inherit (pkgs) nodejs_24 pnpm;
            inherit (pkgs) python3 uv;
            inherit (pkgs) buf sqlc templ;
            inherit (pkgs) container-structure-test docker-client skopeo;
            inherit (pkgs) k9s kubernetes-helm kustomize;
            inherit (pkgs) minikube tilt;
            inherit (pkgs) google-cloud-sdk ngrok;
            inherit (pkgs) nssTools stripe-cli;
            inherit (pkgs) duckdb postgresql;
            amp = factory.amp.package;
            clickhouse = factory.clickhouse.package;
            clickhousectl = factory.clickhousectl.package;
            hunk = factory.hunk.package;
            langfuse = factory.langfuse.package;
            tailscale = factory.tailscale.package;
            github-workflow-plan = factory.github.workflows.plan.package;
            github-workflow-apply = factory.github.workflows.apply.package;
          };

          # Only tools and configuration used to develop Factory itself.
          devShell = {
            packages =
              (with pkgs; [
                bash
                coreutils
                diffutils
                direnv
                git
                git-lfs
                jq
                nix
                nodejs_24
                pnpm
                conftest
                gh
                google-cloud-sdk
                opentofu
                tflint
                actionlint
                semgrep
                shellcheck
                shfmt
                taplo
                trivy
                typos
                vale
                yamllint
              ])
              ++ [ herdr ]
              ++ (with factory; [
                amp.package
                clickhouse.package
                clickhousectl.package
                hunk.package
                langfuse.package
                tailscale.package
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

            # Committed regular files; direnv refreshes copy entries on shell entry.
            files = {
              "README.md" = {
                source = factory.readme.withProject {
                  name = "Quantile factory";
                  description = "Quantile software factory";
                };
                mode = "seed";
              };
              ".gitignore" = copy factory.git.ignoreFile;
              ".envrc" = copy factory.direnv.configFile;
              ".husky/pre-push" = copy factory.husky.prePushFile;
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
                    "src/**/*.ts"
                  ];
                }
              );
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
              ".pi/extensions" = copy factory.pi.extensionsDir;
              ".pi/skills/deploy" = copy (factory.pi.skillsDir + "/deploy");
              ".pi/skills/day-zero-deploy" = copy (factory.pi.skillsDir + "/day-zero-deploy");
              ".qmd/index.yml" = {
                source = factory.qmd.configFile;
                mode = "seed";
              };
              ".semgrep/tf" = copy (factory.semgrep.rulesDir + "/tf");
              ".semgrep/packs/typescript.yaml" = copy factory.semgrep.packs.typescript;
              ".semgrep/packs/terraform.yaml" = copy factory.semgrep.packs.terraform;
              ".semgrep/packs/github-actions.yaml" = copy factory.semgrep.packs.github-actions;
              ".semgrepignore" = copy factory.semgrep.ignoreFile;
            };
          };
        };
    };
}
