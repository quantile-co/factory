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

The devenv shell provides all other project tools.

## Development

### Install

```sh
devenv tasks run --show-output install:git:hooks
```

### Checks

```sh
# Check source without rewriting it.
devenv tasks run --show-output check:all

# Apply safe source fixes explicitly.
devenv tasks run --show-output fix:all
```

### Tests

```sh
devenv tasks run --show-output --mode single test:all
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
