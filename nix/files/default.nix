{ config }:
let
  copy = source: {
    inherit source;
    mode = "copy";
  };
in
{
  "tsconfig.json" = copy (
    config.quantile-co.factory.typescript.withOverrides {
      compilerOptions = {
        module = "ESNext";
        moduleResolution = "Bundler";
        types = [ "node" ];
      };
      include = [
        "*.test.ts"
        "nix/**/*.test.ts"
        "tf/**/*.test.ts"
      ];
    }
  );
  ".editorconfig" = copy config.quantile-co.factory.editorconfig.configFile;
  ".editorconfig-checker.json" = copy config.quantile-co.factory.editorconfig.checker.configFile;
  ".markdownlint-cli2.jsonc" = copy config.quantile-co.factory.markdownlint-cli2.configFile;
  ".pre-commit-config.yaml" = copy config.quantile-co.factory.prek.configFile;
  ".cz.toml" = copy config.quantile-co.factory.commitizen.configFile;
  ".shellcheckrc" = copy config.quantile-co.factory.shellcheck.configFile;
  ".tflint.hcl" = copy config.quantile-co.factory.tflint.configFile;
  "taplo.toml" = copy config.quantile-co.factory.taplo.configFile;
  "trivy.yaml" = copy config.quantile-co.factory.trivy.configFile;
  "typos.toml" = copy config.quantile-co.factory.typos.configFile;
  ".vale.ini" = copy config.quantile-co.factory.vale.configFile;
  ".yamllint.yaml" = copy config.quantile-co.factory.yamllint.configFile;
  "biome.json" = copy config.quantile-co.factory.biome.configFile;
  ".github/actionlint.yaml" = copy config.quantile-co.factory.actionlint.configFile;
  ".github/workflows/check.yaml" = copy config.quantile-co.factory.github.workflows.check.configFile;
  ".github/workflows/test.yaml" = copy config.quantile-co.factory.github.workflows.test.configFile;
  ".github/workflows/plan.yaml" = copy config.quantile-co.factory.github.workflows.plan.configFile;
  ".github/workflows/apply.yaml" = copy config.quantile-co.factory.github.workflows.apply.configFile;
  ".github/dependabot.yml" = copy (
    config.quantile-co.factory.dependabot.withUpdates [
      "github-actions"
      "npm"
      "opentofu"
      "nix"
    ]
  );
  ".pi/settings.json" = copy config.quantile-co.factory.pi.settingsFile;
  ".pi/skills/deploy" = copy (config.quantile-co.factory.pi.skillsDir + "/deploy");
  ".pi/skills/day-zero-deploy" = copy (config.quantile-co.factory.pi.skillsDir + "/day-zero-deploy");
  ".qmd/index.yml" = copy config.quantile-co.factory.qmd.configFile;
  ".semgrep" = copy config.quantile-co.factory.semgrep.rulesDir;
  ".semgrepignore" = copy config.quantile-co.factory.semgrep.ignoreFile;
}
