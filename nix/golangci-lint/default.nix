{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.golangci-lint;
  run =
    fix:
    pkgs.writeShellApplication {
      name = if fix then "fix-golangci-lint" else "check-golangci-lint";
      runtimeInputs = [
        config.quantile.go.package
        cfg.package
        pkgs.coreutils
        pkgs.findutils
        pkgs.git
        pkgs.jq
      ];
      text = ''
        paths=( '*.go' ':(exclude)*.pb.go' ':(exclude)*.gen.go' ':(exclude)*_templ.go' ':(exclude)vendor/**' )
        roots=()
        while (( $# )); do
          if [ "$1" = -- ]; then shift; paths+=("$@"); break; fi
          roots+=("$1")
          shift
        done
        if (( ''${#roots[@]} == 0 )); then
          echo 'Select at least one Go module root (e.g. check-golangci-lint .).' >&2
          exit 2
        fi
        # An ambient Go installation's GOROOT can silently mix stdlib toolchains.
        unset GOROOT GOBIN
        export GOTOOLCHAIN=local GOFLAGS="''${GOFLAGS:-} -mod=readonly -buildvcs=false"
        checkout=$(git rev-parse --show-toplevel)
        cd "$checkout"
        config="''${GO_LINT_CONFIG:-.golangci.yml}"
        test -f "$config" || { echo "Missing native golangci-lint config: $config" >&2; exit 1; }
        config=$(realpath -- "$config")
        tmp=$(mktemp -d)
        trap 'rm -rf -- "$tmp"' EXIT
        mkdir "$tmp/tree"
        # Lint and format a source copy: even read-only Go tools can write go.sum.
        export GOLANGCI_LINT_CACHE="$tmp/lint-cache"
        git ls-files -z --cached --others --exclude-standard > "$tmp/context"
        while IFS= read -r -d "" file; do
          if [[ -f "$file" && ! -L "$file" ]]; then cp --parents -- "$file" "$tmp/tree"; fi
        done < "$tmp/context"
        export GOWORK=off
        if [ -n "''${GO_WORK_FILE:-}" ]; then
          case "/$GO_WORK_FILE/" in
            //*|*/../*|*/./*|*/.git/*|*//*) echo "Unsafe Go workspace path: $GO_WORK_FILE" >&2; exit 1 ;;
          esac
          GOWORK="$tmp/tree/$GO_WORK_FILE"
          if [ ! -f "$GOWORK" ]; then echo 'Missing selected Go workspace' >&2; exit 1; fi
          export GOWORK
        fi
        metadata() {
          find "$tmp/tree" -type f \( -name go.mod -o -name go.sum -o -name go.work -o -name go.work.sum \) -print0 |
            sort -z | xargs -0 -r sha256sum
        }
        metadata > "$tmp/before"
        local_paths() {
          local manifest="$1" kind="$2" path resolved
          go "$kind" edit -json "$manifest" > "$tmp/manifest"
          jq -j '(.Replace[]? | select((.New.Version // "") == "") | .New.Path, "\u0000"),
            (.Use[]? | .DiskPath, "\u0000")' "$tmp/manifest" > "$tmp/paths"
          while IFS= read -r -d "" path; do
            resolved=$(realpath -m -- "$(dirname -- "$manifest")/$path")
            if [[ "$path" == /* || "$resolved" != "$tmp/tree"/* && "$resolved" != "$tmp/tree" ]]; then
              echo "Go local module paths must stay inside the checkout: $path" >&2
              exit 1
            fi
          done < "$tmp/paths"
        }
        if [ "$GOWORK" != off ]; then local_paths "$GOWORK" work; fi
        : > "$tmp/selected"
        for root in "''${roots[@]}"; do
          case "/$root/" in
            //*|*/../*|*/./*|*/.git/*|*//*) echo "Unsafe Go module root: $root" >&2; exit 1 ;;
          esac
          resolved=$(realpath -m -- "$checkout/$root")
          if [[ "$resolved" != "$checkout" && "$resolved" != "$checkout"/* ]]; then
            echo "Go module root escapes the checkout: $root" >&2
            exit 1
          fi
          if [ ! -f "$tmp/tree/$root/go.mod" ]; then
            echo "Go root requires a regular, nonignored go.mod: $root" >&2
            exit 1
          fi
          cd "$tmp/tree/$root"
          local_paths "$PWD/go.mod" mod
          git -C "$checkout/$root" ls-files -z --cached ${
            lib.optionalString (!fix) "--others --exclude-standard"
          } -- \
            "''${paths[@]}" > "$tmp/candidates"
          selected=()
          while IFS= read -r -d "" file; do
            if [[ "$file" == ../* || "$file" == /* ]]; then
              echo "Go source path escapes its configured module: $file" >&2
              exit 1
            fi
            [[ "$file" == *.go && -f "$checkout/$root/$file" && ! -L "$checkout/$root/$file" ]] || continue
            directory=$(dirname -- "$file")
            nested=false
            while [[ "$directory" != . ]]; do
              if [[ -f "$checkout/$root/$directory/go.mod" ]]; then nested=true; break; fi
              directory=$(dirname -- "$directory")
            done
            if [[ "$nested" == true ]]; then continue; fi
            selected+=("./$file")
            printf '%s\0' "$root/$file" >> "$tmp/selected"
          done < "$tmp/candidates"
          if (( ''${#selected[@]} == 0 )); then echo "No Go source selected for root: $root" >&2; exit 1; fi
          golangci-lint run --config "$config" --modules-download-mode readonly --issues-exit-code 1 ${lib.optionalString fix "--fix"} ./...
          ${lib.optionalString fix ''
            # Some failed repairs are warnings in --fix mode; verify before copying back.
            golangci-lint run --config "$config" --modules-download-mode readonly --issues-exit-code 1 ./...
          ''}
        done
        metadata > "$tmp/after"
        if ! cmp -s "$tmp/before" "$tmp/after"; then
          echo 'Go checks would change module/workspace metadata; update dependencies explicitly' >&2
          exit 1
        fi
        ${lib.optionalString fix ''
          cd "$checkout"
          while IFS= read -r -d "" file; do
            if [[ -f "$file" && ! -L "$file" ]]; then cp -- "$tmp/tree/$file" "$file"; fi
          done < "$tmp/selected"
        ''}
      '';
    };
in
{
  imports = [ ../go ];
  options.quantile.golangci-lint = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.golangci-lint;
      description = "golangci-lint v2 executable.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/golangci-lint/.golangci.yml;
      description = "Native golangci-lint v2 configuration template.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = run false;
      description = "Read-only golangci-lint checks for explicitly selected Go module roots.";
    };
    fix.package = lib.mkOption {
      type = lib.types.package;
      default = run true;
      description = "Explicit golangci-lint fixes for selected tracked Go source.";
    };
  };
}
