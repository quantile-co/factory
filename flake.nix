{
  description = "Quantile software factory";

  inputs = {
    # Moving refs propose updates; the committed flake.lock fixes exact revisions.
    nixpkgs.url = "github:cachix/devenv-nixpkgs/rolling";
    # The CLI and module must resolve to the same revision (checked in nix/devenv/default.nix).
    devenv.url = "github:cachix/devenv/main?dir=src/modules";
    devenv-cli.url = "github:cachix/devenv/main";
    git-hooks.url = "github:cachix/git-hooks.nix/master";
    go-overlay.url = "github:purpleclay/go-overlay/main";
    llm-agents.url = "github:numtide/llm-agents.nix/main";
    mk-shell-bin.url = "github:rrbutani/nix-mk-shell-bin/main";
    nix2container.url = "github:nlewo/nix2container/master";
    nix2container.inputs.nixpkgs.follows = "nixpkgs";
    semgrep-rules = {
      url = "github:semgrep/semgrep-rules/develop";
      flake = false;
    };
  };

  # Consumers can follow these inputs or import the shared Nix modules.
  outputs = inputs: import ./nix { inherit inputs; };
}
