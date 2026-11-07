import * as v from "valibot";

import type { HeadplaneConfig } from "~/server/config/config-schema";
import { AGENT_TIMEOUT_MS } from "~/utils/failover";

export type FailoverConfig = NonNullable<HeadplaneConfig["failover"]>;

const AGENT_ACTIONS = [
  "starting",
  "standby",
  "taking over",
  "serving",
  "held",
  "handing over",
  "fenced",
] as const;

export type FailoverAction = (typeof AGENT_ACTIONS)[number];

const stateSchema = v.object({
  service: v.string(),
  node: v.string(),
  address: v.string(),
  candidate: v.boolean(),
  cluster_ok: v.boolean(),
  serving: v.boolean(),
  action: v.picklist(AGENT_ACTIONS),
  leader: v.nullable(v.string()),
  term: v.nullable(v.number()),
  desired: v.nullable(v.string()),
  error: v.nullable(v.string()),
  position: v.nullable(
    v.object({ txids: v.record(v.string(), v.number()), node: v.string(), term: v.number() }),
  ),
  history: v.array(v.object({ at: v.number(), node: v.string(), event: v.string() })),
});

export type FailoverState = v.InferOutput<typeof stateSchema>;

export type FailoverPhase =
  | "leading"
  | "switching"
  | "no_leader"
  | "split"
  | "no_quorum"
  | "unreachable";

export interface FailoverSummary {
  phase: FailoverPhase;
  leader?: string;
  serving: string[];
  requested?: string;
  standbys: string[];
  position?: FailoverState["position"];
  history: FailoverState["history"];
}

export type FailoverServer =
  | { name: string; state: FailoverState; error?: undefined }
  | { name: string; error: string; state?: undefined };

const HISTORY_SHOWN = 20;

function endpoint(url: string, path: string) {
  return `${url.replace(/\/+$/, "")}${path}`;
}

async function call(config: FailoverConfig, url: string, path: string, method = "GET") {
  const response = await fetch(endpoint(url, path), {
    method,
    headers: { Authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export async function readServers(config: FailoverConfig): Promise<FailoverServer[]> {
  return Promise.all(
    config.servers.map(async ({ name, url }): Promise<FailoverServer> => {
      try {
        const answer = v.safeParse(stateSchema, await call(config, url, "/state"));
        if (!answer.success) {
          return { name, error: "Unexpected answer from the agent" };
        }
        if (answer.output.node !== name) {
          return { name, error: `The agent answers as ${answer.output.node}` };
        }
        return { name, state: answer.output };
      } catch (error) {
        return { name, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}

export function summarize(servers: FailoverServer[]): FailoverSummary {
  const reachable = servers.filter(
    (s): s is Extract<FailoverServer, { state: FailoverState }> => s.state !== undefined,
  );
  const view = reachable.find((s) => s.state.cluster_ok)?.state;
  const serving = reachable.filter((s) => s.state.serving).map((s) => s.name);
  const leader = view?.leader ?? undefined;
  const requested = view?.desired ?? undefined;

  let phase: FailoverPhase;
  if (reachable.length === 0) {
    phase = "unreachable";
  } else if (!view) {
    phase = "no_quorum";
  } else if (serving.length > 1) {
    phase = "split";
  } else if (!leader) {
    phase = "no_leader";
  } else if (requested || !serving.includes(leader)) {
    phase = "switching";
  } else {
    phase = "leading";
  }

  return {
    phase,
    leader,
    serving,
    requested,
    standbys: reachable
      .filter((s) => s.state.candidate && s.state.cluster_ok && s.state.node !== leader)
      .map((s) => s.name),
    position: view?.position ?? undefined,
    history: [...(view?.history ?? [])].sort((a, b) => b.at - a.at).slice(0, HISTORY_SHOWN),
  };
}

export interface FailoverSnapshot {
  servers: FailoverServer[];
  summary: FailoverSummary;
}

export async function readFailover(config: FailoverConfig): Promise<FailoverSnapshot> {
  const servers = await readServers(config);
  return { servers, summary: summarize(servers) };
}

export async function requestTakeover(config: FailoverConfig, url: string) {
  await call(config, url, "/takeover", "POST");
}
