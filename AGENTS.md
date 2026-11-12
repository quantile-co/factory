# Factory repository guide

Factory is the public `quantile-co/factory` shared Nix flake.

Repository memory: [Hindsight workflow](packages/pi/skills/hindsight/SKILL.md) and
[native configuration](.pi/hindsight.json).

**Maintain this file as a lightweight navigation index.** Only add or update
pointers to repository entry points. Do not add policies, preferences, decisions,
runbooks, implementation details or session notes here. Link to the owning
repository guides and Hindsight workflow rather than copying their contents.

## Repository map

- [README.md](README.md): usage and development entry points.
- [flake.nix](flake.nix) and [.envrc](.envrc): pinned shell and direnv entry.
- [apps/](apps/): thin Nix, GitHub, Namespace, Amp and repository commands.
- [packages/](packages/): TypeScript support for Nix, GitHub, Namespace and Amp plus the native Pi package.
- [packages/amp/](packages/amp/) and [apps/amp/](apps/amp/): orb lifecycle, Herdr connections and the standalone Amp plugin.
- [.agents/setup](.agents/setup) and [.agents/resume](.agents/resume): Factory's opt-in orb pilot hooks.
- [etc/pi/settings.json](etc/pi/settings.json): native Pi package and resource selections.
- [nix/](nix/): reusable Nix modules and executables.
- [nix/hindsight/](nix/hindsight/) and [Hindsight skill](packages/pi/skills/hindsight/SKILL.md): opt-in Cloud memory configuration, native CLI and migration entry points.
- [nix/files/](nix/files/): generic manifest and cold-bootstrap command module.
- [nix/otelcol-contrib/](nix/otelcol-contrib/) and [etc/otelcol-contrib/](etc/otelcol-contrib/): upstream collector and native pipeline configurations.
- [packages/otel/](packages/otel/) and [apps/otel/](apps/otel/): shared OTel runtime, tracing and CLI.
- [nix/flake/](nix/flake/): per-system output module and consumer-bootstrap tests.
- [etc/](etc/): reusable native-format configuration assets.
- [etc/flake/](etc/flake/): native downstream flake starter.
- [etc/pnpm/](etc/pnpm/) and [etc/turbo/](etc/turbo/): repository-owned workspace seeds.
- [tf/infrastructure/](tf/infrastructure/): this repository's deployment root.
- [tf/modules/project/](tf/modules/project/): independent GitHub and GCP modules.
- [.github/workflows/](.github/workflows/): checked-in CI and protected deployment workflows.
- [etc/github/workflows/](etc/github/workflows/): native workflow templates.
- [nix/github/workflows/](nix/github/workflows/): workflow template options and guard tests.
- [package.json](package.json): TypeScript checks and colocated Vitest tests.

## Deployment instructions

- Existing installation: [deploy](packages/pi/skills/deploy/SKILL.md).
- Confirmed new installation: [day-zero-deploy](packages/pi/skills/day-zero-deploy/SKILL.md).
