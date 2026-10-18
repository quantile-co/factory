{ inputs }:
let
  modules = {
    editorconfig = import ./editorconfig.nix;
    gcp = import ./gcp.nix;
    github = import ./github.nix;
    json = import ./json.nix;
    pi = import ./pi.nix { llmAgents = inputs.llm-agents; };
    qmd = import ./qmd.nix { llmAgents = inputs.llm-agents; };
    secretspec = import ./secretspec { devenvCli = inputs.devenv-cli; };
    semgrep = import ./semgrep.nix;
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
} // import ./devenv.nix { inherit inputs; }
