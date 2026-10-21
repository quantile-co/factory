{ rulesSource }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  # Registry packs are curated selections, not language directories. This inventory
  # preserves their exact membership; lock updates fail if a selected rule vanishes.
  inventory = ../../etc/semgrep/packs.json;
  packNames = builtins.attrNames (builtins.fromJSON (builtins.readFile inventory));
  packs =
    pkgs.runCommand "semgrep-packs"
      {
        nativeBuildInputs = [ (pkgs.python3.withPackages (ps: [ ps.pyyaml ])) ];
      }
      ''
        mkdir -p "$out"
        python - ${inventory} ${rulesSource} "$out" <<'PY'
        import json
        import sys
        from pathlib import Path
        import yaml

        inventory, source, output = map(Path, sys.argv[1:])
        documents = {}
        for pack, entries in json.loads(inventory.read_text()).items():
            rules = []
            for rule_id, relative_path in entries.items():
                if relative_path not in documents:
                    documents[relative_path] = yaml.safe_load((source / relative_path).read_text())["rules"]
                matches = [
                    rule for rule in documents[relative_path]
                    if rule_id == rule["id"] or rule_id.endswith("." + rule["id"])
                ]
                if len(matches) != 1:
                    raise ValueError(f"{pack}: expected exactly one {rule_id} in {relative_path}")
                rules.append({**matches[0], "id": rule_id})
            (output / f"{pack}.json").write_text(json.dumps({"rules": rules}) + "\n")
        PY
      '';
in
{
  options.quantile.semgrep = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.semgrep;
      description = "Semgrep CLI.";
    };

    packs = lib.mkOption {
      type = lib.types.attrsOf lib.types.path;
      default = lib.genAttrs packNames (name: "${packs}/${name}.json");
      description = "Pinned local rule configurations, keyed by registry pack name.";
    };

    check.configs = lib.mkOption {
      type = lib.types.listOf lib.types.path;
      default = [ ];
      description = "Additional local rule configurations; select packs here explicitly.";
    };

    rulesDir = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/semgrep/rules;
      description = "Semgrep rules directory.";
    };

    ignoreFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/semgrep/.semgrepignore;
      description = "Semgrep ignore template.";
    };

    test.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "test-semgrep";
        runtimeInputs = [
          config.quantile.semgrep.package
          pkgs.jq
        ];
        text = ''
          set -euo pipefail
          export SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0
          rules="''${SEMGREP_RULES_DIR:-.semgrep}"
          tests="''${SEMGREP_TESTS_DIR:-$rules}"
          test -e "$rules" && test -e "$tests" || { echo 'Semgrep rules or fixtures not found.' >&2; exit 1; }
          results=$(semgrep --test "$tests" --config "$rules" --metrics off --json) || {
            printf '%s\n' "$results" >&2
            echo 'Semgrep rule tests failed.' >&2
            exit 1
          }
          printf '%s\n' "$results" |
            jq -er 'if ([.results[].checks[]] | length) == 0 then error("No Semgrep rule tests selected.") elif all(.results[].checks[]; .passed) then "Semgrep rule tests passed." else error("Semgrep rule tests failed.") end'
        '';
      };
      description = "Run selected rule fixtures; SEMGREP_TESTS_DIR can select a separate directory.";
    };

    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-semgrep";
        runtimeInputs = [ config.quantile.semgrep.package ];
        text = ''
          set -euo pipefail
          export SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0
          rules="''${SEMGREP_RULES_DIR:-.semgrep}"
          test -e "$rules" || { echo 'Semgrep rules not found.' >&2; exit 1; }
          if [ "$#" -eq 0 ]; then set -- .; fi
          semgrep scan --config "$rules" \
            ${
              lib.concatMapStringsSep " " (
                path: "--config ${lib.escapeShellArg (toString path)}"
              ) config.quantile.semgrep.check.configs
            } \
            --metrics off --no-rewrite-rule-ids --jobs 1 \
            --error --strict --scan-unknown-extensions --quiet -- "$@"
        '';
      };
      description = "Scan selected source with local rules and native ignore policy.";
    };
  };
}
