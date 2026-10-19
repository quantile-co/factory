# Shared OPA/Conftest Rego selection. Both commands validate and isolate exactly
# the consumer-selected policy before invoking their respective CLIs.
''
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
''
