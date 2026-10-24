import { spawn } from "node:child_process";

export interface Options {
  cwd: string;
  shell: string;
  args: string[];
  screen: {
    stop(): void;
    start(): void;
    requestRender(force?: boolean): void;
  };
  signal?: AbortSignal;
}

export interface Result {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
}

export async function run(command: string, options: Options): Promise<Result> {
  options.signal?.throwIfAborted();
  let result: Result = { exitCode: null, signal: null };
  try {
    options.screen.stop();
    process.stdout.write(
      `\n[foreground] ${command}\nThe session will resume when the command exits.\n\n`,
    );
    result = await new Promise<Result>((resolve) => {
      const child = spawn(options.shell, [...options.args, command], {
        cwd: options.cwd,
        stdio: "inherit",
        signal: options.signal,
      });
      let error: string | undefined;
      child.once("error", (cause) => {
        error = cause.message;
      });
      // Wait for close even after an error so the caller does not reclaim the TTY early.
      child.once("close", (exitCode, signal) =>
        resolve({ exitCode, signal, error }),
      );
    });
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    options.screen.start();
    options.screen.requestRender(true);
  }
  return result;
}
