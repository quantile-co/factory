{ inputs }:
let
  modules = {
    actionlint = ./actionlint;
    biome = ./biome;
    checkov = ./checkov;
    clang-format = ./clang-format;
    clang-tidy = ./clang-tidy;
    commitizen = ./commitizen;
    conftest = ./conftest;
    deadnix = ./deadnix;
    dependabot = ./dependabot;
    editorconfig = ./editorconfig;
    emscripten = ./emscripten;
    firebase = ./firebase;
    github = ./github;
    git = ./git;
    gitleaks = ./gitleaks;
    gofumpt = ./gofumpt;
    goimports = ./goimports;
    golangci-lint = ./golangci-lint;
    kubectl = ./kubectl;
    kubeconform = ./kubeconform;
    keep-sorted = ./keep-sorted;
    knip = ./knip;
    markdownlint-cli2 = ./markdownlint-cli2;
    mypy = ./mypy;
    nixfmt = ./nixfmt;
    opa = ./opa;
    opentofu = ./opentofu;
    pi = import ./pi { llmAgents = inputs.llm-agents; };
    playwright = ./playwright;
    prek = ./prek;
    prettier = ./prettier;
    protoc = ./protoc;
    qmd = import ./qmd { llmAgents = inputs.llm-agents; };
    resend-cli = ./resend-cli;
    ruff = ./ruff;
    semgrep = import ./semgrep { rulesSource = inputs.semgrep-rules; };
    shellcheck = ./shellcheck;
    shfmt = ./shfmt;
    statix = ./statix;
    taplo = ./taplo;
    tflint = ./tflint;
    trivy = ./trivy;
    typescript = ./typescript;
    typos = ./typos;
    vale = ./vale;
    wabt = ./wabt;
    wasm-tools = ./wasm-tools;
    yamllint = ./yamllint;
  };
in
{
  flakeInputs = inputs;
  lib = {
    mkFiles = import ./files;
    mkFlake = import ./flake;
  };
  nixModules = modules // {
    default = { ... }: {
      imports = builtins.attrValues modules;
    };
  };
}
