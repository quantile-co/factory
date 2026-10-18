{ lib, ... }:
{
  options.quantile.editorconfig.configFile = lib.mkOption {
    type = lib.types.path;
    default = ../../etc/editorconfig/.editorconfig;
    description = "EditorConfig configuration file.";
  };
}
