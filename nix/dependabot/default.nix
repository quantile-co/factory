{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.dependabot;
  ecosystems = [
    "github-actions"
    "npm"
    "opentofu"
    "nix"
  ];
in
{
  options.quantile-co.factory.dependabot = {
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/dependabot/dependabot.yml;
      description = "Native Dependabot policy template.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-dependabot";
        runtimeInputs = [
          pkgs.git
          pkgs.coreutils
          pkgs.diffutils
        ];
        text = ''
          if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
            echo 'Usage: check-dependabot EXPECTED_FILE' >&2
            exit 2
          fi
          expected=$(realpath -- "$1")
          cd "$(git rev-parse --show-toplevel)"
          # Check the index: a generated working-copy repair must not hide drift.
          git show :.github/dependabot.yml | cmp -s - "$expected" || {
            echo 'Commit the selected Dependabot configuration.' >&2
            exit 1
          }
        '';
      };
      description = "Compare the indexed Dependabot configuration with a selected native file.";
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
