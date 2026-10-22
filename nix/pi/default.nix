{ llmAgents }:
{ lib, pkgs, ... }:
let
  marimo = pkgs.applyPatches {
    src = pkgs.fetchFromGitHub {
      owner = "marimo-team";
      repo = "marimo-pair";
      rev = "5368e127e736881fedd6bd7db315f6f974290230"; # v0.0.16
      hash = "sha256-xZX2W7w5gkqV0unHjdndFyEoFzxgCVCWLWuwtiEtUDQ=";
    };
    patches = [ ./marimo-pair.patch ];
  };
  marketing = pkgs.fetchFromGitHub {
    owner = "coreyhaines31";
    repo = "marketingskills";
    rev = "6b9e9387265d9e3049258f7eae3f746d3c3ddf87";
    hash = "sha256-CWRJkIK9Ajh6+1wqH4ZXEYka/DofEB1W4D1GDjjjwMA=";
  };
  vercel = pkgs.fetchFromGitHub {
    owner = "vercel-labs";
    repo = "agent-skills";
    rev = "ba46938889d4e58635362fb8f618e1178ac3ec46";
    hash = "sha256-hS9TPqPz3jYxciAhgFmUGiy23mju47pWFK47Ab3Oum0=";
  };
  cloudflare = pkgs.fetchFromGitHub {
    owner = "cloudflare";
    repo = "skills";
    rev = "3af2c77450c91af61384887def098fbfd247bbad";
    hash = "sha256-DyFT5G+dyuGrCnuJSMUKMD1GKQpmTaMDwM9x9C2/Dqg=";
  };
  webQuality = pkgs.fetchFromGitHub {
    owner = "addyosmani";
    repo = "web-quality-skills";
    rev = "c6b06ad1285cd6b129b58455b2eec96ab6b67fa7";
    hash = "sha256-RW+30OFUYxNO/SqPJ/bmwAn965GOoxjeuKBMFBtESHE=";
  };
  anthropic = pkgs.fetchFromGitHub {
    owner = "anthropics";
    repo = "skills";
    rev = "b9e19e6f44773509fbdd7001d77ff41a49a486c1";
    hash = "sha256-qAhHPjh7kgqx0oj8r2SPTPp/BamShae0f/9gbrUePCY=";
  };
in
{
  options.quantile-co.factory.pi = {
    package = lib.mkOption {
      type = lib.types.package;
      default = llmAgents.packages.${pkgs.stdenv.hostPlatform.system}.pi;
      description = "Pi coding agent.";
    };

    resourcesDir = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/pi;
      description = "Pi resources directory.";
    };

    settingsFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/pi/settings.json;
      description = "Pi settings file.";
    };

    skillsDir = lib.mkOption {
      type = lib.types.path;
      # Only first-party skills live in etc/. Fetched sources retain their
      # upstream licenses and are not repository lint targets.
      default = pkgs.linkFarm "pi-skills" (
        lib.mapAttrsToList (name: path: { inherit name path; }) {
          deploy = ../../etc/pi/skills/deploy;
          day-zero-deploy = ../../etc/pi/skills/day-zero-deploy;
          nvim-pair = ../../etc/pi/skills/nvim-pair;
          marimo-pair = "${marimo}/skills/marimo-pair";
          seo-audit = "${marketing}/skills/seo-audit";
          web-design-guidelines = "${vercel}/skills/web-design-guidelines";
          web-perf = "${cloudflare}/skills/web-perf";
          web-quality-audit = "${webQuality}/skills/web-quality-audit";
          # Includes the sibling references used by web-quality-audit.
          performance = "${webQuality}/skills/performance";
          core-web-vitals = "${webQuality}/skills/core-web-vitals";
          accessibility = "${webQuality}/skills/accessibility";
          seo = "${webQuality}/skills/seo";
          best-practices = "${webQuality}/skills/best-practices";
          webapp-testing = "${anthropic}/skills/webapp-testing";
        }
      );
      description = "First-party and pinned third-party skills for consumer placement.";
    };
  };
}
