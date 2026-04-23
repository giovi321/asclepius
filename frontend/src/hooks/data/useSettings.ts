import { createResource } from "./createResource";

// Raw /settings config. Shape is an open-ended dict mirroring settings.yaml
// (pipeline, backup, prompts, oidc, ...). Consumers read whichever subtree
// they care about.
export const useSettings = createResource<Record<string, any>>("/settings");
