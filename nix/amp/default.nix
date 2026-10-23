{ llmAgents }:
{ lib, pkgs, ... }:
{
  options.quantile-co.factory.amp.package = lib.mkOption {
    type = lib.types.package;
    default = llmAgents.packages.${pkgs.stdenv.hostPlatform.system}.amp;
    description = "Amp coding agent CLI; authentication and operations are consumer-owned.";
  };
}
