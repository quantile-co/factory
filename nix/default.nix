{ inputs }:
let
  modules = {
    gcp = import ./gcp.nix;
    github = import ./github.nix;
    json = import ./json.nix;
    pi = import ./pi.nix { llmAgents = inputs.llm-agents; };
    semgrep = import ./semgrep.nix;
    tf = import ./tf.nix;
    ts = import ./ts.nix;
  };
  defaultModule = { ... }: {
    imports = builtins.attrValues modules;
  };
  devenvOutputs = import ./devenv.nix { inherit inputs; };
  packages = builtins.mapAttrs (system: existing:
    let
      pkgs = import inputs.nixpkgs { inherit system; };
      tools = (pkgs.lib.evalModules {
        modules = [ defaultModule ];
        specialArgs = { inherit pkgs; };
      }).config.quantile;
    in
    existing // {
      check = pkgs.writeShellApplication {
        name = "factory-check";
        runtimeInputs = [
          tools.github.actionlint.check.package
          tools.semgrep.check.package
          tools.tf.check.package
        ];
        text = ''
          nix flake check path:.
          check-actionlint
          check-semgrep
          check-terraform
        '';
      };
      plan = tools.tf.plan.package;
      apply = tools.tf.apply.package;
    }) devenvOutputs.packages;
in
{
  flakeInputs = inputs;
  nixModules = modules // { default = defaultModule; };
  inherit packages;
}
