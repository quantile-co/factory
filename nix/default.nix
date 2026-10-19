{ inputs }:
let
  modules = {
    c = import ./c;
    checkov = import ./checkov;
    duckdb = import ./duckdb;
    editorconfig = import ./editorconfig;
    gcp = import ./gcp;
    git = import ./git;
    github = import ./github;
    go = import ./go;
    json = import ./json;
    k8s = import ./k8s;
    keep-sorted = import ./keep-sorted;
    logs = import ./logs;
    markdown = import ./markdown;
    nix = import ./nix;
    opa = import ./opa;
    pi = import ./pi { llmAgents = inputs.llm-agents; };
    postgres = import ./postgres;
    prettier = import ./prettier;
    protobuf = import ./protobuf;
    python = import ./python;
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
} // import ./devenv { inherit inputs; }
