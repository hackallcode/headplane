import type { PreAuthKey, User } from "~/types";

const OWNER_ACTIONS = new Set(["rename", "delete", "expire"]);

// Tags, routes and owner change what a machine may reach, so only roles that write machines get them.
export function ownerMayRun(action: string) {
  return OWNER_ACTIONS.has(action);
}

export function ownedKeys<T extends { user: User | null; preAuthKeys: PreAuthKey[] }>(
  keys: T[],
  headscaleUserId: string | undefined,
) {
  return headscaleUserId === undefined ? [] : keys.filter((k) => k.user?.id === headscaleUserId);
}
