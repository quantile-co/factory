<!-- markdownlint-disable MD041 -->
<br>

<div align="center">
  <h1>Quantile factory</h1>
  <p><em>Quantile software factory</em></p>
  <p>
    <a href="#prerequisites">Prerequisites</a> ·
    <a href="#development">Development</a> ·
    <a href="#skills">Skills</a>
  </p>
</div>

<br>
<!-- markdownlint-enable MD041 -->

## Prerequisites

- [Nix](https://nix.dev/install-nix.html)
- [direnv](https://direnv.net/docs/installation.html)

After cloning, allow direnv to load the development environment:

```sh
direnv allow
```

The pinned flake shell provides the project tools. Direnv materializes native
configuration as regular files. Checks reject copied files that differ from their
sources, including committed copies repaired on entry.

## Development

### Install

```sh
pnpm install --frozen-lockfile
```

### Checks

```sh
# Check source without rewriting it.
pnpm run check

# Apply safe source fixes explicitly.
pnpm run fix
```

### Tests

```sh
pnpm test
```

## Skills

Run from this repository with Pi:

- **Day Zero deployment**

  ```sh
  pi "/skill:day-zero-deploy"
  ```

- **Steady-state deployment**

  ```sh
  pi "/skill:deploy"
  ```
