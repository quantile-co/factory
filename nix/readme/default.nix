{
  config,
  lib,
  pkgs,
  ...
}:
{
  options.quantile-co.factory.readme = {
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/readme/README.md;
      description = "README seed template; existing READMEs remain repository-owned.";
    };
    withProject = lib.mkOption {
      type = lib.types.functionTo lib.types.package;
      default =
        { name, description }:
        pkgs.writeText "README.md" (
          builtins.replaceStrings
            [ "<h1>Project name</h1>" "<p><em>Project description</em></p>" ]
            [ "<h1>${name}</h1>" "<p><em>${description}</em></p>" ]
            (builtins.readFile config.quantile-co.factory.readme.configFile)
        );
      description = "Render a project's README for seed mode, never a managed copy.";
    };
  };
}
