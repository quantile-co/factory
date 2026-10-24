# Factory repository guide

Factory is the public `quantile-co/factory` shared Nix flake.

Read [project memory](.pi/memory/MEMORY.md) before working here. It holds repository
rules, decisions, preferences and deployment outcomes.

**Maintain this file as a lightweight navigation index.** Only add or update
pointers to repository entry points. Do not add policies, preferences, decisions,
runbooks, implementation details or session notes here; put durable guidance in
`MEMORY.md`. Link to them rather than
copying their contents into this file.

## Repository map

- [README.md](README.md): usage and development entry points.
- [flake.nix](flake.nix) and [.envrc](.envrc): pinned shell and direnv entry.
- [apps/](apps/): thin Nix, GitHub and repository commands.
- [packages/](packages/): TypeScript support for Nix and GitHub plus the native Pi package.
- [etc/pi/settings.json](etc/pi/settings.json): native Pi package and resource selections.
- [nix/](nix/): reusable Nix modules and executables.
- [nix/files/](nix/files/): generic manifest and cold-bootstrap command module.
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
