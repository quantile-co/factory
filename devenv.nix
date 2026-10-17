{ config, inputs, lib, pkgs, ... }:
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
  ];

  files = {
    ".editorconfig".source = config.quantile.editorconfig.configFile;
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
        ${lib.getExe pkgs.nix} flake check path:.
        ${lib.getExe inputs.factory.packages.${pkgs.stdenv.hostPlatform.system}.check-devenv-locks} flake.lock devenv.lock factory
        if [ "''${CI:-}" = true ]; then
          ${lib.getExe inputs.factory.packages.${pkgs.stdenv.hostPlatform.system}.check-devenv-locks} --git-index flake.lock devenv.lock factory
        fi
        ${lib.getExe config.quantile.github.actionlint.check.package}
        ${lib.getExe config.quantile.semgrep.check.package}
        ${lib.getExe config.quantile.tf.check.package}
        ${lib.getExe config.quantile.tf.conftest.package} test --no-color --policy tf --namespace terraform.repository tf/main.tf
        ${lib.getExe config.quantile.tf.conftest.package} test --no-color --policy tf/project --namespace terraform.project tf/project/main.tf
        ${lib.getExe config.quantile.ts.pnpm.package} install --frozen-lockfile --ignore-scripts
        ${lib.getExe config.quantile.ts.pnpm.package} run typecheck
      '';
    };

    "test:all" = {
      description = "Run all checks, then tests.";
      after = [ "check:all" ];
      exec = ''
        ${lib.getExe config.quantile.ts.pnpm.package} install --frozen-lockfile --ignore-scripts
        ${lib.getExe config.quantile.ts.pnpm.package} test
      '';
    };

    "plan:production" = {
      description = "Plan production infrastructure.";
      exec = lib.getExe config.quantile.tf.plan.package;
    };

    "apply:production" = {
      description = "Plan and apply production infrastructure.";
      exec = lib.getExe config.quantile.tf.apply.package;
    };
  };
}
