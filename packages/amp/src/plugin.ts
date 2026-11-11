// Structural subset of https://ampcode.com/docs/plugin-api.
// No runtime imports: the built file can be installed as a native Amp plugin.
type Lease = { unsubscribe(): void };
type Context = { ui: { notify(message: string): Promise<void> } };
export type AmpPlugin = {
  system: { executor: { keepAlive(): Promise<Lease> } };
  registerCommand(
    name: string,
    options: { title: string; category: string; description: string },
    handler: (ctx: Context) => Promise<void>,
  ): unknown;
};

export default function plugin(amp: AmpPlugin): void {
  let lease: Lease | undefined;
  // Serialize repeated clicks without leaking an untracked lease.
  let pending = Promise.resolve();
  amp.registerCommand(
    "factory-orb-awake",
    {
      title: "Toggle keep awake",
      category: "Factory orb",
      description:
        "Explicitly keep this orb awake (billed runtime), or release it. Best effort; not a wake command.",
    },
    (ctx) => {
      const toggle = pending.then(async () => {
        if (lease) {
          lease.unsubscribe();
          lease = undefined;
          await ctx.ui.notify(
            "Keep-awake released; normal Amp idle timeouts apply.",
          );
        } else {
          lease = await amp.system.executor.keepAlive();
          await ctx.ui.notify(
            "Orb kept awake until toggled off or this plugin exits. Runtime is billed; manual pauses and provider limits still apply.",
          );
        }
      });
      pending = toggle.catch(() => {});
      return toggle;
    },
  );
}
