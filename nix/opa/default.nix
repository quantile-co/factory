{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.opa;
  prepare = ''
    cd "$(git rev-parse --show-toplevel)"
    policy=""
    namespace=""
    policy_files=()
    data_files=()
    workloads=()
    while (( $# > 0 )); do
      case "$1" in
        --policy|--namespace|--policy-file|--data)
          if (( $# < 2 )) || [ -z "$2" ]; then
            echo "Missing value for $1" >&2
            exit 2
          fi
          case "$1" in
            --policy) policy=$2 ;;
            --namespace) namespace=$2 ;;
            --policy-file) policy_files+=("$2") ;;
            --data) data_files+=("$2") ;;
          esac
          shift 2
          ;;
        --) shift; workloads=("$@"); break ;;
        *) echo "Unknown OPA option: $1" >&2; exit 2 ;;
      esac
    done
    if [ -z "$policy" ] || [ ! -d "$policy" ] || [ -L "$policy" ]; then
      echo "Set --policy to a local policy directory." >&2
      exit 2
    fi
    if [[ ! "$namespace" =~ ^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$ ]]; then
      echo "Set --namespace to a dotted Rego package name." >&2
      exit 2
    fi
    for data in "''${data_files[@]}"; do
      if [ ! -e "$data" ]; then echo "Missing OPA data: $data" >&2; exit 2; fi
    done
    scratch=$(mktemp -d)
    trap 'rm -rf -- "$scratch"' EXIT
    mkdir -p "$scratch/policy"
    policy_root=$(realpath -e -- "$policy")
    selected=()
    if (( ''${#policy_files[@]} > 0 )); then
      for relative in "''${policy_files[@]}"; do
        source="$policy_root/$relative"
        if [[ "$relative" != *.rego || "$relative" = /* || ! -f "$source" || -L "$source" ]]; then
          echo "Missing or invalid Rego policy: $relative" >&2
          exit 2
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
      echo "No Rego policies selected." >&2
      exit 1
    fi
    for source in "''${selected[@]}"; do
      relative="''${source#"$policy_root"/}"
      mkdir -p -- "$scratch/policy/$(dirname -- "$relative")"
      cp -- "$source" "$scratch/policy/$relative"
    done
  '';
  runner =
    name: package: command:
    pkgs.writeShellApplication {
      inherit name;
      runtimeInputs = [
        package
        pkgs.git
        pkgs.coreutils
        pkgs.findutils
      ]
      ++ lib.optionals (name == "check-opa") [ pkgs.jq ];
      text = prepare + command;
    };
in
{
  options.quantile.opa = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.open-policy-agent;
      description = "OPA CLI for policy unit tests.";
    };
    conftest.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.conftest;
      description = "Conftest CLI for workload policy checks.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = runner "check-opa" cfg.conftest.package ''
        if (( ''${#workloads[@]} == 0 )); then
          echo "Pass workload Git pathspecs after --." >&2
          exit 2
        fi
        git ls-files --cached --others --exclude-standard -z -- "''${workloads[@]}" > "$scratch/inputs"
        inputs=()
        while IFS= read -r -d "" file; do
          if [ -f "$file" ] && [ ! -L "$file" ]; then inputs+=("$file"); fi
        done < "$scratch/inputs"
        if (( ''${#inputs[@]} == 0 )); then
          echo "No workload inputs selected for OPA namespace $namespace." >&2
          exit 1
        fi
        data_args=()
        for data in "''${data_files[@]}"; do data_args+=(--data "$data"); done
        status=0
        conftest test --output json --policy "$scratch/policy" \
          --namespace "$namespace" "''${data_args[@]}" -- "''${inputs[@]}" \
          > "$scratch/results.json" || status=$?
        cat "$scratch/results.json"
        if (( status != 0 )); then exit "$status"; fi
        jq -e 'length > 0 and all(.[];
          ((.successes // 0) + ((.failures // []) | length) +
          ((.warnings // []) | length) + ((.exceptions // []) | length)) > 0
        )' "$scratch/results.json" > /dev/null || {
          echo "No Conftest checks executed for OPA namespace $namespace." >&2
          exit 1
        }
      '';
      description = "Read-only Git-scoped Conftest check. Pass --policy DIR --namespace NAME [--policy-file REL.rego] [--data FILE] -- PATHSPEC...";
    };
    test.package = lib.mkOption {
      type = lib.types.package;
      default = runner "test-opa" cfg.package ''
        if (( ''${#workloads[@]} != 0 )); then
          echo "OPA unit tests do not accept workload pathspecs." >&2
          exit 2
        fi
        test_pattern="^data\\.''${namespace//./\\.}\\.test_"
        opa test -v --fail-on-empty --run "$test_pattern" \
          "$scratch/policy" "''${data_files[@]}"
      '';
      description = "Run only the selected namespace's Rego unit tests, failing on empty selection. Accepts --policy DIR --namespace NAME [--policy-file REL.rego] [--data FILE].";
    };
  };
}
