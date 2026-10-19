{
  config,
  inputs,
  lib,
  pkgs,
  ...
}:
let
  terraformSourceDir = "tf";
  terraformRoots = [ "tf/infrastructure" ];
in
{
  imports = [
    inputs.factory.nixModules.default
    inputs.factory.devenvModules.files
  ];

  packages = [
    config.quantile.opentofu.package
    config.quantile.tflint.package
    config.quantile.taplo.package
    config.quantile.gcloud.package
    config.quantile.gh.package
    config.quantile.actionlint.package
    config.quantile.git.lfs.package
    config.quantile.git.prePush.package
    config.quantile.prek.package
    config.quantile.prek.tools.package
    config.quantile.shellcheck.package
    config.quantile.shfmt.package
    config.quantile.jq.package
    config.quantile.pi.package
    config.quantile.nodejs.package
    config.quantile.qmd.package
    config.quantile.pnpm.package
    config.quantile.conftest.package
    config.quantile.trivy.package
    config.quantile.typos.package
    config.quantile.vale.package
    config.quantile.yamllint.package
    config.quantile.semgrep.package
    config.quantile.secretspec.package
  ];

  # Read the manifest directly from the Nix store; no root secretspec.toml is needed.
  env.SECRETSPEC_FILE = "${config.quantile.secretspec.configFile}";
  enterShell = lib.mkBefore config.quantile.secretspec.shellHook;

  files = {
    ".editorconfig".source = config.quantile.editorconfig.configFile;
    ".editorconfig-checker.json".source = config.quantile.editorconfig.checker.configFile;
    ".markdownlint-cli2.jsonc".source = config.quantile.markdownlint-cli2.configFile;
    ".pre-commit-config.yaml".source = config.quantile.prek.configFile;
    ".cz.toml".source = config.quantile.commitizen.configFile;
    ".shellcheckrc".source = config.quantile.shellcheck.configFile;
    ".tflint.hcl".source = config.quantile.tflint.configFile;
    "taplo.toml".source = config.quantile.taplo.configFile;
    "trivy.yaml".source = config.quantile.trivy.configFile;
    "typos.toml".source = config.quantile.typos.configFile;
    ".vale.ini".source = config.quantile.vale.configFile;
    ".yamllint.yaml".source = config.quantile.yamllint.configFile;
    "biome.json".source = config.quantile.biome.configFile;
    ".github/actionlint.yaml".source = config.quantile.actionlint.configFile;
    ".github/dependabot.yml" = {
      source = inputs.factory.outPath + "/etc/dependabot/dependabot.yml";
      copyMode = "copy";
    };
    ".pi/settings.json".source = config.quantile.pi.settingsFile;
    ".qmd/index.yml".source = config.quantile.qmd.configFile;
    ".semgrep".source = config.quantile.semgrep.rulesDir;
    ".semgrepignore".source = config.quantile.semgrep.ignoreFile;
  };

  tasks = {
    "git:hooks:install" = {
      description = "Explicitly install this worktree's checked pre-push hook (never a commit hook).";
      after = [ "devenv:files" ];
      exec = lib.getExe config.quantile.git.prePush.install.package;
    };

    "check:all" = {
      description = "Run all checks.";
      after = [ "devenv:files" ];
      exec = ''
        ${lib.getExe pkgs.nix} flake check .
        ${lib.getExe pkgs.git} show :.github/dependabot.yml | ${lib.getExe' pkgs.diffutils "cmp"} -s - etc/dependabot/dependabot.yml || {
          echo "Commit the Dependabot config copied from etc/dependabot/dependabot.yml." >&2
          exit 1
        }
        ${
          lib.getExe inputs.factory.packages.${pkgs.stdenv.hostPlatform.system}.check-devenv-locks
        } flake.lock devenv.lock factory
        if [ "''${CI:-}" = true ]; then
          ${
            lib.getExe inputs.factory.packages.${pkgs.stdenv.hostPlatform.system}.check-devenv-locks
          } --git-index flake.lock devenv.lock factory
        fi
        ${lib.getExe config.quantile.prek.check.package}
        ${lib.getExe config.quantile.nixfmt.check.package}
        ${lib.getExe config.quantile.deadnix.check.package}
        ${lib.getExe config.quantile.statix.check.package}
        ${lib.getExe config.quantile.editorconfig.check.package}
        ${lib.getExe config.quantile.markdownlint-cli2.check.package} '*.md' \
          ':(exclude,glob).pi/memory/**'
        ${lib.getExe config.quantile.actionlint.check.package}
        ${lib.getExe config.quantile.semgrep.test.package}
        ${lib.getExe config.quantile.semgrep.check.package}
        ${lib.getExe config.quantile.trivy.check.package}
        ${lib.getExe config.quantile.typos.check.package}
        # Vale targets docs, not agent instructions or append-only history.
        ${lib.getExe config.quantile.vale.check.package} '*.md' \
          ':(exclude,glob)**/AGENTS.md' ':(exclude,glob)nix/**/fixtures/**' \
          ':(exclude,glob).pi/memory/**' ':(exclude,glob).pi/skills/**'
        ${lib.getExe config.quantile.yamllint.check.package}
        ${lib.getExe config.quantile.taplo.check.package}
        ${lib.getExe config.quantile.taplo.format.package}
        git ls-files -z -- ${lib.escapeShellArg terraformSourceDir} |
          while IFS= read -r -d "" file; do
            case "$file" in *.tf|*.tofu) printf '%s\0' "$file" ;; esac
          done | xargs -0 -r ${lib.getExe config.quantile.opentofu.nonempty.package}
        TF_DIR=${lib.escapeShellArg terraformSourceDir} ${lib.getExe config.quantile.opentofu.format.package}
        ${lib.concatMapStringsSep "\n" (root: ''
          TF_DIR=${lib.escapeShellArg root} ${lib.getExe config.quantile.opentofu.check.package}
          TF_DIR=${lib.escapeShellArg root} ${lib.getExe config.quantile.tflint.check.package}
        '') terraformRoots}
        ${lib.getExe config.quantile.conftest.package} test --no-color --policy tf/infrastructure --namespace terraform.infrastructure tf/infrastructure/main.tf
        ${lib.getExe config.quantile.conftest.package} test --no-color --policy tf/modules/project/github --namespace terraform.project.github tf/modules/project/github/main.tf
        ${lib.getExe config.quantile.conftest.package} test --no-color --policy tf/modules/project/gcp --namespace terraform.project.gcp tf/modules/project/gcp/main.tf
        ${lib.getExe config.quantile.pnpm.package} install --frozen-lockfile --ignore-scripts
        ${lib.getExe config.quantile.pnpm.package} run check
      '';
    };

    "fix:all" = {
      description = "Run all fixes.";
      after = [ "devenv:files" ];
      exec = ''
        TF_DIR=${lib.escapeShellArg terraformSourceDir} ${lib.getExe config.quantile.opentofu.fix.package}
        ${lib.getExe config.quantile.nixfmt.fix.package}
        ${lib.getExe config.quantile.taplo.fix.package}
        ${lib.getExe config.quantile.editorconfig.fix.package}
        ${lib.getExe config.quantile.pnpm.package} install --frozen-lockfile --ignore-scripts
        ${lib.getExe config.quantile.pnpm.package} run fix
      '';
    };

    "test:all" = {
      description = "Run all tests.";
      after = [ "check:all" ];
      exec = ''
        ${lib.getExe config.quantile.pnpm.package} install --frozen-lockfile --ignore-scripts
        ${lib.getExe config.quantile.pnpm.package} test
      '';
    };

    "plan:infrastructure" = {
      description = "Plan infrastructure.";
      env.TF_DIR = "tf/infrastructure";
      exec = lib.getExe config.quantile.opentofu.plan.gcs.package;
    };

    "apply:infrastructure" = {
      description = "Apply infrastructure.";
      env.TF_DIR = "tf/infrastructure";
      exec = lib.getExe config.quantile.opentofu.apply.gcs.package;
    };
  };
}
