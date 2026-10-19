{ config, lib, pkgs, ... }:
let
  cfg = config.quantile.opa;
  prepare = import ./policy.nix;
in
{
  options.quantile.opa = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.open-policy-agent;
      description = "OPA CLI for Rego policy unit tests.";
    };
    test.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "test-opa";
        runtimeInputs = [ cfg.package pkgs.git pkgs.coreutils pkgs.findutils ];
        text = prepare + ''
          if (( ''${#workloads[@]} != 0 )); then
            echo "OPA unit tests do not accept workload pathspecs." >&2
            exit 2
          fi
          test_pattern="^data\\.''${namespace//./\\.}\\.test_"
          opa test -v --fail-on-empty --run "$test_pattern" \
            "$scratch/policy" "''${data_files[@]}"
        '';
      };
      description = "Run only the selected namespace's Rego unit tests, failing on empty selection.";
    };
  };
}
