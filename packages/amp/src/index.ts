import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { managedConfig } from "@quantile-co/factory-otel/config";

export type Orb = {
  thread: string;
  repository?: string;
  project?: string;
  issue?: number;
  title?: string;
};

export function identity(orb: Orb) {
  const thread = orb.thread.replace(/^https:\/\/ampcode\.com\/threads\//, "");
  if (
    !/^T-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      thread,
    )
  )
    throw new Error(
      "Expected an Amp thread UUID or its ampcode.com thread URL.",
    );
  if (
    orb.repository &&
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(orb.repository)
  )
    throw new Error("Repository must be GitHub org/repo.");
  if (
    orb.issue !== undefined &&
    (!orb.repository || !Number.isSafeInteger(orb.issue) || orb.issue < 1)
  )
    throw new Error("An issue requires a repository and a positive integer.");
  const label = [
    orb.repository || orb.project || "Amp",
    [orb.issue ? `#${orb.issue}` : "", orb.title || ""]
      .filter(Boolean)
      .join(" "),
    `T-${thread.slice(-8)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  if (/[\p{Cc}\p{Cf}]/u.test(label) || Buffer.byteLength(label) > 128)
    throw new Error(
      "Herdr labels must have no control characters and fit in 128 UTF-8 bytes; shorten the title.",
    );
  return { thread, hostname: `amp-${thread.slice(2).toLowerCase()}`, label };
}

function output(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function interactive(command: string, args: string[], env = process.env): void {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} failed (${result.signal || result.status}); inspect before retrying.`,
    );
}

export type Peer = {
  HostName: string;
  DNSName?: string;
  Online?: boolean;
  Tags?: string[];
  TailscaleIPs?: string[];
  SSH_HostKeys?: string[];
};

export function orbPeers(status: { Peer?: Record<string, Peer> }): Peer[] {
  return Object.values(status.Peer || {}).filter((peer) =>
    peer.Tags?.includes("tag:amp-orb"),
  );
}

export function list() {
  // Preserve Amp's native list schema rather than inventing a thread API or
  // claiming offline/paused orbs can be discovered from Tailscale alone.
  return {
    threads: JSON.parse(output("amp", ["threads", "list", "--json"])),
    peers: orbPeers(JSON.parse(output("tailscale", ["status", "--json"]))),
    machines: JSON.parse(output("herdr", ["machine", "list", "--json"])),
  };
}

// Trust comes from the authenticated local Tailscale control plane, never a
// network key scan. Pin once in OpenSSH's native store; changed keys fail closed.
export function pinHostKeys(
  host: string,
  keys: string[],
  file = join(homedir(), ".ssh", "known_hosts"),
): void {
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(host))
    throw new Error("Expected a plain SSH hostname.");
  if (!keys.length)
    throw new Error(
      "No Tailscale SSH host keys advertised; ordinary sshd or an unready orb is not eligible.",
    );
  for (const key of keys) {
    if (
      !/^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/]+={0,2}$/.test(
        key,
      )
    )
      throw new Error("Invalid advertised SSH host key.");
    execFileSync("ssh-keygen", ["-lf", "-"], {
      input: `${key}\n`,
      stdio: ["pipe", "ignore", "pipe"],
      timeout: 5000,
    });
  }
  if (existsSync(file)) {
    const result = spawnSync("ssh-keygen", ["-F", host, "-f", file], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.error || (result.status !== 0 && result.status !== 1))
      throw new Error("Unable to check existing SSH host trust.");
    const existing = result.stdout
      .split("\n")
      .filter((line) => line && !line.startsWith("#"));
    if (existing.length) {
      if (
        existing.some((line) => {
          const fields = line.trim().split(/\s+/);
          return (
            fields[0].startsWith("@") ||
            !keys.includes(fields.slice(1, 3).join(" "))
          );
        })
      )
        throw new Error(
          "SSH host key changed or has a trust marker; review the orb identity and existing known_hosts entry explicitly. Nothing replaced.",
        );
      return;
    }
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(
    file,
    `\n${keys.map((key) => `${host} ${key}`).join("\n")}\n`,
    { mode: 0o600 },
  );
}

export function connect(orb: Orb, user = "user"): void {
  const { hostname, label } = identity(orb);
  if (!/^[a-z_][a-z0-9_-]*\$?$/.test(user))
    throw new Error("Expected a Unix SSH user name.");
  const peers = orbPeers(
    JSON.parse(output("tailscale", ["status", "--json"])),
  ).filter((peer) => peer.HostName === hostname);
  if (peers.length !== 1 || !peers[0].Online)
    throw new Error(
      `No unique online ${hostname}. Open the Amp thread to wake it and verify its resume hook; SSH cannot wake an orb.`,
    );
  const host =
    peers[0].DNSName?.replace(/\.$/, "") ||
    peers[0].TailscaleIPs?.find((ip) => /^100\./.test(ip));
  if (!host || !/^[a-z0-9][a-z0-9.-]*$/i.test(host))
    throw new Error("Orb has no usable DNS name or IPv4 address.");
  const target = `${user}@${host}`;
  pinHostKeys(host, peers[0].SSH_HostKeys ?? []);
  // Respect user SSH configuration, but never prompt or accept an unknown key.
  // A custom known_hosts path must include the pinned native store.
  output("ssh", [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ForwardAgent=no",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "ControlPath=none",
    target,
    "true",
  ]);
  const machines = JSON.parse(
    output("herdr", ["machine", "list", "--json"]),
  ) as { target: string; session: string; label: string; enabled: boolean }[];
  if (
    machines.some(
      (machine) => machine.target === target && machine.session === "orb",
    )
  ) {
    console.log(
      "Already saved in Herdr; use its native machine commands to rename, enable or reconnect it.",
    );
    return;
  }
  // Native interactive setup preserves SSH host-key checks and asks before any
  // remote installation/replacement. Never retry an uncertain mutation.
  interactive("herdr", [
    "machine",
    "add",
    target,
    "--label",
    label,
    "--remote-session",
    "orb",
  ]);
}

// Caller installs pinned tools explicitly (e.g. its Nix shell/profile). Setup
// writes only dormant service definitions; it never authenticates or starts them.
export const setupScript: string = `set +x
unset CLICKSTACK_OTLP_ENDPOINT CLICKSTACK_API_KEY OTEL_DOCKER_STATS
[ "\${AMP_ORB:-}" = 1 ] || { echo 'Setup is only for an Amp orb.' >&2; exit 1; }
[ ! -e "$HOME/.local/state/factory-amp" ] || { echo 'Refusing to snapshot an already activated Factory orb.' >&2; exit 1; }
# Debian omits administrative tools from the unprivileged user's PATH.
# Keep caller-selected (e.g. pinned Nix) binaries ahead of system fallbacks.
export PATH="$PATH:/usr/sbin:/sbin"
for tool in tailscale tailscaled herdr pi sudo systemctl sort; do
  command -v "$tool" >/dev/null || { echo "Install $tool explicitly before setup." >&2; exit 1; }
done
version=$(tailscale version | head -n 1)
[[ "$version" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+$ ]] && [ "$(printf '%s\\n' 1.104.4 "$version" | sort -V | head -n 1)" = 1.104.4 ] || {
  echo 'Tailscale SSH requires a stable Tailscale >= 1.104.4.' >&2; exit 1
}
TAILSCALED=$(command -v tailscaled)
[[ "$TAILSCALED" =~ ^/[a-zA-Z0-9/._+-]+$ ]] || { echo 'Service executable must have a plain absolute path.' >&2; exit 1; }
sudo -n true
sudo test ! -e /etc/systemd/system/factory-amp-sshd.service || { echo 'Legacy orb: do not migrate an existing SSH service in place.' >&2; exit 1; }
sudo test ! -e /run/factory-amp/otel.env || { echo 'Refusing to snapshot collector runtime credentials.' >&2; exit 1; }
sudo test ! -e /var/lib/factory-amp/tailscaled.state || { echo 'Refusing to snapshot an existing Tailscale identity.' >&2; exit 1; }
sudo test ! -e /var/lib/factory-amp/ssh || { echo 'Refusing to snapshot existing Tailscale SSH host keys.' >&2; exit 1; }
if sudo systemctl is-active --quiet factory-amp-tailscaled.service || sudo systemctl is-active --quiet factory-amp-otel.service; then
  echo 'Refusing to rewrite running Factory orb services.' >&2; exit 1
fi
sudo tee /etc/systemd/system/factory-amp-tailscaled.service >/dev/null <<EOF
[Unit]
Description=Factory Amp private network and Tailscale SSH
After=network-online.target
[Service]
ExecStart=$TAILSCALED --state=/var/lib/factory-amp/tailscaled.state --statedir=/var/lib/factory-amp --socket=/run/factory-amp/tailscaled.sock
# Native Tailscale otherwise reuses readable system sshd keys. Hide only those
# files in this service namespace, without modifying Amp's SSH service.
InaccessiblePaths=-/etc/ssh/ssh_host_rsa_key -/etc/ssh/ssh_host_ecdsa_key -/etc/ssh/ssh_host_ed25519_key
Environment=TS_ASSUME_NETWORK_UP_FOR_TEST=true
Environment=TS_SSH_DISABLE_FORWARDING=1
RuntimeDirectory=factory-amp
StateDirectory=factory-amp
Restart=on-failure
EOF
# Native Herdr discovery checks ~/.local/bin even without the development shell.
# Never replace a different user-owned entry.
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/factory-amp"
for tool in herdr pi; do
  target=$(readlink -f "$(command -v "$tool")")
  link="$HOME/.local/bin/$tool"
  if [ -e "$link" ] || [ -L "$link" ]; then
    [ "$(readlink "$link")" = "$target" ] || { echo "Preserve existing $link; reconcile explicitly." >&2; exit 1; }
  else
    ln -s "$target" "$link"
  fi
  if [[ "$target" == /nix/store/* ]]; then
    store=\${target#/nix/store/}
    store="/nix/store/\${store%%/*}"
    nix-store --add-root "$HOME/.local/share/factory-amp/$tool" --indirect --realise "$store" >/dev/null
  fi
done
# Explicit native selection prepares a dormant agent. Copy nonsecret configs
# and the complete JS distribution so the service needs no checkout/node_modules.
if [ -n "\${OTEL_COLLECTOR_BINARY:-}" ] && [ -n "\${FACTORY_AMP_OTEL_CLI:-}" ]; then
  node=$(command -v node)
  collector=$OTEL_COLLECTOR_BINARY
  install="$HOME/.local/share/factory-amp/otel"
  for path in "$node" "$collector" "$install" "$FACTORY_AMP_OTEL_CLI" "\${OTEL_COLLECTOR_CONFIG:-}" "\${OTEL_COLLECTOR_DOCKER_CONFIG:-}"; do
    [[ "$path" =~ ^/[a-zA-Z0-9/._+-]+$ ]] || { echo 'Select plain absolute OTel artifact paths.' >&2; exit 1; }
  done
  mkdir -p "$install"
  cp -R "$(dirname "$FACTORY_AMP_OTEL_CLI")/." "$install/"
  printf '%s\\n' '{"type":"module"}' > "$install/package.json"
  cp "$OTEL_COLLECTOR_CONFIG" "$install/host.yaml"
  cp "$OTEL_COLLECTOR_DOCKER_CONFIG" "$install/docker.yaml"
  # Store-backed Node and collector executables must survive orb GC too.
  for tool in node otelcol-contrib; do
    target=$node
    [ "$tool" != otelcol-contrib ] || target=$collector
    if [[ "$target" == /nix/store/* ]]; then
      store=\${target#/nix/store/}
      store="/nix/store/\${store%%/*}"
      nix-store --add-root "$HOME/.local/share/factory-amp/otel-$tool" --indirect --realise "$store" >/dev/null
    fi
  done
  sudo tee /etc/systemd/system/factory-amp-otel.service >/dev/null <<EOF
[Unit]
Description=Factory host metrics to ClickHouse Observability
[Service]
User=$(id -un)
EnvironmentFile=/run/factory-amp/otel.env
Environment=OTEL_COLLECTOR_BINARY=$collector
Environment=OTEL_COLLECTOR_CONFIG=$install/host.yaml
Environment=OTEL_COLLECTOR_DOCKER_CONFIG=$install/docker.yaml
ExecStart=$node $install/cli.js collector
TimeoutStopSec=6
KillMode=control-group
StandardOutput=null
StandardError=null
EOF
fi
sudo systemctl daemon-reload
`;

export const resumeScript: string = `set +x
[ "\${AMP_ORB:-}" = 1 ] || { echo 'Resume is only for an Amp orb.' >&2; exit 1; }
: "\${TAILSCALE_CLIENT_ID:?Set the workspace enrollment client ID}"
: "\${TAILSCALE_AUDIENCE:?Set the workspace enrollment audience}"
: "\${FACTORY_AMP_THREAD:?Supply verified runtime thread metadata}"
: "\${FACTORY_AMP_HOSTNAME:?Supply the thread-derived hostname}"
sudo -n true
sudo test ! -e /etc/systemd/system/factory-amp-sshd.service || { echo 'Legacy orb: preserve its SSH service and session; use a new approved orb.' >&2; exit 1; }
umask 077
state="$HOME/.local/state/factory-amp"
mkdir -p "$state"
if [ -f "$state/thread" ] && [ "$(<"$state/thread")" != "$FACTORY_AMP_THREAD" ]; then
  echo 'Runtime identity belongs to another thread; do not reuse an activated snapshot.' >&2; exit 1
fi
printf '%s' "$FACTORY_AMP_THREAD" > "$state/thread"
sudo systemctl start factory-amp-tailscaled.service
socket=/run/factory-amp/tailscaled.sock
for ((attempt=0; attempt<50; attempt++)); do
  [ -S "$socket" ] && break
  sleep 0.1
done
[ -S "$socket" ] || { echo 'tailscaled did not create its socket.' >&2; exit 1; }
token_file=$(mktemp)
trap 'rm -f "$token_file"' EXIT
amp orb id-token --audience "$TAILSCALE_AUDIENCE" --subject-scope workspace > "$token_file"
TAILSCALE=$(command -v tailscale)
sudo "$TAILSCALE" --socket="$socket" up \\
  --client-id="\${TAILSCALE_CLIENT_ID}?ephemeral=true&preauthorized=true" \\
  --id-token="file:$token_file" --advertise-tags=tag:amp-orb --hostname="$FACTORY_AMP_HOSTNAME" --ssh
rm -f "$token_file"
# No separate sshd, authorized_keys, port forwarding or model credentials.
# Tailscale SSH authorization is owned by the tailnet policy.
`;

export function setup(): void {
  interactive(
    "bash",
    ["--noprofile", "--norc", "-euo", "pipefail", "-c", setupScript],
    {
      ...process.env,
      FACTORY_AMP_OTEL_CLI: fileURLToPath(
        import.meta.resolve("@quantile-co/factory-otel/cli"),
      ),
    },
  );
}

// /run is volatile runtime storage, never the setup snapshot or checkout. Remove
// the environment file after systemd loads it; resume refreshes credentials.
export function resumeCollector(
  repository: string | undefined,
  thread: string,
): void {
  if (process.env.AMP_ORB !== "1") return;
  const file = "/run/factory-amp/otel.env";
  const run = (args: string[], input?: string) =>
    execFileSync("sudo", ["-n", ...args], {
      input,
      timeout: 8_000,
      stdio: [input === undefined ? "ignore" : "pipe", "ignore", "ignore"],
    });
  const disabled =
    !process.env.CLICKSTACK_OTLP_ENDPOINT && !process.env.CLICKSTACK_API_KEY;
  if (disabled) {
    try {
      run(["systemctl", "is-active", "--quiet", "factory-amp-otel.service"]);
    } catch {
      return;
    } // An absent/inactive optional service is not a resume failure.
  }
  try {
    run(["systemctl", "stop", "factory-amp-otel.service"]);
    if (disabled) return;
    const config = managedConfig();
    if (!config) return;
    const values = {
      OTEL_AGENT_PLATFORM: "amp-orb",
      OTEL_AGENT_THREAD_ID: thread,
      OTEL_AGENT_REPOSITORY: repository ?? "",
      CLICKSTACK_OTLP_ENDPOINT: config.endpoint,
      CLICKSTACK_API_KEY: config.key,
      OTEL_DOCKER_STATS: process.env.OTEL_DOCKER_STATS === "1" ? "1" : "0",
    };
    run(
      ["install", "-m", "0600", "/dev/stdin", file],
      `${Object.entries(values)
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join("\n")}\n`,
    );
    run(["systemctl", "restart", "factory-amp-otel.service"]);
  } catch {
    console.error("OTel orb collector unavailable; resume continues.");
  } finally {
    try {
      run(["rm", "-f", file]);
    } catch {
      /* No raw sudo diagnostics. */
    }
  }
}

export async function resume(
  orb: Omit<Orb, "thread"> & { thread?: string },
  repository: string,
): Promise<void> {
  if (process.env.AMP_ORB !== "1")
    throw new Error("Resume is only for an Amp orb.");
  const audience = process.env.TAILSCALE_AUDIENCE;
  if (!audience || !process.env.TAILSCALE_CLIENT_ID)
    throw new Error(
      "Set the approved workspace TAILSCALE_CLIENT_ID and TAILSCALE_AUDIENCE first.",
    );
  // Decode our own runtime token for naming only. Tailscale, not this local
  // metadata lookup, verifies the token when authorizing enrollment.
  const token = output("amp", [
    "orb",
    "id-token",
    "--audience",
    audience,
    "--subject-scope",
    "workspace",
  ]);
  let current: string;
  try {
    current = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    ).thread_id;
    if (typeof current !== "string") throw new Error();
  } catch {
    throw new Error(
      "Amp did not return a runtime thread identity; do not enroll during setup.",
    );
  }
  const { thread, hostname, label } = identity({ ...orb, thread: current });
  if (orb.thread && identity({ ...orb, thread: orb.thread }).thread !== thread)
    throw new Error(
      "Requested thread does not match this orb's runtime identity.",
    );
  if (!isAbsolute(repository))
    throw new Error("Repository path must be absolute.");
  const root = realpathSync(repository);
  if (
    realpathSync(
      output("git", ["-C", root, "rev-parse", "--show-toplevel"]),
    ) !== root
  )
    throw new Error("Select the exact disposable repository root.");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FACTORY_AMP_REPOSITORY: root,
    FACTORY_AMP_THREAD: thread,
    FACTORY_AMP_HOSTNAME: hostname,
  };
  // A dedicated session must not inherit another Herdr client's local socket.
  delete env.HERDR_SOCKET_PATH;
  delete env.HERDR_CLIENT_SOCKET_PATH;
  interactive(
    "bash",
    ["--noprofile", "--norc", "-euo", "pipefail", "-c", resumeScript],
    env,
  );
  const inventory = () =>
    JSON.parse(
      execFileSync("herdr", ["--session", "orb", "workspace", "list"], {
        env,
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).result.workspaces as {
      workspace_id: string;
      worktree?: { checkout_path: string };
    }[];
  let spaces: ReturnType<typeof inventory> | undefined;
  try {
    spaces = inventory();
  } catch {
    const server = spawn("herdr", ["--session", "orb", "server"], {
      cwd: root,
      env,
      detached: true,
      stdio: "ignore",
    });
    server.on("error", () => {}); // Readiness below reports failure, without retrying startup.
    server.unref();
    for (let attempt = 0; attempt < 30; attempt++) {
      await delay(200);
      try {
        spaces = inventory();
        break;
      } catch {
        /* Server is still starting. */
      }
    }
  }
  if (!spaces)
    throw new Error(
      "Herdr did not become ready; inspect its orb session logs before retrying.",
    );
  const workspace = spaces.find(
    (space) => space.worktree?.checkout_path === root,
  );
  if (spaces.length === 0)
    execFileSync(
      "herdr",
      [
        "--session",
        "orb",
        "workspace",
        "create",
        "--cwd",
        root,
        "--label",
        label,
        "--no-focus",
      ],
      { env, stdio: "ignore" },
    );
  else if (workspace)
    execFileSync(
      "herdr",
      [
        "--session",
        "orb",
        "workspace",
        "rename",
        workspace.workspace_id,
        label,
      ],
      { env, stdio: "ignore" },
    );
  resumeCollector(orb.repository, thread);
  console.log(
    `Ready: ${hostname}. Attach with ~/.local/bin/herdr --session orb; in the repository pane run nix develop --command pi. Existing agents were not replaced or prompted.`,
  );
}
