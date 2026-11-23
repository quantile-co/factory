{
  config,
  lib,
  pkgs,
  ...
}:
let
  github = config.quantile-co.factory.github;
  source = lib.fileset.toSource {
    root = ../..;
    fileset = lib.fileset.unions [
      ../../package.json
      ../../pnpm-lock.yaml
      ../../pnpm-workspace.yaml
      ../../apps/github/package.json
      ../../apps/github/cli.ts
      ../../apps/github/job-started.sh
      ../../apps/github/job-completed.sh
      ../../packages/github/package.json
      ../../packages/github/src/index.ts
      ../../packages/github/src/code-quality.ts
      ../../packages/github/src/runner/collector.ts
      ../../packages/github/src/runner/job.ts
      ../../packages/github/src/runner/config.yaml
      ../../packages/namespace/package.json
      ../../packages/namespace/src/index.ts
      ../../packages/otel/package.json
      ../../packages/otel/src/index.ts
    ];
  };
  pnpmWorkspaces = [ "@quantile-co/factory-github-cli..." ];
  pnpmInstallFlags = [ "--prod" ];
in
{
  imports = [ ./workflows ];

  options.quantile-co.factory.github = {
    package = lib.mkOption {
      type = lib.types.package;
      description = "Relocatable Factory GitHub CLI and job hooks for a Node 24 runtime.";
      default = pkgs.stdenvNoCC.mkDerivation {
        name = "factory-github";
        src = source;
        inherit pnpmWorkspaces pnpmInstallFlags;
        pnpmDeps = pkgs.fetchPnpmDeps {
          pname = "factory-github";
          src = source;
          inherit (pkgs) pnpm;
          inherit pnpmWorkspaces pnpmInstallFlags;
          fetcherVersion = 5;
          hash = "sha256-YF1sMvcMaCL6Af9lOKOK6Y7xy4tHUARUtTEm6fAY+10=";
        };
        nativeBuildInputs = [
          pkgs.nodejs_24
          pkgs.pnpm
          pkgs.pnpmConfigHook
        ];
        dontBuild = true;
        dontPatchShebangs = true;
        installPhase = ''
          mkdir -p "$out/bin"
          cp -r apps packages node_modules "$out/"
          chmod +x "$out/apps/github/cli.ts"
          ln -s ../apps/github/cli.ts "$out/bin/factory-github"
          for hook in job-started job-completed; do
            ln -s "../apps/github/$hook.sh" "$out/bin/$hook.sh"
          done
        '';
        doInstallCheck = true;
        installCheckPhase = ''node "$out/bin/factory-github" runner --help >/dev/null'';
      };
    };
    codeQuality.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "github-code-quality";
        runtimeInputs = [ pkgs.nodejs_24 ];
        text = ''
          exec node "${github.package}/apps/github/cli.ts" code-quality "$@"
        '';
      };
      description = "CLI for synchronizing GitHub Code Quality findings to one tracking issue.";
    };
  };
}
