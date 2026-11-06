export interface FailoverConfig {
  token: string;
  servers: { name: string; url: string }[];
}

export interface FailoverState {
  self_ip: string;
  server_name: string;
  active_ip: string | null;
  takeover_requested: boolean;
  metrics: Record<string, number>;
}

export type FailoverServer =
  | { name: string; state: FailoverState; error?: undefined }
  | { name: string; error: string; state?: undefined };

const TIMEOUT_MS = 4000;

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

export function summarize(servers: FailoverServer[]) {
  const activeIp = servers.find((s) => s.state?.active_ip)?.state?.active_ip ?? undefined;
  const active = servers.find((s) => s.state && s.state.self_ip === activeIp)?.name;
  return { active, activeIp };
}

export async function requestTakeover(config: FailoverConfig, name: string) {
  const server = config.servers.find((s) => s.name === name);
  if (!server) {
    throw new Error(`Unknown server ${name}`);
  }
  await call(config, server.url, "/takeover", "POST");
}
