{ inputs }:
let
  modules = {
    gcp = import ./gcp.nix;
    github = import ./github.nix;
    json = import ./json.nix;
    pi = import ./pi.nix { llmAgents = inputs.llm-agents; };
    semgrep = import ./semgrep.nix;
    tf = import ./tf;
    ts = import ./ts.nix;
  };
in
{
  flakeInputs = inputs;
  nixModules = modules // {
    default = { ... }: {
      imports = builtins.attrValues modules;
    };
  };
} // import ./devenv.nix { inherit inputs; }
