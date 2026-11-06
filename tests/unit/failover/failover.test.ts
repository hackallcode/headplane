import { afterEach, describe, expect, test, vi } from "vitest";

import { readServers, requestTakeover, summarize } from "~/server/failover";

const config = {
  token: "s3cret",
  servers: [
    { name: "RU", url: "http://100.64.0.110:8480" },
    { name: "NL", url: "http://100.64.0.120:8480/" },
  ],
};

function state(selfIp: string, activeIp: string, active: number) {
  return {
    self_ip: selfIp,
    server_name: "mesh.example.com",
    active_ip: activeIp,
    takeover_requested: false,
    metrics: { active, fenced: 0, dns_ok: 1, vote_age_seconds: 12, replication_errors: 0 },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readServers", () => {
  test("asks every server for its state with the token", async () => {
    const fetch = vi.fn(async (url: string) => {
      const body = url.includes("110")
        ? state("62.0.0.1", "62.0.0.1", 1)
        : state("157.0.0.1", "62.0.0.1", 0);
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);

    const servers = await readServers(config);

    expect(fetch).toHaveBeenCalledWith(
      "http://100.64.0.120:8480/state",
      expect.objectContaining({ headers: { Authorization: "Bearer s3cret" } }),
    );
    expect(servers.map((s) => [s.name, s.state?.metrics.active])).toEqual([
      ["RU", 1],
      ["NL", 0],
    ]);
  });

  test("reports an unreachable server instead of failing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("120")) {
          throw new Error("connect ETIMEDOUT");
        }
        return new Response(JSON.stringify(state("62.0.0.1", "62.0.0.1", 1)), { status: 200 });
      }),
    );

    const servers = await readServers(config);

    expect(servers[1]).toEqual({ name: "NL", error: "connect ETIMEDOUT" });
  });

  test("reports a rejected token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );

    const servers = await readServers(config);

    expect(servers[0]).toEqual({ name: "RU", error: "HTTP 401" });
  });
});

describe("summarize", () => {
  test("names the server the DNS record points at", () => {
    const summary = summarize([
      { name: "RU", state: state("62.0.0.1", "62.0.0.1", 1) },
      { name: "NL", state: state("157.0.0.1", "62.0.0.1", 0) },
    ]);
    expect(summary.active).toBe("RU");
  });

  test("goes by any reachable server when the active one is down", () => {
    const summary = summarize([
      { name: "RU", error: "connect ETIMEDOUT" },
      { name: "NL", state: state("157.0.0.1", "62.0.0.1", 0) },
    ]);
    expect(summary.active).toBeUndefined();
    expect(summary.activeIp).toBe("62.0.0.1");
  });
});

describe("requestTakeover", () => {
  test("posts the request to the named server", async () => {
    const fetch = vi.fn(async () => new Response('{"takeover_requested": true}', { status: 202 }));
    vi.stubGlobal("fetch", fetch);

    await requestTakeover(config, "NL");

    expect(fetch).toHaveBeenCalledWith(
      "http://100.64.0.120:8480/takeover",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer s3cret" } }),
    );
  });

  test("refuses an unknown server", async () => {
    await expect(requestTakeover(config, "DE")).rejects.toThrow("Unknown server DE");
  });

  test("fails when the server refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    await expect(requestTakeover(config, "RU")).rejects.toThrow("HTTP 401");
  });
});
