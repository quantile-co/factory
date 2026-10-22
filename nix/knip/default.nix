{ lib, ... }:
{
  options.quantile-co.factory.knip.configFile = lib.mkOption {
    type = lib.types.path;
    default = ../../etc/knip/knip.json;
    description = "Knip configuration template.";
  };
}
