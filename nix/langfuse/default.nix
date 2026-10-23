{ lib, pkgs, ... }:
{
  options.quantile-co.factory.langfuse.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
      pname = "langfuse-cli";
      version = "1.2.4";
      src = pkgs.fetchurl {
        url = "https://registry.npmjs.org/@langfuse/cli/-/cli-${finalAttrs.version}.tgz";
        hash = "sha256-D8Tjmzi/pF138EWi06eeFlQR5N4HN+t4k77FeyRuV08=";
      };
      nativeBuildInputs = [ pkgs.makeWrapper ];
      # The published Node bundle has no runtime npm dependencies.
      dontBuild = true;
      installPhase = ''
        runHook preInstall
        mkdir -p "$out/libexec/langfuse-cli" "$out/bin"
        cp -r bin dist package.json LICENSE "$out/libexec/langfuse-cli/"
        makeWrapper ${lib.getExe pkgs.nodejs_24} "$out/bin/langfuse" \
          --add-flags "$out/libexec/langfuse-cli/bin/langfuse.mjs"
        runHook postInstall
      '';
      meta = {
        description = "Langfuse CLI with a pinned Node.js runtime";
        homepage = "https://github.com/langfuse/langfuse-cli";
        license = lib.licenses.mit;
        mainProgram = "langfuse";
        inherit (pkgs.nodejs_24.meta) platforms;
      };
    });
    description = "Langfuse CLI; native LANGFUSE_* configuration and operations are consumer-owned.";
  };
}
