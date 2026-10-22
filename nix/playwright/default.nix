{
  config,
  lib,
  pkgs,
  ...
}:
let
  # Match Playwright 1.63.0's Chromium revision 1243, not system Chromium.
  browserVersion = "153.0.8010.12";
  releases = {
    x86_64-linux = {
      url = "https://cdn.playwright.dev/builds/cft/${browserVersion}/linux64/chrome-headless-shell-linux64.zip";
      hash = "sha256-GLqqZOwtnJig+ZCIT8FYsIxZGSFTmRwLbqNXeSOdJXA=";
      executable = "chrome-headless-shell-linux64/chrome-headless-shell";
    };
    aarch64-linux = {
      url = "https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1243/chromium-headless-shell-linux-arm64.zip";
      hash = "sha256-FiK+GGxiDHjwj/JeOh4FZPYYclogjAxfEDcpJ4Fjoqc=";
      executable = "chrome-linux/headless_shell";
    };
    aarch64-darwin = {
      url = "https://cdn.playwright.dev/builds/cft/${browserVersion}/mac-arm64/chrome-headless-shell-mac-arm64.zip";
      hash = "sha256-Elbpy5UDVndRzWRi8Nb391AhAAYl55PJ/3Fxz/RI/4I=";
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
            playwrightVersion = "1.63.0";
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
