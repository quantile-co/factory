{ config, inputs, ... }:
{
  imports = [ inputs.factory.nixModules.default ];

  packages = [
    config.quantile.tf.opentofu.package
    config.quantile.gcp.gcloud.package
    config.quantile.github.gh.package
    config.quantile.json.jq.package
    config.quantile.pi.package
    config.quantile.pi.npm.package
    config.quantile.semgrep.package
  ];

  files.".pi/settings.json".source = config.quantile.pi.settingsFile;
  files.".semgrep".source = config.quantile.semgrep.rulesDir;
}
