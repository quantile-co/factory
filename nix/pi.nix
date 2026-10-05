{ llmAgents }:
{ lib, pkgs, ... }:
{
  options.quantile.pi.package = lib.mkOption {
    type = lib.types.package;
    default = llmAgents.packages.${pkgs.stdenv.hostPlatform.system}.pi;
    description = "Pi coding agent from the pinned llm-agents.nix input.";
  };
}
