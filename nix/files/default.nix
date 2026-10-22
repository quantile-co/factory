{ pkgs }:
files:
let
  # Interpolation copies local paths into the store and retains derivation references.
  manifest = pkgs.writeText "factory-files.json" (
    builtins.toJSON (
      builtins.mapAttrs (_: file: {
        inherit (file) mode;
        source = "${file.source}";
      }) files
    )
  );
in
pkgs.writeShellApplication {
  name = "factory-files";
  runtimeInputs = [
    pkgs.git
    pkgs.nodejs_24
  ];
  text = ''
    exec node ${./default.ts} "$@" ${manifest}
  '';
}
