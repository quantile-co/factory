---
name: devenv-tasks
description: Discover available tasks in an existing Devenv project and explain their descriptions, implementations and dependencies. Use when asked what tasks exist, what a task does or which task matches a request.
---

# Devenv tasks

Locate the project's Devenv configuration and read any applicable project
instructions. Use its documented Devenv invocation, preferring the pinned
version when one is configured. Do not initialize an environment, install a
new CLI or update locks just to discover tasks.

## Discover available tasks

Inspect the installed CLI's help first:

```sh
devenv tasks --help
devenv tasks list --help
```

Use the supported task listing command, preferring `devenv tasks list --json`
when available. Otherwise use the text listing. If that version lacks task
listing, inspect the configuration directly and explain the limitation.
Listing does not execute task bodies, but Nix evaluation may fetch or build
dependencies and entering a shell may run project setup hooks.

## Inspect descriptions and implementations

For the relevant tasks, collect their names and declared descriptions. Follow
the configuration's imports and overrides to find their effective definitions;
do not assume everything is declared in one file.

Inspect the commands, working directories, environment declarations, status
checks and execution conditions. Follow referenced scripts, package commands
and executable definitions to understand the implementation. Listings may
contain only metadata, not the commands themselves. Do not print secret values.

Trace dependency relationships across all relevant tasks, including reverse
`before` references as well as `after` references. Report prerequisites and
side effects such as file changes, persistent processes or external operations.
Do not infer behavior from a name or description alone. If an implementation
cannot be inspected, state what remains unknown.

Report each matching task with its description, implementation location and
behavior. Discover names from the current project rather than assuming any
standard task inventory. A discovery request does not authorize execution.
If execution is requested, consult `devenv tasks run --help`, use the exact
discovered name and confirm the selected dependency scope. Do not silently
skip prerequisites or include additional tasks beyond the requested work.

Reference: [Devenv tasks](https://devenv.sh/tasks/). The installed CLI help and
project configuration take precedence when versions differ.
