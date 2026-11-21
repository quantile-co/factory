import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as direnv from "./direnv.ts";
import { registerGateway } from "./gateway.ts";
import * as git from "./git.ts";
import { createHerdr } from "./herdr.ts";
import { traceClassifier } from "./langfuse.ts";
import { registerLatest } from "./latest.ts";
import { selectChild } from "./model.ts";
import { registerPi } from "./pi.ts";
import * as terminal from "./terminal.ts";

export default function (api: ExtensionAPI) {
  registerGateway(api);
  registerLatest(api);
  registerPi(api, {
    git,
    direnv,
    terminal,
    selectChild,
    traceClassifier,
    herdr: createHerdr({ git }),
  });
}
