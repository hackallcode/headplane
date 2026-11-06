export interface FailoverConfig {
  token: string;
  servers: { name: string; url: string }[];
  witness?: string;
}

export interface FailoverState {
  name: string;
  self_ip: string;
  candidate: boolean;
  serving: boolean;
  action: string;
  leader: string | null;
  term: number | null;
  desired: string | null;
  lease_ok: boolean;
  etcd_ok: boolean;
  error: string | null;
  members: { name: string; client: string | null }[];
  queue: string[];
  snapshot: { term: number; by: string; at: number; bytes: number } | null;
  history: { at: number; server: string; event: string }[];
}

export type FailoverPhase = "leading" | "switching" | "no_leader" | "split" | "unknown";

export interface FailoverSummary {
  phase: FailoverPhase;
  leader?: string;
  serving: string[];
  requested?: string;
  term?: number;
  queue: string[];
  members: string[];
  snapshot?: FailoverState["snapshot"];
  history: FailoverState["history"];
}

export type FailoverServer =
  | { name: string; state: FailoverState; error?: undefined }
  | { name: string; error: string; state?: undefined };

const TIMEOUT_MS = 4000;
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
  const view = reachable.find((s) => s.state.etcd_ok && s.state.lease_ok)?.state;
  const serving = reachable.filter((s) => s.state.serving).map((s) => s.name);
  const leader = view?.leader ?? undefined;
  const requested = view?.desired ?? undefined;

  let phase: FailoverPhase;
  if (!view) {
    phase = "unknown";
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
    term: view?.term ?? undefined,
    queue: view?.queue ?? [],
    members: (view?.members ?? []).map((m) => m.name),
    snapshot: view?.snapshot ?? undefined,
    history: [...(view?.history ?? [])].sort((a, b) => b.at - a.at).slice(0, HISTORY_SHOWN),
  };
}

export async function requestTakeover(config: FailoverConfig, name: string) {
  const server = config.servers.find((s) => s.name === name);
  if (!server) {
    throw new Error(`Unknown server ${name}`);
  }
  await call(config, server.url, "/takeover", "POST");
}
