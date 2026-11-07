import { describe, expect, test, vi } from "vitest";

import type { Principal } from "~/server/web/auth";
import { addDeviceOptions } from "~/server/web/ownership";
import { Capabilities, hasCapability } from "~/server/web/roles";
import type { Machine } from "~/types";

import { createTestAuth } from "./create-auth";

vi.mock("~/utils/log", () => ({
  default: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

function principal(role: "user" | "viewer" | "member", headscaleUserId?: string): Principal {
  return {
    kind: "oidc",
    sessionId: "s",
    user: { id: "u1", subject: "sub1", role, headscaleUserId },
    profile: { name: "Test" },
  };
}

function node(id: string, userId: string): Machine {
  return {
    id,
    machineKey: "",
    nodeKey: "",
    discoKey: "",
    ipAddresses: [],
    name: id,
    lastSeen: "",
    expiry: null,
    createdAt: "",
    registerMethod: "REGISTER_METHOD_OIDC",
    tags: [],
    givenName: id,
    online: true,
    approvedRoutes: [],
    availableRoutes: [],
    subnetRoutes: [],
    user: { id: userId, name: userId, createdAt: "" },
  };
}

const nodes = [node("mine", "hs-1"), node("theirs", "hs-2")];

describe("user role", () => {
  test("opens the UI for its own machines and keys only", () => {
    expect(hasCapability("user", "ui_access")).toBe(true);
    expect(hasCapability("user", "read_own_machines")).toBe(true);
    expect(hasCapability("user", "generate_own_authkeys")).toBe(true);
    expect(hasCapability("user", "read_machines")).toBe(false);
    expect(hasCapability("user", "write_machines")).toBe(false);
    expect(hasCapability("user", "read_users")).toBe(false);
  });
});

describe("visibleNodes", () => {
  const { auth } = createTestAuth();

  test("a user sees only its own machines", () => {
    expect(auth.visibleNodes(principal("user", "hs-1"), nodes).map((n) => n.id)).toEqual(["mine"]);
  });

  test("a user not linked to a headscale user sees none", () => {
    expect(auth.visibleNodes(principal("user"), nodes)).toEqual([]);
  });

  test("a role that reads machines sees all of them", () => {
    expect(auth.visibleNodes(principal("viewer", "hs-1"), nodes)).toHaveLength(2);
  });

  test("a member sees none", () => {
    expect(auth.visibleNodes(principal("member", "hs-1"), nodes)).toEqual([]);
  });

  test("an API key sees all of them", () => {
    const apiKey: Principal = { kind: "api_key", sessionId: "s", apiKey: "k", displayName: "k" };
    expect(auth.visibleNodes(apiKey, nodes)).toHaveLength(2);
  });

  test("can() treats read_own_machines as its own capability", () => {
    expect(auth.can(principal("user", "hs-1"), Capabilities.read_own_machines)).toBe(true);
    expect(auth.can(principal("user", "hs-1"), Capabilities.read_machines)).toBe(false);
  });
});

describe("addDeviceOptions", () => {
  test("an admin may register keys and generate any pre-auth key", () => {
    expect(
      addDeviceOptions({ writable: true, anyKeys: true, ownKeys: true, linked: true }),
    ).toEqual({
      disabled: false,
      register: true,
      preAuth: true,
    });
  });

  test("a linked user may generate a pre-auth key for itself only", () => {
    expect(
      addDeviceOptions({ writable: false, anyKeys: false, ownKeys: true, linked: true }),
    ).toEqual({
      disabled: false,
      register: false,
      preAuth: true,
    });
  });

  test("a user without a device yet can only log in from one", () => {
    expect(
      addDeviceOptions({ writable: false, anyKeys: false, ownKeys: true, linked: false }),
    ).toEqual({
      disabled: false,
      register: false,
      preAuth: false,
    });
  });

  test("without any of it the button is off", () => {
    expect(
      addDeviceOptions({ writable: false, anyKeys: false, ownKeys: false, linked: true }).disabled,
    ).toBe(true);
  });
});
