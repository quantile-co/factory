{
  config,
  lib,
  pkgs,
  ...
}:
{
  imports = [ ../nodejs ];

  options.quantile.typescript.check.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.writeShellApplication {
      name = "check-typescript";
      runtimeInputs = [
        config.quantile.nodejs.package
        pkgs.git
        pkgs.coreutils
        pkgs.gnugrep
      ];
      text = ''
        root=$(git rev-parse --show-toplevel)
        cd "$root"
        if [ "$#" -eq 0 ]; then
          set -- '*.ts' '*.tsx' '*.mts' '*.cts' \
            ':(exclude,glob)**/node_modules/**' ':(exclude,glob)**/build/**' \
            ':(exclude,glob)**/dist/**' ':(exclude,glob)**/.next/**'
        fi
        selected=()
        while IFS= read -r -d "" file; do
          case "$file" in *.ts|*.tsx|*.mts|*.cts) ;; *) continue ;; esac
          if [ -f "$file" ] && [ ! -L "$file" ]; then selected+=("$file"); fi
        done < <(git ls-files -z -- "$@")
        if [ "''${#selected[@]}" -eq 0 ]; then exit 0; fi

        # Use the closest project tool, including hoisted installs inside this checkout.
        find_tsc() {
          local directory="$1"
          while :; do
            REPLY="$directory/node_modules/.bin/tsc"
            if [[ -e "$REPLY" || -L "$REPLY" ]]; then
              if [[ ! -x "$REPLY" ]]; then
                echo "Project tool is not executable: $REPLY" >&2
                return 1
              fi
              return 0
            fi
            if [[ "$directory" == "$root" ]]; then break; fi
            directory=$(dirname -- "$directory")
          done
          echo "Missing project-local tsc; install the project's locked dependencies explicitly" >&2
          return 1
        }

        declare -A projects=()
        sources=() configs=()
        for file in "''${selected[@]}"; do
          source="$root/$file"
          directory=$(dirname -- "$source")
          while [[ ! -f "$directory/tsconfig.json" ]]; do
            if [[ "$directory" == "$root" ]]; then
              echo "No tsconfig.json for selected TypeScript file: $file" >&2
              exit 1
            fi
            directory=$(dirname -- "$directory")
          done
          projects["$directory"]=1
          sources+=("$source") configs+=("$directory")
        done
        tmp=$(mktemp -d)
        trap 'rm -rf -- "$tmp"' EXIT
        for directory in "''${!projects[@]}"; do
          find_tsc "$directory"
          (
            cd "$directory"
            # Composite/incremental projects may write build info even with noEmit.
            status=0
            "$REPLY" --project tsconfig.json --noEmit --incremental \
              --tsBuildInfoFile "$tmp/check.tsbuildinfo" --listFiles > "$tmp/files" 2>&1 || status=$?
            if [ "$status" -ne 0 ]; then cat "$tmp/files"; exit "$status"; fi
            for index in "''${!sources[@]}"; do
              if [[ "''${configs[$index]}" == "$directory" ]] &&
                ! grep -Fqx -- "''${sources[$index]}" "$tmp/files"; then
                echo "Selected TypeScript file is not included by $directory/tsconfig.json: ''${sources[$index]}" >&2
                exit 1
              fi
            done
            rm -f "$tmp/check.tsbuildinfo"
          )
        done
      '';
    };
    description = "Type-check source.";
  };
}
