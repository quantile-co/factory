---
name: nvim-pair
description: Control a live Neovim instance with its RPC socket to open files, inspect buffers, and navigate with the user. Use only when the user wants to pair in their running Neovim session.
---

# Pair in Neovim

The user and agent share one live editor. Use this skill's `scripts/nvctl` with
`bash` from the skill directory; it requires `nvim` on PATH and a live instance
started with `nvim --listen /tmp/nvim-<name>.sock`.

The script discovers a single live `/tmp/nvim-*.sock` socket. When several are
running it matches the current repository to their working directories; set
`NVIM_SOCKET` (or `NVIM_LISTEN`) to select one explicitly. It never removes
sockets or starts Neovim.

```sh
bash scripts/nvctl sockets
bash scripts/nvctl status
bash scripts/nvctl open /path/to/file
bash scripts/nvctl goto /path/to/file 42
bash scripts/nvctl grep pattern
bash scripts/nvctl expr 'line("$")'
```

`open` uses a new tab. `goto` accepts a positive line number. `grep` fills in
Telescope's live-grep prompt and needs that plugin. `cmd '<ex-command>'` and
`keys '<keys>'` can change the user's active buffer; use them only when asked.
Avoid interrupting the user while they are in insert mode. `open`, `goto`,
`grep`, `cmd`, and `keys` are fire-and-forget; query `status` or `expr` when the
next step depends on the result.
