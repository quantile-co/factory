{ llmAgents }:
{ lib, pkgs, ... }:
{
  options.quantile-co.factory.hunk.package = lib.mkOption {
    type = lib.types.package;
    default = llmAgents.packages.${pkgs.stdenv.hostPlatform.system}.hunk;
    description = "Hunk terminal diff viewer for agentic changesets.";
  };
}
