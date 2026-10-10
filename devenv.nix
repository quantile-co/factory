{ config, inputs, ... }:
{
  imports = [ inputs.factory.nixModules.default ];

  packages = [
    config.quantile.tf.opentofu.package
    config.quantile.gcp.gcloud.package
    config.quantile.github.gh.package
    config.quantile.json.jq.package
    config.quantile.ts.node.package
    config.quantile.pi.package
  ];
}
