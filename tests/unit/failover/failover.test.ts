import { afterEach, describe, expect, test, vi } from "vitest";

import { readServers, requestTakeover, summarize } from "~/server/failover";

const config = {
  token: "s3cret",
  servers: [
    { name: "RU", url: "http://100.64.0.110:8480" },
    { name: "NL", url: "http://100.64.0.120:8480/" },
  ],
};

const RU = "62.0.0.1";
const NL = "157.0.0.1";

function state(
  selfIp: string,
  activeIp: string,
  active: number,
  extra: {
    serving?: number;
    unseen?: number;
    requested?: boolean;
    lastAction?: string;
    history?: { at: number; event: string }[];
    vote?: { at: number; view: Record<string, { ok: boolean; fail_since: number | null }> } | null;
  } = {},
) {
  return {
    self_ip: selfIp,
    server_name: "mesh.example.com",
    active_ip: activeIp,
    last_action: extra.lastAction ?? (active ? "serve" : "standby"),
    takeover_requested: extra.requested ?? false,
    takeover_after: 300,
    history: extra.history ?? [],
    vote: extra.vote ?? null,
    metrics: {
      active,
      serving: extra.serving ?? active,
      active_unseen_seconds: extra.unseen ?? 0,
      fenced: 0,
      dns_ok: 1,
      vote_age_seconds: 12,
      replication_errors: 0,
    },
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
  test("the server the name points at and that serves leads", () => {
    const summary = summarize([
      { name: "RU", state: state(RU, RU, 1) },
      { name: "NL", state: state(NL, RU, 0) },
    ]);
    expect(summary).toMatchObject({ phase: "leading", leader: "RU", dnsTarget: "RU" });
  });

  test("a requested takeover is a switch to the requested server", () => {
    const summary = summarize([
      { name: "RU", state: state(RU, RU, 1) },
      { name: "NL", state: state(NL, RU, 0, { requested: true }) },
    ]);
    expect(summary).toMatchObject({ phase: "switching", leader: "RU", requested: "NL" });
  });

  test("a takeover still restoring the database is a switch, not a free server", () => {
    const summary = summarize([
      { name: "RU", state: state(RU, RU, 1) },
      { name: "NL", state: state(NL, NL, 1, { serving: 0, lastAction: "takeover" }) },
    ]);
    expect(summary).toMatchObject({ phase: "switching", leader: "RU", requested: "NL" });
  });

  test("the name moved but the old server still serves: switching", () => {
    const summary = summarize([
      { name: "RU", state: state(RU, NL, 0, { serving: 1 }) },
      { name: "NL", state: state(NL, NL, 1, { serving: 0 }) },
    ]);
    expect(summary).toMatchObject({ phase: "switching", leader: "RU", dnsTarget: "NL" });
  });

  test("nobody serves: no leader, the name says who should", () => {
    const summary = summarize([
      { name: "RU", state: state(RU, RU, 1, { serving: 0 }) },
      { name: "NL", state: state(NL, RU, 0) },
    ]);
    expect(summary).toMatchObject({ phase: "no_leader", dnsTarget: "RU" });
    expect(summary.leader).toBeUndefined();
  });

  test("two servers serving is a split", () => {
    const summary = summarize([
      { name: "RU", state: state(RU, RU, 1) },
      { name: "NL", state: state(NL, NL, 1) },
    ]);
    expect(summary.phase).toBe("split");
  });

  test("goes by any reachable server when the active one is down", () => {
    const summary = summarize([
      { name: "RU", error: "connect ETIMEDOUT" },
      { name: "NL", state: state(NL, RU, 0, { unseen: 120 }) },
    ]);
    expect(summary).toMatchObject({ phase: "no_leader", activeIp: RU });
    expect(summary.dnsTarget).toBeUndefined();
    expect(summary.countdown).toEqual({ server: "NL", unseen: 120, after: 300 });
  });

  test("no countdown while the standby still sees the active", () => {
    const summary = summarize([
      { name: "RU", state: state(RU, RU, 1) },
      { name: "NL", state: state(NL, RU, 0, { unseen: 30 }) },
    ]);
    expect(summary.countdown).toBeUndefined();
  });

  test("merges both histories, newest first", () => {
    const summary = summarize([
      {
        name: "RU",
        state: state(RU, RU, 1, {
          history: [
            { at: 100, event: "stopped" },
            { at: 300, event: "took over" },
          ],
        }),
      },
      { name: "NL", state: state(NL, RU, 0, { history: [{ at: 200, event: "took over" }] }) },
    ]);
    expect(summary.history).toEqual([
      { at: 300, server: "RU", event: "took over" },
      { at: 200, server: "NL", event: "took over" },
      { at: 100, server: "RU", event: "stopped" },
    ]);
  });

  test("takes the witness's newest vote and names the servers in it", () => {
    const summary = summarize([
      {
        name: "RU",
        state: state(RU, RU, 1, {
          vote: { at: 900, view: { [RU]: { ok: true, fail_since: null } } },
        }),
      },
      {
        name: "NL",
        state: state(NL, RU, 0, {
          vote: {
            at: 960,
            view: { [RU]: { ok: false, fail_since: 930 }, [NL]: { ok: true, fail_since: null } },
          },
        }),
      },
    ]);
    expect(summary.witness).toEqual({
      at: 960,
      view: [
        { server: "RU", ok: false, failSince: 930, standby: false },
        { server: "NL", ok: true, failSince: null, standby: true },
      ],
    });
  });

  test("a stopped standby the witness cannot reach is a standby, not an outage", () => {
    const vote = {
      at: 960,
      view: { [RU]: { ok: true, fail_since: null }, [NL]: { ok: false, fail_since: 100 } },
    };
    const summary = summarize([
      { name: "RU", state: state(RU, RU, 1, { vote }) },
      { name: "NL", state: state(NL, RU, 0, { vote }) },
    ]);
    expect(summary.witness?.view).toEqual([
      { server: "RU", ok: true, failSince: null, standby: false },
      { server: "NL", ok: false, failSince: 100, standby: true },
    ]);
  });

  test("no witness without a vote", () => {
    const summary = summarize([{ name: "RU", state: state(RU, RU, 1) }]);
    expect(summary.witness).toBeUndefined();
  });

  test("nothing reachable is unknown", () => {
    expect(summarize([{ name: "RU", error: "x" }]).phase).toBe("unknown");
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
