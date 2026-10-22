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

  # Consumers can follow these inputs or import the shared Nix modules.
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
            files = import ./nix/files { inherit config; };
            manifestText = pkgs.writeText "factory-files.json" (
              builtins.toJSON (
                builtins.mapAttrs (_: entry: {
                  inherit (entry) mode;
                  source = toString entry.source;
                }) files
              )
            );
            manifest =
              pkgs.runCommand "factory-files.json"
                {
                  inherit (inputs.self) outPath;
                  sourceReferences = inputs.nixpkgs.lib.concatStringsSep " " (
                    builtins.map (entry: toString entry.source) (builtins.attrValues files)
                  );
                }
                ''
                  cp -- ${manifestText} "$out"
                '';
          in
          f { inherit pkgs config manifest; }
        );
    in
    shared
    // {
      packages = forEachSystem (
        {
          pkgs,
          config,
          manifest,
        }:
        {
          inherit (pkgs) direnv;
          filesManifest = manifest;
          githubWorkflowPlan = config.quantile-co.factory.github.workflows.plan.package;
          githubWorkflowApply = config.quantile-co.factory.github.workflows.apply.package;
        }
      );
      devShells = forEachSystem (
        {
          pkgs,
          config,
          manifest,
        }:
        {
          default = pkgs.mkShell {
            FACTORY_FILES_MANIFEST = "${manifest}";
            packages = with config.quantile-co.factory; [
              pkgs.direnv
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
            ];
          };
        }
      );
    };
}
