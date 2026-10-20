{ lib, pkgs, ... }:
{
  options.quantile.resend-cli.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
      pname = "resend-cli";
      version = "2.22.0";
      src = pkgs.fetchFromGitHub {
        owner = "resend";
        repo = "resend-cli";
        tag = "v${finalAttrs.version}";
        hash = "sha256-YjoRNwwi9QZvvy9dKCplTJlNnx/ucpUzAIBhd7AxhQ4=";
      };
      pnpmDeps = pkgs.fetchPnpmDeps {
        inherit (finalAttrs) pname version src;
        inherit (pkgs) pnpm;
        fetcherVersion = 4;
        hash = "sha256-m/oQzBJRYHlNGdEs+FxxDMfEktk2JPFU68/VoDqrtec=";
      };
      nativeBuildInputs = [
        pkgs.nodejs
        pkgs.pnpm
        pkgs.pnpmConfigHook
        pkgs.makeWrapper
      ];
      pnpmInstallFlags = [ "--ignore-scripts" ];
      buildPhase = ''
        runHook preBuild
        pnpm run build
        runHook postBuild
      '';
      installPhase = ''
        runHook preInstall
        pnpm prune --prod --ignore-scripts --config.offline=true
        mkdir -p "$out/libexec/resend-cli" "$out/bin"
        cp -r dist node_modules package.json LICENSE "$out/libexec/resend-cli/"
        makeWrapper ${lib.getExe pkgs.nodejs} "$out/bin/resend" \
          --add-flags "$out/libexec/resend-cli/dist/cli.cjs"
        runHook postInstall
      '';
      meta = {
        description = "Resend CLI with a pinned Node.js runtime";
        homepage = "https://github.com/resend/resend-cli";
        license = lib.licenses.mit;
        mainProgram = "resend";
        inherit (pkgs.nodejs.meta) platforms;
      };
    });
    description = "Resend CLI; authentication and operations are consumer-owned.";
  };
}
