{
  config,
  lib,
  pkgs,
  ...
}:
{
  options.quantile-co.factory.firebase = {
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/firebase/firebase.json;
      description = "Firebase configuration template.";
    };

    rulesFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/firebase/firestore.rules;
      description = "Deny-all Firestore client Rules.";
    };

    withOverrides = lib.mkOption {
      type = lib.types.functionTo lib.types.package;
      default =
        overrides:
        let
          base = builtins.fromJSON (builtins.readFile config.quantile-co.factory.firebase.configFile);
          source = pkgs.writeText "firebase.json" (builtins.toJSON (lib.recursiveUpdate base overrides));
        in
        config.quantile-co.factory.biome.formatFile "firebase.json" source;
      description = "Render Firebase configuration with project overrides.";
    };
  };
}
