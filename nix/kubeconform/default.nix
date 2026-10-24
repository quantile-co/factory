{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.kubeconform;
in
{
  options.quantile-co.factory.kubeconform = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.kubeconform;
      description = "kubeconform CLI.";
    };
    kubernetesVersion = lib.mkOption {
      type = lib.types.nullOr (lib.types.strMatching "[0-9]+\\.[0-9]+\\.[0-9]+");
      default = null;
      description = "Target Kubernetes schema version; select here or with -kubernetes-version.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-k8s";
        runtimeInputs = [ cfg.package ];
        text = ''
          schemas=()
          version=${lib.escapeShellArg (if cfg.kubernetesVersion == null then "" else cfg.kubernetesVersion)}
          while (( $# )); do
            case "$1" in
              -schema-location)
                shift
                if (( $# == 0 )) || [[ -z "$1" || "$1" == default || "$1" == *://* ]]; then
                  echo 'Kubernetes validation requires explicit local schema locations.' >&2
                  exit 2
                fi
                schemas+=( -schema-location "$1" )
                ;;
              -kubernetes-version)
                shift
                if (( $# == 0 )) || [[ ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                  echo 'Kubernetes schema version must be a pinned x.y.z release.' >&2
                  exit 2
                fi
                version=$1
                ;;
              --) shift; break ;;
              -*) echo "Unsupported kubeconform option: $1" >&2; exit 2 ;;
              *) break ;;
            esac
            shift
          done
          if (( ''${#schemas[@]} == 0 )); then
            echo 'Kubernetes validation requires explicit local schema locations; remote fallback is disabled.' >&2
            exit 2
          fi
          if [[ -z "$version" ]]; then
            echo 'Select a pinned Kubernetes schema version with kubeconform.kubernetesVersion or -kubernetes-version.' >&2
            exit 2
          fi
          if (( $# == 0 )); then
            echo 'Select at least one Kubernetes manifest.' >&2
            exit 2
          fi
          exec kubeconform -summary -strict -kubernetes-version "$version" "''${schemas[@]}" -- "$@"
        '';
      };
      description = "Validate Kubernetes manifests.";
    };
  };
}
