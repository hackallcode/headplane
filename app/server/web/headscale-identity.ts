import type { User } from "~/types/User";

import type { AuthService, UserPrincipal } from "./auth";

/**
 * Extracts the OIDC subject from a Headscale user's providerId.
 * Headscale stores providerId as a URL where the last path segment
 * is the subject (e.g. "https://idp.example.com/<uuid>"). This is
 * the ONLY place this parsing should occur — all other code should
 * use the stable headscale_user_id link on the Headplane user record.
 */
export function getOidcSubject(user: User): string | undefined {
  if (user.provider !== "oidc" || !user.providerId) {
    return;
  }

  const segment = user.providerId.split("/").pop();
  return segment ? decodeURIComponent(segment) : segment;
}

/**
 * Finds the Headscale user matching the given OIDC identity.
 * Tries subject match first (providerId last segment), then falls
 * back to email match. The fallback is needed because some IDPs
 * issue different subjects per client application.
 */
export function findHeadscaleUserBySubject(
  users: User[],
  subject: string,
  email?: string,
): User | undefined {
  const bySubject = users.find((u) => getOidcSubject(u) === subject);
  if (bySubject) {
    return bySubject;
  }

  if (!email) {
    return;
  }

  return users.find((u) => u.email === email);
}

export function allowedByGroups(groups: string[], allowed: string[]): boolean {
  return allowed.length === 0 || groups.some((g) => allowed.includes(g));
}

/**
 * Links a signed-in Headplane user to its Headscale user once Headscale
 * creates it, which happens when the user registers their first device
 * after signing in to Headplane.
 */
export async function linkOwnHeadscaleUser(
  auth: AuthService,
  principal: UserPrincipal,
  listUsers: () => Promise<User[]>,
): Promise<void> {
  if (principal.user.headscaleUserId) {
    return;
  }

  const hsUser = findHeadscaleUserBySubject(
    await listUsers(),
    principal.user.subject,
    principal.profile.email,
  );
  if (hsUser && (await auth.linkHeadscaleUser(principal.user.id, hsUser.id))) {
    principal.user.headscaleUserId = hsUser.id;
  }
}
