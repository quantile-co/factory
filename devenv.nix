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
    config.quantile.ts.node.package
    config.quantile.tf.conftest.package
    config.quantile.tf.trivy.package
    config.quantile.semgrep.package
  ];

  files.".github/actionlint.yaml".source = config.quantile.github.actionlint.configFile;
  files.".pi/settings.json".source = config.quantile.pi.settingsFile;
  files.".semgrep".source = config.quantile.semgrep.rulesDir;

  tasks = {
    "check:all" = {
      description = "Run all checks.";
      after = [ "devenv:files" ];
      env.SEMGREP_FIXTURES_DIR = "etc/semgrep";
      exec = ''
        ${lib.getExe pkgs.nix} flake check path:.
        ${lib.getExe config.quantile.github.actionlint.check.package}
        ${lib.getExe config.quantile.semgrep.check.package}
        ${lib.getExe config.quantile.tf.check.package}
        ${lib.getExe config.quantile.tf.conftest.package} test --no-color --policy tf --namespace terraform.repository tf/main.tf
        ${lib.getExe config.quantile.tf.conftest.package} test --no-color --policy tf/project --namespace terraform.project tf/project/main.tf
        ${config.quantile.ts.node.package}/bin/npm ci --ignore-scripts --no-audit --no-fund
        ${config.quantile.ts.node.package}/bin/npm run typecheck
      '';
    };

    "test:all" = {
      description = "Run all tests.";
      exec = ''
        ${lib.getExe config.quantile.tf.conftest.package} verify --no-color --policy tf
        ${config.quantile.ts.node.package}/bin/npm ci --ignore-scripts --no-audit --no-fund
        ${config.quantile.ts.node.package}/bin/npm test
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
