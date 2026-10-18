{ config, inputs, lib, pkgs, ... }:
let
  terraformSourceDir = "tf";
  terraformRoots = [ "tf/infrastructure" ];
in
{
  imports = [ inputs.factory.nixModules.default ];

  packages = [
    config.quantile.tf.opentofu.package
    config.quantile.gcp.gcloud.package
    config.quantile.github.gh.package
    config.quantile.github.actionlint.package
    config.quantile.json.jq.package
    config.quantile.pi.package
    config.quantile.pi.npm.package
    config.quantile.qmd.package
    config.quantile.ts.node.package
    config.quantile.ts.pnpm.package
    config.quantile.tf.conftest.package
    config.quantile.tf.trivy.package
    config.quantile.semgrep.package
    config.quantile.secretspec.package
  ];

  # Read the manifest directly from the Nix store; no root secretspec.toml is needed.
  env.SECRETSPEC_FILE = "${config.quantile.secretspec.configFile}";
  enterShell = lib.mkBefore config.quantile.secretspec.shellHook;

  files = {
    ".editorconfig".source = config.quantile.editorconfig.configFile;
    "biome.json".source = config.quantile.ts.biome.configFile;
    ".github/actionlint.yaml".source = config.quantile.github.actionlint.configFile;
    ".github/dependabot.yml" = {
      source = config.quantile.github.dependabot.configFile;
      copyMode = "seed";
    };
    ".pi/settings.json".source = config.quantile.pi.settingsFile;
    ".qmd/index.yml".source = config.quantile.qmd.configFile;
    ".semgrep".source = config.quantile.semgrep.rulesDir;
  };

  tasks = {
    "check:all" = {
      description = "Run all checks.";
      after = [ "devenv:files" ];
      env.SEMGREP_FIXTURES_DIR = "etc/semgrep";
      exec = ''
        ${lib.getExe pkgs.nix} flake check .
        ${lib.getExe inputs.factory.packages.${pkgs.stdenv.hostPlatform.system}.check-devenv-locks} flake.lock devenv.lock factory
        if [ "''${CI:-}" = true ]; then
          ${lib.getExe inputs.factory.packages.${pkgs.stdenv.hostPlatform.system}.check-devenv-locks} --git-index flake.lock devenv.lock factory
        fi
        ${lib.getExe config.quantile.github.actionlint.check.package}
        ${lib.getExe config.quantile.semgrep.check.package}
        ${lib.getExe config.quantile.tf.opentofu.package} -chdir=${lib.escapeShellArg terraformSourceDir} fmt -check -recursive
        ${lib.concatMapStringsSep "\n" (root: ''
          TF_DIR=${lib.escapeShellArg root} ${lib.getExe config.quantile.tf.check.package}
        '') terraformRoots}
        ${lib.getExe config.quantile.tf.conftest.package} test --no-color --policy tf/infrastructure --namespace terraform.infrastructure tf/infrastructure/main.tf
        ${lib.getExe config.quantile.tf.conftest.package} test --no-color --policy tf/modules/project/github --namespace terraform.project.github tf/modules/project/github/main.tf
        ${lib.getExe config.quantile.tf.conftest.package} test --no-color --policy tf/modules/project/gcp --namespace terraform.project.gcp tf/modules/project/gcp/main.tf
        ${lib.getExe config.quantile.ts.pnpm.package} install --frozen-lockfile --ignore-scripts
        ${lib.getExe config.quantile.ts.pnpm.package} run check
      '';
    };

    "fix:all" = {
      description = "Run all fixes.";
      after = [ "devenv:files" ];
      exec = ''
        TF_DIR=${lib.escapeShellArg terraformSourceDir} ${lib.getExe config.quantile.tf.fix.package}
        ${lib.getExe config.quantile.ts.pnpm.package} install --frozen-lockfile --ignore-scripts
        ${lib.getExe config.quantile.ts.pnpm.package} run fix
      '';
    };

    "test:all" = {
      description = "Run all tests.";
      after = [ "check:all" ];
      exec = ''
        ${lib.getExe config.quantile.ts.pnpm.package} install --frozen-lockfile --ignore-scripts
        ${lib.getExe config.quantile.ts.pnpm.package} test
      '';
    };

    "plan:infrastructure" = {
      description = "Plan infrastructure.";
      env.TF_DIR = "tf/infrastructure";
      exec = lib.getExe config.quantile.tf.plan.gcs.package;
    };

    "apply:infrastructure" = {
      description = "Apply infrastructure.";
      env.TF_DIR = "tf/infrastructure";
      exec = lib.getExe config.quantile.tf.apply.gcs.package;
    };
  };
}
