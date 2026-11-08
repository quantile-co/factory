{ lib, ... }:
{
  options.quantile-co.factory.pylint.configFile = lib.mkOption {
    type = lib.types.path;
    default = ../../etc/pylint/pylint.toml;
    description = "Pylint configuration template; callers select the project-local CLI.";
  };
}
