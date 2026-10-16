{ config, inputs, lib, ... }:
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
        nix flake check path:.
        ${lib.getExe config.quantile.github.actionlint.check.package}
        ${lib.getExe config.quantile.semgrep.check.package}
        ${lib.getExe config.quantile.tf.check.package}
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
