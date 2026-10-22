{ pkgs, sourceRoot }:
files:
let
  manifestText = pkgs.writeText "factory-files.json" (
    builtins.toJSON (
      builtins.mapAttrs (_: file: {
        inherit (file) mode;
        source = toString file.source;
      }) files
    )
  );
  # Retain the checkout and generated source paths as Nix inputs, not just JSON text.
  manifest =
    pkgs.runCommand "factory-files.json"
      {
        inherit sourceRoot;
        sourceReferences = pkgs.lib.concatStringsSep " " (
          builtins.map (file: toString file.source) (builtins.attrValues files)
        );
      }
      ''
        cp -- ${manifestText} "$out"
      '';
in
pkgs.writeShellApplication {
  name = "factory-files";
  runtimeInputs = [
    pkgs.git
    pkgs.nodejs
  ];
  text = ''
    exec node ${./files.ts} "$@" ${manifest}
  '';
}
