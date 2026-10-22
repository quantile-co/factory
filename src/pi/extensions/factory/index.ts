import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as git from "./git.ts";
import { createHerdr } from "./herdr.ts";
import { registerPi } from "./pi.ts";
import * as terminal from "./terminal.ts";

export default function (api: ExtensionAPI) {
  registerPi(api, { git, terminal, herdr: createHerdr({ git }) });
}
