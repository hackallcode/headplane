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
    name,
    self_ip: `${name}-ip`,
    candidate: true,
    serving: false,
    action: "standby",
    leader: "ru",
    term: 7,
    desired: null,
    lease_ok: true,
    etcd_ok: true,
    error: null,
    members: [
      { name: "ru", client: "https://100.64.0.110:2379" },
      { name: "nl", client: "https://100.64.0.120:2379" },
      { name: "pi", client: "https://100.64.0.50:2379" },
    ],
    queue: ["ru", "nl"],
    snapshot: { term: 7, by: "ru", at: 900, bytes: 20000 },
    history: [],
    ...extra,
  };
}

const ruLeads = state("ru", { serving: true, action: "serve" });

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
});

describe("summarize", () => {
  test("the elected leader that serves leads", () => {
    const summary = summarize([
      { name: "ru", state: ruLeads },
      { name: "nl", state: state("nl") },
    ]);
    expect(summary).toMatchObject({ phase: "leading", leader: "ru", term: 7, serving: ["ru"] });
    expect(summary.members.map((m) => m.name)).toEqual(["ru", "nl", "pi"]);
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

  test("an empty queue is no leader", () => {
    const summary = summarize([{ name: "ru", state: state("ru", { leader: null, queue: [] }) }]);
    expect(summary.phase).toBe("no_leader");
  });

  test("two serving is a split", () => {
    const summary = summarize([
      { name: "ru", state: ruLeads },
      { name: "nl", state: state("nl", { serving: true }) },
    ]);
    expect(summary.phase).toBe("split");
  });

  test("goes by a server that holds its lease", () => {
    const summary = summarize([
      { name: "ru", state: state("ru", { lease_ok: false, etcd_ok: false, leader: null }) },
      { name: "nl", state: state("nl", { leader: "nl", serving: true, term: 9 }) },
    ]);
    expect(summary).toMatchObject({ phase: "leading", leader: "nl", term: 9 });
  });

  test("nobody in the quorum is unknown", () => {
    const summary = summarize([
      { name: "ru", state: state("ru", { lease_ok: false }) },
      { name: "nl", error: "x" },
    ]);
    expect(summary.phase).toBe("unknown");
  });

  test("history newest first", () => {
    const history = [
      { at: 100, server: "ru", event: "became leader (term 5)" },
      { at: 300, server: "nl", event: "became leader (term 9)" },
    ];
    const summary = summarize([{ name: "ru", state: { ...ruLeads, history } }]);
    expect(summary.history.map((h) => h.at)).toEqual([300, 100]);
  });
});

describe("requestTakeover", () => {
  test("posts the request to the named server", async () => {
    const fetch = vi.fn(async () => new Response('{"takeover_requested": true}', { status: 202 }));
    vi.stubGlobal("fetch", fetch);

    await requestTakeover(config, "nl");

    expect(fetch).toHaveBeenCalledWith(
      "http://100.64.0.120:8480/takeover",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer s3cret" } }),
    );
  });

  test("refuses an unknown server", async () => {
    await expect(requestTakeover(config, "de")).rejects.toThrow("Unknown server de");
  });

  test("fails when the server refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    await expect(requestTakeover(config, "ru")).rejects.toThrow("HTTP 503");
  });
});
