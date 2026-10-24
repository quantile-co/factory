import { execFile } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

// Approval does not evaluate .envrc. Never use `direnv exec` for this preflight.
export async function trust(
  primary: string,
  checkout: string,
  signal?: AbortSignal,
): Promise<void> {
  primary = realpathSync(primary);
  checkout = realpathSync(checkout);
  const source = join(primary, ".envrc");
  const target = join(checkout, ".envrc");
  if (
    !lstatSync(source, { throwIfNoEntry: false }) &&
    !lstatSync(target, { throwIfNoEntry: false })
  )
    return;
  const regular = (path: string) => {
    if (!lstatSync(path, { throwIfNoEntry: false })?.isFile())
      throw new Error(
        `Direnv trust requires a regular file at ${path}; inspect and approve it explicitly.`,
      );
    return readFileSync(path);
  };
  const run = async (command: string, args: string[], cwd: string) =>
    (await execute(command, args, { cwd, signal, timeout: 30000 })).stdout;
  const status = async (cwd: string, path: string): Promise<number> => {
    const result = JSON.parse(await run("direnv", ["status", "--json"], cwd));
    const found = result.state?.foundRC;
    if (found?.path !== path || ![0, 1, 2].includes(found.allowed))
      throw new Error(`Cannot verify direnv approval for ${path}.`);
    return found.allowed;
  };
  const contents = regular(target);
  const allowed = await status(checkout, target);
  // Native direnv states: 0 allowed, 1 not yet allowed, 2 explicitly denied.
  if (allowed === 0) return;
  if (allowed === 2)
    throw new Error(
      `Direnv explicitly denied ${target}; approval was not changed.`,
    );
  if (existsSync(join(checkout, ".envrc.local")))
    throw new Error(
      `Local .envrc.local exists in ${checkout}; review and approve this environment explicitly.`,
    );
  if (!contents.equals(regular(source)))
    throw new Error(
      `Worktree .envrc differs from ${source}; review and approve it explicitly.`,
    );
  // Reuse an operator's existing approval, never silently approve the primary.
  if ((await status(primary, source)) !== 0)
    throw new Error(
      `Approve the reviewed primary environment first: direnv allow '${primary}'. No worktree approval was changed.`,
    );
  await run("git", ["ls-files", "--error-unmatch", "--", ".envrc"], primary);
  await run("git", ["diff", "--quiet", "HEAD", "--", ".envrc"], primary);
  if (!contents.equals(regular(source)) || !contents.equals(regular(target)))
    throw new Error(
      "Direnv files changed during trust verification; no approval was copied.",
    );
  await run("direnv", ["allow", checkout], checkout);
  if (
    !contents.equals(regular(target)) ||
    (await status(checkout, target)) !== 0
  )
    throw new Error(
      "Worktree direnv approval could not be verified; inspect before continuing.",
    );
}
