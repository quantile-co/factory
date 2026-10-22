{
  config,
  lib,
  pkgs,
  ...
}:
{
  options.quantile-co.factory.opa = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.open-policy-agent;
      description = "OPA CLI for Rego policy unit tests.";
    };
    test.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "test-opa";
        runtimeInputs = [
          config.quantile-co.factory.opa.package
          pkgs.git
          pkgs.coreutils
          pkgs.findutils
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          policy="" namespace=""
          policy_files=() data_files=()
          while (( $# )); do
            case "$1" in
              --policy|--namespace|--policy-file|--data)
                if (( $# < 2 )) || [ -z "$2" ]; then
                  echo "Missing value for $1" >&2; exit 2
                fi
                case "$1" in
                  --policy) policy=$2 ;;
                  --namespace) namespace=$2 ;;
                  --policy-file) policy_files+=("$2") ;;
                  --data) data_files+=("$2") ;;
                esac
                shift 2 ;;
              *) echo "Unknown OPA test option: $1" >&2; exit 2 ;;
            esac
          done
          if [ -z "$policy" ] || [ ! -d "$policy" ] || [ -L "$policy" ]; then
            echo 'Set --policy to a local policy directory.' >&2; exit 2
          fi
          if [[ ! "$namespace" =~ ^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$ ]]; then
            echo 'Set --namespace to a dotted Rego package name.' >&2; exit 2
          fi
          for data in "''${data_files[@]}"; do
            if [ ! -e "$data" ]; then echo "Missing OPA data: $data" >&2; exit 2; fi
          done
          policy_root=$(realpath -e -- "$policy")
          selected=()
          if (( ''${#policy_files[@]} )); then
            for relative in "''${policy_files[@]}"; do
              source="$policy_root/$relative"
              if [[ "$relative" != *.rego || "$relative" = /* || ! -f "$source" || -L "$source" ]]; then
                echo "Missing or invalid Rego policy: $relative" >&2; exit 2
              fi
              resolved=$(realpath -e -- "$source")
              case "$resolved" in
                "$policy_root"/*) selected+=("$resolved") ;;
                *) echo "Rego policy escapes --policy: $relative" >&2; exit 2 ;;
              esac
            done
          else
            while IFS= read -r -d "" source; do selected+=("$source"); done \
              < <(find "$policy_root" -type f -name '*.rego' -print0)
          fi
          if (( ''${#selected[@]} == 0 )); then
            echo 'No Rego policies selected.' >&2; exit 1
          fi
          # Explicit Rego paths prevent OPA from loading incidental JSON/YAML data.
          test_pattern="^data\\.''${namespace//./\\.}\\.test_"
          opa test -v --fail-on-empty --run "$test_pattern" \
            "''${selected[@]}" "''${data_files[@]}"
        '';
      };
      description = "Run only the selected namespace's Rego unit tests, failing on empty selection.";
    };
  };
}
