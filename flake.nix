{
  description = "Quantile software factory";

  inputs = {
    nixpkgs.url = "github:cachix/devenv-nixpkgs/c2f38fe7f9e04d9aadd354d380f2bd40531d9737"; # reviewed rolling revision; never follow the floating branch
    devenv.url = "github:cachix/devenv/fe20b5cba7ab5e93ae73f956a8d3efc50e1753f4?dir=src/modules";
    git-hooks.url = "github:cachix/git-hooks.nix/a0e4241b51206fbcbf52fd322eb5f0cd80f153c4";
    go-overlay.url = "github:purpleclay/go-overlay/8e136930a2a34c501d612f7b7b0ee8806531768f";
    llm-agents.url = "github:numtide/llm-agents.nix/ba24820b562c0e1ff95d283a2e2e1debcbcbad83";
    mk-shell-bin.url = "github:rrbutani/nix-mk-shell-bin/ff5d8bd4d68a347be5042e2f16caee391cd75887";
    nix2container.url = "github:nlewo/nix2container/4e83e6724dcb9eb1b3e855426fa4c8cd19f5ce5a";
    nix2container.inputs.nixpkgs.follows = "nixpkgs";
  };

  # Consumers can follow these inputs or import the shared Nix modules.
  outputs = inputs: import ./nix { inherit inputs; };
}
