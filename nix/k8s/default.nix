{ config, lib, pkgs, ... }:
let
  cfg = config.quantile.k8s;
in
{
  options.quantile.k8s = {
    kubectl.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.kubectl;
      description = "kubectl CLI used by the host-plugin-safe wrapper.";
    };
    kubectl.safePackage = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "kubectl";
        text = ''
          IFS=: read -r -a components <<< "$PATH"
          paths=()
          for component in "''${components[@]}"; do
            case "$component" in
              */.krew/bin|*/.krew/bin/) ;;
              *) paths+=("$component") ;;
            esac
          done
          PATH=$(IFS=:; printf '%s' "''${paths[*]}")
          export PATH
          exec ${cfg.kubectl.package}/bin/kubectl "$@"
        '';
      };
      description = "kubectl without inherited .krew/bin plugin paths.";
    };
    kubeconform.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.kubeconform;
      description = "kubeconform CLI.";
    };
    tools = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = [ ];
      description = "Optional Kubernetes client tools; lists can be extended or replaced.";
    };
    packages = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = [ cfg.kubectl.safePackage cfg.kubeconform.package ] ++ cfg.tools;
      description = "Opt-in client packages for a consumer's development shell.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-k8s";
        runtimeInputs = [ cfg.kubeconform.package ];
        text = ''
          schemas=()
          version=${lib.escapeShellArg pkgs.kubectl.version}
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
          if (( $# == 0 )); then
            echo 'Select at least one Kubernetes manifest.' >&2
            exit 2
          fi
          exec kubeconform -summary -strict -kubernetes-version "$version" "''${schemas[@]}" -- "$@"
        '';
      };
      description = "Read-only strict manifest validation with explicit local schemas and no cluster access.";
    };
  };

  config.quantile.k8s.tools = [ pkgs.k9s pkgs.kubernetes-helm pkgs.kustomize pkgs.minikube pkgs.tilt ];
}
