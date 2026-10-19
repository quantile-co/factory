{ inputs }:
let
  modules = {
    actionlint = ./actionlint;
    bear = ./bear;
    biome = ./biome;
    buf = ./buf;
    checkov = ./checkov;
    clang-format = ./clang-format;
    clang-tidy = ./clang-tidy;
    cmake = ./cmake;
    commitizen = ./commitizen;
    conftest = ./conftest;
    deadnix = ./deadnix;
    dependabot = ./dependabot;
    duckdb = ./duckdb;
    editorconfig = ./editorconfig;
    emscripten = ./emscripten;
    gcloud = ./gcloud;
    gdb = ./gdb;
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
    meson = ./meson;
    mypy = ./mypy;
    nix = ./nix;
    ninja = ./ninja;
    nixfmt = ./nixfmt;
    nodejs = ./nodejs;
    nss = ./nss;
    opa = ./opa;
    opentofu = ./opentofu;
    pi = import ./pi { llmAgents = inputs.llm-agents; };
    pkg-config = ./pkg-config;
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
    shfmt = ./shfmt;
    statix = ./statix;
    taplo = ./taplo;
    tflint = ./tflint;
    trivy = ./trivy;
    typescript = ./typescript;
    typos = ./typos;
    uv = ./uv;
    vale = ./vale;
    valgrind = ./valgrind;
    wabt = ./wabt;
    wasm-tools = ./wasm-tools;
    yamllint = ./yamllint;
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
// import ./devenv { inherit inputs; }
