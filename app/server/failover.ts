export interface FailoverConfig {
  token: string;
  servers: { name: string; url: string }[];
}

export interface FailoverState {
  self_ip: string;
  server_name: string;
  active_ip: string | null;
  last_action?: string | null;
  takeover_requested: boolean;
  takeover_after?: number;
  metrics: Record<string, number>;
  history?: { at: number; event: string }[];
}

export type FailoverPhase = "leading" | "switching" | "no_leader" | "split" | "unknown";

export interface FailoverSummary {
  phase: FailoverPhase;
  activeIp?: string;
  dnsTarget?: string;
  leader?: string;
  requested?: string;
  countdown?: { server: string; unseen: number; after: number };
  history: { at: number; server: string; event: string }[];
}

export type FailoverServer =
  | { name: string; state: FailoverState; error?: undefined }
  | { name: string; error: string; state?: undefined };

const TIMEOUT_MS = 4000;
const COUNTDOWN_AFTER_S = 60;
const HISTORY_SHOWN = 20;

function endpoint(url: string, path: string) {
  return `${url.replace(/\/+$/, "")}${path}`;
}

async function call(config: FailoverConfig, url: string, path: string, method = "GET") {
  const response = await fetch(endpoint(url, path), {
    method,
    headers: { Authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
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
        return { name, state: (await call(config, url, "/state")) as FailoverState };
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
  const activeIp = reachable.find((s) => s.state.active_ip)?.state.active_ip ?? undefined;
  const dnsTarget = reachable.find((s) => s.state.self_ip === activeIp)?.name;
  const serving = reachable.filter((s) => s.state.metrics.serving === 1).map((s) => s.name);
  const leader = serving.length === 1 ? serving[0] : undefined;
  const requested = reachable.find(
    (s) =>
      s.state.takeover_requested ||
      (s.state.last_action === "takeover" && s.state.metrics.serving !== 1),
  )?.name;

  const standby = reachable.find(
    (s) => s.name !== leader && (s.state.metrics.active_unseen_seconds ?? 0) >= COUNTDOWN_AFTER_S,
  );
  const countdown = standby
    ? {
        server: standby.name,
        unseen: standby.state.metrics.active_unseen_seconds,
        after: standby.state.takeover_after ?? 0,
      }
    : undefined;

  const history = reachable
    .flatMap((s) =>
      (s.state.history ?? []).map((h) => ({ at: h.at, server: s.name, event: h.event })),
    )
    .sort((a, b) => b.at - a.at)
    .slice(0, HISTORY_SHOWN);

  let phase: FailoverPhase;
  if (reachable.length === 0) {
    phase = "unknown";
  } else if (serving.length > 1) {
    phase = "split";
  } else if (requested || (leader && dnsTarget && leader !== dnsTarget)) {
    phase = "switching";
  } else if (leader) {
    phase = "leading";
  } else {
    phase = "no_leader";
  }

  return { phase, activeIp, dnsTarget, leader, requested, countdown, history };
}

export async function requestTakeover(config: FailoverConfig, name: string) {
  const server = config.servers.find((s) => s.name === name);
  if (!server) {
    throw new Error(`Unknown server ${name}`);
  }
  await call(config, server.url, "/takeover", "POST");
}
