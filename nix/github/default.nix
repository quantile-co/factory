{ config, lib, pkgs, ... }:
let
  github = config.quantile-co.factory.github;
  source = lib.fileset.toSource {
    root = ../..;
    fileset = lib.fileset.unions [
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
    ];
  };
  commanderVersion = (lib.importJSON ../../apps/github/package.json).dependencies.commander;
  commander = pkgs.fetchurl {
    url = "https://registry.npmjs.org/commander/-/commander-${commanderVersion}.tgz";
    hash = "sha512-z67u4ZhzCL/Tydu1lJARtEZYWbWaN7oYLHbsuzocr6y4N6WZAagG3RQ4FW61V1/0+jImpj293XfrcYnd1qxtPg==";
  };
in
{
  imports = [ ./workflows ];

  options.quantile-co.factory.github = {
    runtime.package = lib.mkOption {
      type = lib.types.package;
      description = "Relocatable Factory GitHub CLI and job hooks for a Node 24 runtime.";
      default = pkgs.runCommand "factory-github-runtime" { } ''
        mkdir -p "$out/bin" "$out/node_modules/@quantile-co" "$out/node_modules/commander"
        cp -r ${source}/{apps,packages} "$out/"
        chmod +x "$out/apps/github/cli.ts"
        ln -s ../apps/github/cli.ts "$out/bin/factory-github"
        for hook in job-started job-completed; do
          ln -s "../apps/github/$hook.sh" "$out/bin/$hook.sh"
        done
        for name in github namespace; do
          ln -s "../../packages/$name" "$out/node_modules/@quantile-co/factory-$name"
        done
        tar -xzf ${commander} -C "$out/node_modules/commander" --strip-components=1
      '';
    };
    codeQuality.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "github-code-quality";
        runtimeInputs = [ pkgs.nodejs_24 ];
        text = ''
          exec node "${github.runtime.package}/apps/github/cli.ts" code-quality "$@"
        '';
      };
      description = "CLI for synchronizing GitHub Code Quality findings to one tracking issue.";
    };
  };
}
