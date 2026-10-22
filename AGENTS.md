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
- [scripts/](scripts/): pnpm tasks and workflow entry points.
- [nix/](nix/): reusable Nix modules and executables.
- [nix/files/](nix/files/): managed-file command and tests.
- [etc/](etc/): reusable native-format configuration assets.
- [tf/infrastructure/](tf/infrastructure/): this repository's deployment root.
- [tf/modules/project/](tf/modules/project/): independent GitHub and GCP modules.
- [.github/workflows/](.github/workflows/): checked-in CI and protected deployment workflows.
- [etc/github/workflows/](etc/github/workflows/): native workflow templates.
- [nix/github/workflows/](nix/github/workflows/): workflow modules and CI scripts.
- [package.json](package.json): TypeScript checks and colocated Vitest tests.

## Deployment instructions

- Existing installation: [deploy](.pi/skills/deploy/SKILL.md).
- Confirmed new installation: [day-zero-deploy](.pi/skills/day-zero-deploy/SKILL.md).
