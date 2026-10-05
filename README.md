<!-- markdownlint-disable MD041 -->
<br>

<div align="center">
  <h1>Quantile factory</h1>
  <p><em>Quantile software factory</em></p>
  <p>
    <a href="#prerequisites">Prerequisites</a> ·
    <a href="#development">Development</a>
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

```sh
nix flake check path:.
tofu -chdir=tf fmt -check -recursive
tofu -chdir=tf init -backend=false -input=false -lockfile=readonly
tofu -chdir=tf validate
```
