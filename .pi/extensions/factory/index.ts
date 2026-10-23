import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as direnv from "./direnv.ts";
import * as git from "./git.ts";
import { createHerdr } from "./herdr.ts";
import { selectChild } from "./model.ts";
import { registerPi } from "./pi.ts";
import * as terminal from "./terminal.ts";

export default function (api: ExtensionAPI) {
  registerPi(api, {
    git,
    direnv,
    terminal,
    selectChild,
    herdr: createHerdr({ git }),
  });
}
