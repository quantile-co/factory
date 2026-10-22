{
  config,
  lib,
  pkgs,
  ...
}:
let
  # Match Playwright 1.64.1's Chromium revision 1248, not system Chromium.
  browserVersion = "156.0.8078.4";
  releases = {
    x86_64-linux = {
      url = "https://cdn.playwright.dev/builds/cft/${browserVersion}/linux64/chrome-headless-shell-linux64.zip";
      hash = "sha256-Qiz/wZA9AsYfqsEej5zfNxVcieu20J2m4XVFRA34Bi4=";
      executable = "chrome-headless-shell-linux64/chrome-headless-shell";
    };
    aarch64-linux = {
      url = "https://cdn.playwright.dev/builds/cft/${browserVersion}/linux-arm64/chrome-headless-shell-linux-arm64.zip";
      hash = "sha256-I7gSc1J6+KJbRiANE997p34vAQj62bF3CQn0LZFTsqA=";
      executable = "chrome-headless-shell-linux-arm64/chrome-headless-shell";
    };
    aarch64-darwin = {
      url = "https://cdn.playwright.dev/builds/cft/${browserVersion}/mac-arm64/chrome-headless-shell-mac-arm64.zip";
      hash = "sha256-47hkERfQBDHWjD6VFwQNVCAXK1a+5uWKmNwialEESso=";
      executable = "chrome-headless-shell-mac-arm64/chrome-headless-shell";
    };
  };
  release = releases.${pkgs.stdenv.hostPlatform.system};
  src = pkgs.fetchzip {
    inherit (release) url hash;
    stripRoot = false;
  };
  browser =
    if pkgs.stdenv.hostPlatform.isLinux then
      pkgs.playwright-driver.components.chromium-headless-shell.overrideAttrs { inherit src; }
    else
      src;
  fonts = pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; };
in
{
  options.quantile-co.factory.playwright.withVersion = lib.mkOption {
    type = lib.types.functionTo lib.types.package;
    default =
      version:
      assert lib.assertMsg (
        config.quantile-co.factory.playwright.package.playwrightVersion == version
      ) "The npm Playwright version must match Factory's pinned browser.";
      config.quantile-co.factory.playwright.package;
    description = "Select the configured browser after checking an exact client version.";
  };

  options.quantile-co.factory.playwright.package = lib.mkOption {
    type = lib.types.package;
    default =
      pkgs.runCommand "playwright-chromium-${browserVersion}"
        {
          nativeBuildInputs = [ pkgs.makeWrapper ];
          passthru = {
            playwrightVersion = "1.64.1";
            inherit browserVersion;
          };
          meta = {
            mainProgram = "chromium-headless-shell";
            platforms = builtins.attrNames releases;
          };
        }
        ''
          mkdir -p "$out/bin"
          makeWrapper ${browser}/${release.executable} "$out/bin/chromium-headless-shell" \
            --set FONTCONFIG_FILE ${fonts}
        '';
    description = "Pinned Playwright Chromium headless shell with Nix native libraries and fonts.";
  };
}
