{ inputs }:
let
  modules = {
    engram = import ./engram.nix;
    gcp = import ./gcp.nix;
    github = import ./github.nix;
    json = import ./json.nix;
    pi = import ./pi.nix { llmAgents = inputs.llm-agents; };
    tf = import ./tf.nix;
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
}
