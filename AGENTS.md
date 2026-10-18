# Factory repository guide

Factory is the public `quantile-co/factory` shared Nix flake.

Read [project memory](.pi/memory/MEMORY.md) before working here. It holds repository
rules, decisions, preferences and operational context; [daily logs](.pi/memory/daily/)
record history.

**Maintain this file as a lightweight navigation index.** Only add or update
pointers to repository entry points. Do not add policies, preferences, decisions,
runbooks, implementation details or session notes here; put durable guidance in
`MEMORY.md` and historical outcomes in the daily logs. Link to them rather than
copying their contents into this file.

## Repository map

- [README.md](README.md): usage and development entry points.
- [devenv.nix](devenv.nix): shell wiring and check/fix/test/deployment tasks.
- [nix/](nix/): reusable Nix modules and executables.
- [etc/](etc/): reusable native-format configuration assets.
- [tf/infrastructure/](tf/infrastructure/): this repository's deployment root.
- [tf/modules/project/](tf/modules/project/): independent GitHub and GCP modules.
- [.github/workflows/](.github/workflows/): CI and protected deployment wrappers.
- [package.json](package.json): TypeScript checks and colocated Vitest tests.

## Deployment instructions

- Existing installation: [deploy](.pi/skills/deploy/SKILL.md).
- Confirmed new installation: [day-zero-deploy](.pi/skills/day-zero-deploy/SKILL.md).
