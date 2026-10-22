{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.conftest;
  prepare = import ../opa/policy.nix;
in
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
          cfg.package
          pkgs.git
          pkgs.coreutils
          pkgs.findutils
          pkgs.jq
        ];
        text = prepare + ''
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
      };
      description = "Check Rego policy.";
    };
  };
}
