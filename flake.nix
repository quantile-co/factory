{
  description = "Quantile software factory";

  inputs = {
    # Moving refs propose updates; the committed flake.lock fixes exact revisions.
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
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forEachSystem =
        f:
        inputs.nixpkgs.lib.genAttrs systems (
          system:
          let
            pkgs = inputs.nixpkgs.legacyPackages.${system};
            inherit
              (pkgs.lib.evalModules {
                specialArgs = { inherit pkgs; };
                modules = [ shared.nixModules.default ];
              })
              config
              ;
            cfg = config.quantile-co.factory;
            # Destinations are committed; copy refreshes them when direnv enters.
            copy = source: {
              inherit source;
              mode = "copy";
            };
            files =
              shared.lib.mkFiles
                {
                  inherit pkgs;
                  sourceRoot = inputs.self.outPath;
                }
                {
                  "tsconfig.json" = {
                    source = cfg.typescript.withOverrides {
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
                    };
                    mode = "copy";
                  };
                  ".editorconfig" = copy cfg.editorconfig.configFile;
                  ".editorconfig-checker.json" = copy cfg.editorconfig.checker.configFile;
                  ".markdownlint-cli2.jsonc" = copy cfg.markdownlint-cli2.configFile;
                  ".pre-commit-config.yaml" = copy cfg.prek.configFile;
                  ".cz.toml" = copy cfg.commitizen.configFile;
                  ".shellcheckrc" = copy cfg.shellcheck.configFile;
                  ".tflint.hcl" = copy cfg.tflint.configFile;
                  "taplo.toml" = copy cfg.taplo.configFile;
                  "trivy.yaml" = copy cfg.trivy.configFile;
                  "typos.toml" = copy cfg.typos.configFile;
                  ".vale.ini" = copy cfg.vale.configFile;
                  ".yamllint.yaml" = copy cfg.yamllint.configFile;
                  "biome.json" = copy cfg.biome.configFile;
                  ".github/actionlint.yaml" = copy cfg.actionlint.configFile;

                  ".github/workflows/check.yaml" = copy cfg.github.workflows.check.configFile;
                  ".github/workflows/test.yaml" = copy cfg.github.workflows.test.configFile;
                  ".github/workflows/plan.yaml" = copy cfg.github.workflows.plan.configFile;
                  ".github/workflows/apply.yaml" = copy cfg.github.workflows.apply.configFile;
                  ".github/dependabot.yml" = {
                    source = cfg.dependabot.withUpdates [
                      "github-actions"
                      "npm"
                      "opentofu"
                      "nix"
                    ];
                    mode = "copy";
                  };

                  ".pi/settings.json" = copy cfg.pi.settingsFile;
                  ".pi/skills/deploy" = copy (cfg.pi.skillsDir + "/deploy");
                  ".pi/skills/day-zero-deploy" = copy (cfg.pi.skillsDir + "/day-zero-deploy");
                  ".qmd/index.yml" = copy cfg.qmd.configFile;
                  ".semgrep" = copy cfg.semgrep.rulesDir;
                  ".semgrepignore" = copy cfg.semgrep.ignoreFile;
                };
          in
          f { inherit pkgs cfg files; }
        );
    in
    shared
    // {
      packages = forEachSystem (
        {
          pkgs,
          cfg,
          files,
        }:
        {
          inherit (pkgs) direnv;
          inherit files;
          githubWorkflowPlan = cfg.github.workflows.plan.package;
          githubWorkflowApply = cfg.github.workflows.apply.package;
        }
      );
      devShells = forEachSystem (
        {
          pkgs,
          cfg,
          files,
        }:
        {
          default = pkgs.mkShell {
            packages = [
              files
              pkgs.direnv
            ]
            ++ (with cfg; [
              bash.package
              coreutils.package
              diffutils.package
              nix.package
              git.package
              git.lfs.package
              opentofu.package
              tflint.package
              taplo.package
              gcloud.package
              gh.package
              actionlint.package
              prek.package
              prek.tools.package
              shellcheck.package
              shfmt.package
              jq.package
              pi.package
              nodejs.package
              qmd.package
              pnpm.package
              conftest.package
              trivy.package
              typos.package
              vale.package
              yamllint.package
              semgrep.package
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
          };
        }
      );
    };
}
