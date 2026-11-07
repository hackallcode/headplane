import { describe, expect, test, vi } from "vitest";

import type { UserPrincipal } from "~/server/web/auth";
import {
  allowedByGroups,
  findHeadscaleUserBySubject,
  getOidcSubject,
  linkOwnHeadscaleUser,
} from "~/server/web/headscale-identity";
import type { User } from "~/types/User";

import { createTestAuth } from "./create-auth";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "1",
    name: "test",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("getOidcSubject", () => {
  test("returns undefined for non-OIDC users", () => {
    expect(getOidcSubject(makeUser({ provider: "local" }))).toBeUndefined();
    expect(getOidcSubject(makeUser())).toBeUndefined();
  });

  test("returns undefined when providerId is missing", () => {
    expect(getOidcSubject(makeUser({ provider: "oidc" }))).toBeUndefined();
    expect(getOidcSubject(makeUser({ provider: "oidc", providerId: "" }))).toBeUndefined();
  });

  test("returns last path segment from providerId URL", () => {
    const user = makeUser({
      provider: "oidc",
      providerId: "https://idp.example.com/abc-123",
    });
    expect(getOidcSubject(user)).toBe("abc-123");
  });
});

describe("findHeadscaleUserBySubject", () => {
  const oidcUser = makeUser({
    id: "1",
    provider: "oidc",
    providerId: "https://idp.example.com/sub-1",
    email: "alice@example.com",
  });

  const localUser = makeUser({
    id: "2",
    provider: "local",
    email: "bob@example.com",
  });

  const users = [oidcUser, localUser];

  test("matches by subject first", () => {
    expect(findHeadscaleUserBySubject(users, "sub-1")).toBe(oidcUser);
  });

  test("falls back to email if no subject match", () => {
    expect(findHeadscaleUserBySubject(users, "no-match", "bob@example.com")).toBe(localUser);
  });

  test("returns undefined if no email and no subject match", () => {
    expect(findHeadscaleUserBySubject(users, "no-match")).toBeUndefined();
  });

  test("prefers subject match over email match", () => {
    const otherOidc = makeUser({
      id: "3",
      provider: "oidc",
      providerId: "https://idp.example.com/sub-2",
      email: "alice@example.com",
    });

    expect(findHeadscaleUserBySubject([oidcUser, otherOidc], "sub-2", "alice@example.com")).toBe(
      otherOidc,
    );
  });
});

describe("allowedByGroups", () => {
  test("lets everyone in when no groups are required", () => {
    expect(allowedByGroups([], [])).toBe(true);
  });

  test("needs any one of the required groups", () => {
    expect(allowedByGroups(["home", "mesh"], ["mesh", "admin"])).toBe(true);
    expect(allowedByGroups(["home"], ["mesh", "admin"])).toBe(false);
    expect(allowedByGroups([], ["mesh"])).toBe(false);
  });
});

describe("linkOwnHeadscaleUser", () => {
  async function signedIn(sub: string, email?: string) {
    const { auth } = createTestAuth();
    await auth.findOrCreateUser("sub-owner");
    const id = await auth.findOrCreateUser(sub, { name: "Mesh", email });
    const cookie = await auth.createOidcSession(id, { name: "Mesh", email });
    const request = new Request("http://localhost/", { headers: { cookie: cookie.split(";")[0] } });
    return { auth, principal: (await auth.require(request)) as UserPrincipal, id };
  }

  test("links the Headscale user that appeared after sign-in", async () => {
    const { auth, principal, id } = await signedIn("sub-mesh");
    const hsUser = makeUser({ id: "3", provider: "oidc", providerId: "https://idp/sub-mesh" });

    await linkOwnHeadscaleUser(auth, principal, async () => [makeUser({ id: "2" }), hsUser]);

    expect(principal.user.headscaleUserId).toBe("3");
    expect((await auth.listUsers()).find((u) => u.id === id)?.headscale_user_id).toBe("3");
  });

  test("leaves the user unlinked while it has no Headscale user", async () => {
    const { auth, principal } = await signedIn("sub-mesh");

    await linkOwnHeadscaleUser(auth, principal, async () => [makeUser({ id: "2" })]);

    expect(principal.user.headscaleUserId).toBeUndefined();
  });

  test("does not ask Headscale for a linked user", async () => {
    const { auth, principal } = await signedIn("sub-mesh");
    principal.user.headscaleUserId = "3";
    const list = vi.fn(async () => []);

    await linkOwnHeadscaleUser(auth, principal, list);

    expect(list).not.toHaveBeenCalled();
  });
});
