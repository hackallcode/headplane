import { afterEach, describe, expect, test, vi } from "vitest";

import { type FailoverState, readServers, requestTakeover, summarize } from "~/server/failover";

const config = {
  token: "s3cret",
  servers: [
    { name: "ru", url: "http://100.64.0.110:8480" },
    { name: "nl", url: "http://100.64.0.120:8480/" },
  ],
};

function state(name: string, extra: Partial<FailoverState> = {}): FailoverState {
  return {
    service: "headscale",
    node: name,
    address: `${name}-ip`,
    candidate: true,
    cluster_ok: true,
    serving: false,
    action: "standby",
    leader: "ru",
    term: 7,
    desired: null,
    error: null,
    position: { txids: { headscale: 50, headplane: 3 }, node: "ru", term: 7 },
    history: [],
    ...extra,
  };
}

const ruLeads = state("ru", { serving: true, action: "serving" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readServers", () => {
  test("asks every server for its state with the token", async () => {
    const fetch = vi.fn(
      async (url: string) =>
        new Response(JSON.stringify(url.includes("110") ? ruLeads : state("nl")), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);

    const servers = await readServers(config);

    expect(fetch).toHaveBeenCalledWith(
      "http://100.64.0.120:8480/state",
      expect.objectContaining({ headers: { Authorization: "Bearer s3cret" } }),
    );
    expect(servers.map((s) => [s.name, s.state?.serving])).toEqual([
      ["ru", true],
      ["nl", false],
    ]);
  });

  test("reports an unreachable server instead of failing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("120")) {
          throw new Error("connect ETIMEDOUT");
        }
        return new Response(JSON.stringify(ruLeads), { status: 200 });
      }),
    );

    expect((await readServers(config))[1]).toEqual({ name: "nl", error: "connect ETIMEDOUT" });
  });

  test("reports an answer that is not an agent state instead of trusting it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("120")
          ? new Response(JSON.stringify({ ...state("nl"), action: "dancing" }), { status: 200 })
          : new Response(JSON.stringify(ruLeads), { status: 200 }),
      ),
    );

    expect((await readServers(config))[1]).toEqual({
      name: "nl",
      error: "Unexpected answer from the agent",
    });
  });

  test("reports an agent listed under another name instead of mixing them up", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("120")
          ? new Response(JSON.stringify(state("hacode-nl")), { status: 200 })
          : new Response(JSON.stringify(ruLeads), { status: 200 }),
      ),
    );

    expect((await readServers(config))[1]).toEqual({
      name: "nl",
      error: "The agent answers as hacode-nl",
    });
  });
});

describe("summarize", () => {
  test("the elected leader that serves leads", () => {
    const summary = summarize([
      { name: "ru", state: ruLeads },
      { name: "nl", state: state("nl") },
    ]);
    expect(summary).toMatchObject({ phase: "leading", leader: "ru", serving: ["ru"] });
    expect(summary.standbys).toEqual(["nl"]);
    expect(summary.position?.txids).toEqual({ headscale: 50, headplane: 3 });
  });

  test("a candidate cut off from the cluster is no standby", () => {
    const summary = summarize([
      { name: "ru", state: ruLeads },
      { name: "nl", state: state("nl", { cluster_ok: false }) },
    ]);
    expect(summary.standbys).toEqual([]);
  });

  test("a manual request is a switch until it is served", () => {
    const summary = summarize([
      { name: "ru", state: { ...ruLeads, desired: "nl" } },
      { name: "nl", state: state("nl", { desired: "nl" }) },
    ]);
    expect(summary).toMatchObject({ phase: "switching", requested: "nl" });
  });

  test("an elected leader still restoring is a switch", () => {
    const summary = summarize([
      { name: "ru", state: state("ru", { leader: "nl" }) },
      { name: "nl", state: state("nl", { leader: "nl", action: "taking over" }) },
    ]);
    expect(summary).toMatchObject({ phase: "switching", leader: "nl", serving: [] });
  });

  test("a free lease is no leader", () => {
    const summary = summarize([{ name: "ru", state: state("ru", { leader: null }) }]);
    expect(summary.phase).toBe("no_leader");
  });

  test("two serving is a split", () => {
    const summary = summarize([
      { name: "ru", state: ruLeads },
      { name: "nl", state: state("nl", { serving: true }) },
    ]);
    expect(summary.phase).toBe("split");
  });

  test("goes by a server that reaches the cluster", () => {
    const summary = summarize([
      { name: "ru", state: state("ru", { cluster_ok: false, leader: null }) },
      { name: "nl", state: state("nl", { leader: "nl", serving: true, term: 9 }) },
    ]);
    expect(summary).toMatchObject({ phase: "leading", leader: "nl" });
  });

  test("nobody in the quorum is no quorum", () => {
    const summary = summarize([
      { name: "ru", state: state("ru", { cluster_ok: false }) },
      { name: "nl", error: "x" },
    ]);
    expect(summary.phase).toBe("no_quorum");
  });

  test("no agent answering is unreachable, not a cluster split", () => {
    const summary = summarize([
      { name: "ru", error: "HTTP 401" },
      { name: "nl", error: "HTTP 401" },
    ]);
    expect(summary.phase).toBe("unreachable");
  });

  test("history keeps only the twenty newest events", () => {
    const history = Array.from({ length: 25 }, (_, i) => ((i * 7) % 25) * 100).map((at) => ({
      at,
      node: "ru",
      event: "serving",
    }));
    const summary = summarize([{ name: "ru", state: { ...ruLeads, history } }]);
    expect(summary.history.map((h) => h.at)).toEqual(
      Array.from({ length: 20 }, (_, i) => (24 - i) * 100),
    );
  });
});

describe("requestTakeover", () => {
  test("posts the request with the token", async () => {
    const fetch = vi.fn(async () => new Response('{"takeover_requested": true}', { status: 202 }));
    vi.stubGlobal("fetch", fetch);

    await requestTakeover(config, "http://100.64.0.120:8480/");

    expect(fetch).toHaveBeenCalledWith(
      "http://100.64.0.120:8480/takeover",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer s3cret" } }),
    );
  });

  test("fails when the server refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    await expect(requestTakeover(config, "http://100.64.0.110:8480")).rejects.toThrow("HTTP 503");
  });
});
