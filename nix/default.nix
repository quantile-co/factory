{ inputs }:
let
  modules = {
    c = import ./c;
    checkov = import ./checkov;
    editorconfig = import ./editorconfig;
    gcp = import ./gcp;
    github = import ./github;
    json = import ./json;
    pi = import ./pi { llmAgents = inputs.llm-agents; };
    qmd = import ./qmd { llmAgents = inputs.llm-agents; };
    secretspec = import ./secretspec { devenvCli = inputs.devenv-cli; };
    semgrep = import ./semgrep;
    tf = import ./tf;
    ts = import ./ts;
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
