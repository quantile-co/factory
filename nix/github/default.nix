{ lib, pkgs, ... }:
let
  codeQualitySource = lib.fileset.toSource {
    root = ../..;
    fileset = lib.fileset.unions [
      ../../apps/github/code-quality.ts
      ../../packages/github/src/code-quality.ts
    ];
  };
in
{
  imports = [ ./workflows ];

  options.quantile-co.factory.github.codeQuality.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.writeShellApplication {
      name = "github-code-quality";
      runtimeInputs = [ pkgs.nodejs_24 ];
      text = ''
        exec node "${codeQualitySource}/apps/github/code-quality.ts" "$@"
      '';
    };
    description = "CLI for synchronizing GitHub Code Quality findings to one tracking issue.";
  };
}
