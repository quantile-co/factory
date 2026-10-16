# Project memory

Read any repository instructions present in this checkout before changing code or production behavior; source and reviewed workflows are authoritative.

Store only durable, reviewed project-specific facts here. Never commit credentials, customer data, provider payloads, daily logs, scratchpad or recovery data. Review every change to this file before committing.


<!-- 2026-10-15 20:22:53 [01a14275] -->
#decision [[factory-config-layout]] Factory is a shared Nix flake, not a shared devenv configuration. Keep tool configuration files as raw, native-format supplemental/example assets under root `etc/`, separate from `nix/`. Tool-specific Nix modules may reference/package those files, but must not encode configs as elaborate mergeable devenv/Nix data structures or force their placement. Downstream repositories choose whether to consume the flake's modules or config files, patch/override the files, and place them where they need them. Keep `etc/` reusable by other packaging systems (e.g. OS or npm packages). This intentionally replaces the complex config-in-Nix/devenv approach from the older devenv and July 12a repositories. Keep `nix/ts.nix` available for downstreams but do not include its Node package in factory's own devenv shell until needed for repo code. Port source directories from those older repos one at a time, checking with the user before each directory; do not port unattended.


<!-- 2026-10-15 20:59:33 [01a14275] -->
#decision [[factory-executable-config]] Reusable check/plan/apply executables live as ordinary Nix packages exposed through the shared tool modules, independent of devenv. They read the consuming repository's native configuration paths at runtime (with explicit runtime overrides when needed); never bake paths to factory's `etc/` templates into those executables. Each repo chooses whether to copy, patch, generate, or link templates from `etc/` into its own tool locations. Factory's devenv tasks only orchestrate the packages; CI wrappers retain protected environments, WIF, manual authorization, and concurrency. Production Apply must create a fresh saved plan and apply those exact bytes in one guarded job.
