#!/usr/bin/env node
import { connect, list, resume, setup } from "@quantile-co/factory-amp";
import { Command, Option } from "commander";

const cli = new Command()
  .name("factory-amp")
  .description(
    "Explicit Amp orb lifecycle and native Herdr connections; no automatic wake or agent prompting.",
  );
function task(command: Command) {
  return command
    .option("--repo <org/repo>", "GitHub repository for the label")
    .option("--project <name>", "Label for a non-GitHub project")
    .option("--issue <number>", "Optional GitHub issue number", Number)
    .option("--title <text>", "Short task title");
}
cli
  .command("setup")
  .description("Prepare dormant orb services; caller must install tools first")
  .action(setup);
task(cli.command("resume"))
  .description(
    "Join the tailnet and start the orb Herdr session; no agent is prompted",
  )
  .option(
    "--thread <id-or-url>",
    "Verify this thread against the runtime Amp identity",
  )
  .requiredOption("--directory <path>", "Absolute disposable Git checkout root")
  .addOption(
    new Option(
      "--authorized-keys <path>",
      "Runtime public authorized_keys file (never a private key)",
    )
      .env("FACTORY_AMP_AUTHORIZED_KEYS")
      .makeOptionMandatory(),
  )
  .action(async (options) =>
    resume(
      { ...options, repository: options.repo },
      options.directory,
      options.authorizedKeys,
    ),
  );
cli
  .command("list")
  .description(
    "List native Amp threads, tagged Tailscale peers and saved Herdr machines",
  )
  .action(() => console.log(JSON.stringify(list(), null, 2)));
task(cli.command("connect"))
  .description(
    "Save an online orb as a Herdr SSH machine; native setup may ask for approval",
  )
  .requiredOption("--thread <id-or-url>", "Amp thread")
  .option("--user <name>", "Orb SSH user", "user")
  .action((options) =>
    connect({ ...options, repository: options.repo }, options.user),
  );

try {
  await cli.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
