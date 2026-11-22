{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.sonarqube;
in
{
  options.quantile-co.factory.sonarqube = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.sonar-scanner-cli;
      description = "SonarScanner CLI.";
    };

    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/sonarqube/sonar-project.properties;
      description = "Base SonarQube TypeScript analysis settings.";
    };

    withProject = lib.mkOption {
      type = lib.types.functionTo lib.types.package;
      default =
        {
          projectKey,
          roots ? [ "." ],
        }:
        let
          scope = lib.concatStringsSep "," roots;
        in
        pkgs.writeText "sonar-project.properties" (
          ''
            sonar.projectKey=${projectKey}
            sonar.sources=${scope}
            sonar.tests=${scope}
          ''
          + builtins.readFile cfg.configFile
        );
      description = "Render project identity and analysis roots with the shared SonarQube settings.";
    };

    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-sonarqube";
        runtimeInputs = [
          cfg.package
          pkgs.coreutils
          pkgs.git
        ];
        text = ''
          if [[ -z "''${SONAR_HOST_URL:-}" && -z "''${SONAR_TOKEN:-}" ]]; then
            echo 'Skipping SonarQube: neither SONAR_HOST_URL nor SONAR_TOKEN is configured.'
            exit 0
          fi
          if [[ "''${SONAR_HOST_URL:-}" != https://?* || -z "''${SONAR_TOKEN:-}" ]]; then
            echo 'SonarQube requires an HTTPS SONAR_HOST_URL and a project analysis SONAR_TOKEN.' >&2
            exit 1
          fi

          cd "$(git rev-parse --show-toplevel)"
          if [[ ! -f sonar-project.properties ]]; then
            echo 'Missing consumer-native sonar-project.properties.' >&2
            exit 1
          fi

          # Community Build has one branch; never submit a topic branch as the default branch.
          if ! default_branch=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD); then
            echo 'SonarQube requires origin/HEAD to identify the default branch.' >&2
            exit 1
          fi
          if [[ "origin/$(git branch --show-current)" != "$default_branch" ]]; then
            echo "Skipping SonarQube: Community Build only analyzes $default_branch."
            exit 0
          fi

          work=$(mktemp -d)
          trap 'rm -rf -- "$work"' EXIT
          sonar-scanner -Dsonar.scanner.skipJreProvisioning=true -Dsonar.working.directory="$work"
        '';
      };
      description = "Submit analysis on the default branch when credentials are configured.";
    };
  };
}
