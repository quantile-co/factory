#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

function exists(path) {
  return lstatSync(path, { throwIfNoEntry: false });
}

function matches(source, target) {
  const actual = exists(target);
  if (!actual || actual.isSymbolicLink()) return false;
  const expected = statSync(source);
  if (expected.isDirectory()) {
    if (!actual.isDirectory()) return false;
    const entries = readdirSync(source).sort();
    const present = readdirSync(target).sort();
    return (
      entries.length === present.length &&
      entries.every(
        (name, index) =>
          name === present[index] &&
          matches(join(source, name), join(target, name)),
      )
    );
  }
  return (
    expected.isFile() &&
    actual.isFile() &&
    readFileSync(source).equals(readFileSync(target))
  );
}

function writableCopy(source, target) {
  cpSync(source, target, { recursive: true, dereference: true });
  const makeWritable = (from, to) => {
    const info = statSync(from);
    chmodSync(to, (info.mode & 0o777) | 0o200);
    if (info.isDirectory()) {
      for (const name of readdirSync(from))
        makeWritable(join(from, name), join(to, name));
    }
  };
  makeWritable(source, target);
}

function ensureParents(root, path) {
  let directory = root;
  for (const part of relative(root, dirname(path)).split(sep).filter(Boolean)) {
    directory = join(directory, part);
    const info = exists(directory);
    if (info && !info.isDirectory())
      throw new Error(`Refusing non-directory parent: ${directory}`);
    if (!info) mkdirSync(directory);
  }
}

function copy(source, target, root) {
  ensureParents(root, target);
  const old = exists(target);
  if (
    old?.isSymbolicLink() &&
    !readlinkSync(target).startsWith("/nix/store/")
  ) {
    throw new Error(`Refusing unmanaged symlink: ${target}`);
  }
  if (
    old &&
    !old.isSymbolicLink() &&
    statSync(source).isDirectory() !== old.isDirectory()
  ) {
    throw new Error(`Refusing to change file type: ${target}`);
  }
  const temporary = mkdtempSync(join(dirname(target), `.${basename(target)}.`));
  try {
    const staged = join(temporary, "copy");
    writableCopy(source, staged);
    if (
      old?.isDirectory() ||
      (old?.isSymbolicLink() && statSync(source).isDirectory())
    ) {
      rmSync(target, { recursive: old.isDirectory() });
    }
    renameSync(staged, target);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function indexedDrift(root, name, source) {
  const files = execFileSync("git", ["ls-files", "-z", "--", name], {
    cwd: root,
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  return files.some((file) => {
    const subpath = relative(name, file);
    const expected = subpath ? join(source, subpath) : source;
    const info = lstatSync(expected, { throwIfNoEntry: false });
    if (!info || !statSync(expected).isFile()) return true;
    return !execFileSync("git", ["show", `:${file}`], { cwd: root }).equals(
      readFileSync(expected),
    );
  });
}

export function manageFiles(root, entries, action) {
  if (action !== "materialize" && action !== "check")
    throw new Error("Expected materialize or check");
  const drift = [];
  for (const [name, { source, mode }] of Object.entries(entries).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    if (
      !name ||
      isAbsolute(name) ||
      normalize(name) !== name ||
      name.split(sep).includes("..") ||
      name === "."
    ) {
      throw new Error(`Invalid managed path: ${name}`);
    }
    if (!isAbsolute(source) || !["seed", "copy"].includes(mode))
      throw new Error(`Invalid file entry: ${name}`);
    statSync(source);
    const target = resolve(root, name);
    if (action === "check") {
      if (
        mode === "copy" &&
        (!matches(source, target) || indexedDrift(root, name, source))
      )
        drift.push(name);
      continue;
    }
    if (mode === "copy" || !exists(target) || exists(target).isSymbolicLink()) {
      if (mode === "copy" && matches(source, target)) continue;
      copy(source, target, root);
    }
  }
  if (drift.length)
    throw new Error(
      `Copied files differ from fresh copies: ${drift.join(", ")}`,
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [action, manifest] = process.argv.slice(2);
    if (!manifest || process.argv.length !== 4)
      throw new Error("Usage: files.mjs materialize|check MANIFEST");
    manageFiles(
      process.cwd(),
      JSON.parse(readFileSync(manifest, "utf8")),
      action,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
