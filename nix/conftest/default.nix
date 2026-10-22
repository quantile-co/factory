{
  config,
  lib,
  pkgs,
  ...
}:
{
  options.quantile-co.factory.conftest = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.conftest;
      description = "Conftest CLI for workload policy checks.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-opa";
        runtimeInputs = [
          config.quantile-co.factory.conftest.package
          pkgs.git
          pkgs.coreutils
          pkgs.findutils
          pkgs.jq
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          policy="" namespace=""
          policy_files=() data_args=() workloads=()
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
                  --data)
                    if [ ! -e "$2" ]; then echo "Missing Conftest data: $2" >&2; exit 2; fi
                    data_args+=(--data "$2") ;;
                esac
                shift 2 ;;
              --) shift; workloads=("$@"); break ;;
              *) echo "Unknown Conftest option: $1" >&2; exit 2 ;;
            esac
          done
          if [ -z "$policy" ] || [ ! -d "$policy" ] || [ -L "$policy" ]; then
            echo 'Set --policy to a local policy directory.' >&2; exit 2
          fi
          if [[ ! "$namespace" =~ ^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$ ]]; then
            echo 'Set --namespace to a dotted Rego package name.' >&2; exit 2
          fi
          policy_root=$(realpath -e -- "$policy")
          policy_args=()
          if (( ''${#policy_files[@]} )); then
            for relative in "''${policy_files[@]}"; do
              source="$policy_root/$relative"
              if [[ "$relative" != *.rego || "$relative" = /* || ! -f "$source" || -L "$source" ]]; then
                echo "Missing or invalid Rego policy: $relative" >&2; exit 2
              fi
              resolved=$(realpath -e -- "$source")
              case "$resolved" in
                "$policy_root"/*) policy_args+=(--policy "$resolved") ;;
                *) echo "Rego policy escapes --policy: $relative" >&2; exit 2 ;;
              esac
            done
          else
            while IFS= read -r -d "" source; do policy_args+=(--policy "$source"); done \
              < <(find "$policy_root" -type f -name '*.rego' -print0)
          fi
          if (( ''${#policy_args[@]} == 0 )); then
            echo 'No Rego policies selected.' >&2; exit 1
          fi
          if (( ''${#workloads[@]} == 0 )); then
            echo 'Pass workload Git pathspecs after --.' >&2; exit 2
          fi
          inputs=()
          while IFS= read -r -d "" file; do
            if [ -f "$file" ] && [ ! -L "$file" ]; then inputs+=("$file"); fi
          done < <(git ls-files --cached --others --exclude-standard -z -- "''${workloads[@]}")
          if (( ''${#inputs[@]} == 0 )); then
            echo "No workload inputs selected for OPA namespace $namespace." >&2; exit 1
          fi
          # Pass only selected Rego files, not a directory containing unrelated data.
          status=0
          results=$(conftest test --output json "''${policy_args[@]}" \
            --namespace "$namespace" "''${data_args[@]}" -- "''${inputs[@]}") || status=$?
          printf '%s\n' "$results"
          if (( status != 0 )); then exit "$status"; fi
          jq -e 'length > 0 and all(.[];
            ((.successes // 0) + ((.failures // []) | length) +
            ((.warnings // []) | length) + ((.exceptions // []) | length)) > 0
          )' <<< "$results" > /dev/null || {
            echo "No Conftest checks executed for OPA namespace $namespace." >&2; exit 1
          }
        '';
      };
      description = "Check Rego policy.";
    };
  };
}
