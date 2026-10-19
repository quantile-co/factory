{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.dependabot;
  ecosystems = [
    "github-actions"
    "npm"
    "opentofu"
    "nix"
  ];
in
{
  options.quantile.dependabot = {
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/dependabot/dependabot.yml;
      description = "Native Dependabot policy template.";
    };
    withUpdates = lib.mkOption {
      type = lib.types.functionTo lib.types.path;
      default =
        names:
        let
          selected =
            if builtins.isList names && names != [ ] && lib.all builtins.isString names then
              lib.unique names
            else
              throw "dependabot.withUpdates expects a nonempty list of ecosystems";
          filter = lib.concatMapStringsSep " or " (
            name: ".\"package-ecosystem\" == ${builtins.toJSON name}"
          ) selected;
        in
        if
          lib.length selected == lib.length ecosystems && lib.all (name: lib.elem name selected) ecosystems
        then
          cfg.configFile
        else
          pkgs.runCommand "dependabot.yml" { nativeBuildInputs = [ pkgs.yq-go ]; } ''
            set -euo pipefail
            cp -- "${cfg.configFile}" "$out"
            chmod u+w "$out"
            ${lib.concatMapStringsSep "\n" (name: ''
              export UPDATE=${lib.escapeShellArg name}
              count=$(yq -r '[.updates[] | select(."package-ecosystem" == strenv(UPDATE))] | length' "$out")
              if [ "$count" != 1 ]; then
                echo "Expected one native Dependabot update for $UPDATE, found $count." >&2
                exit 1
              fi
            '') selected}
            yq -i '.updates |= map(select(${filter}))' "$out"
          '';
      description = "Select native Dependabot update ecosystems.";
    };
  };
}
