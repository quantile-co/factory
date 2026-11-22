{ lib, pkgs, ... }:
{
  options.quantile-co.factory.biome = {
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/biome/default.json;
      description = "Biome configuration template; callers select the CLI.";
    };
    literalAssertionsPluginFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/biome/no-literal-type-assertions.grit;
      description = "Biome GritQL plugin for .biome/no-literal-type-assertions.grit.";
    };
    formatFile = lib.mkOption {
      type = lib.types.functionTo (lib.types.functionTo lib.types.package);
      default =
        name: source:
        pkgs.runCommand name { nativeBuildInputs = [ pkgs.biome ]; } ''
          biome format --indent-style=space --indent-width=2 \
            --stdin-file-path ${lib.escapeShellArg name} < "${source}" > "$out"
        '';
      description = "Format a store-backed source for a native destination filename without modifying the input.";
    };
  };
}
