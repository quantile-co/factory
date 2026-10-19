{ inputs }:
let
  modules = {
    actionlint = ./actionlint;
    biome = ./biome;
    buf = ./buf;
    checkov = ./checkov;
    clang-format = ./clang-format;
    clang-tidy = ./clang-tidy;
    commitizen = ./commitizen;
    conftest = ./conftest;
    deadnix = ./deadnix;
    duckdb = ./duckdb;
    editorconfig = ./editorconfig;
    gcloud = ./gcloud;
    gh = ./gh;
    git = ./git;
    gitleaks = ./gitleaks;
    go = ./go;
    gofumpt = ./gofumpt;
    golangci-lint = ./golangci-lint;
    jq = ./jq;
    kubectl = ./kubectl;
    kubeconform = ./kubeconform;
    keep-sorted = ./keep-sorted;
    lnav = ./lnav;
    markdownlint-cli2 = ./markdownlint-cli2;
    mypy = ./mypy;
    nix = ./nix;
    nixfmt = ./nixfmt;
    nodejs = ./nodejs;
    nss = ./nss;
    opa = ./opa;
    opentofu = ./opentofu;
    pi = import ./pi { llmAgents = inputs.llm-agents; };
    pnpm = ./pnpm;
    postgresql = ./postgresql;
    prek = ./prek;
    prettier = ./prettier;
    protoc = ./protoc;
    python = ./python;
    qmd = import ./qmd { llmAgents = inputs.llm-agents; };
    ruff = ./ruff;
    secretspec = import ./secretspec { devenvCli = inputs.devenv-cli; };
    semgrep = ./semgrep;
    shellcheck = ./shellcheck;
    statix = ./statix;
    trivy = ./trivy;
    uv = ./uv;
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
