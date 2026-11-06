import { data, useActionData } from "react-router";

import Button from "~/components/button";
import Card from "~/components/card";
import Dialog, { DialogPanel } from "~/components/dialog";
import Notice from "~/components/notice";
import StatusCircle from "~/components/status-circle";
import Text from "~/components/text";
import Title from "~/components/title";
import { appConfigContext, authContext } from "~/server/context";
import { type FailoverServer, readServers, requestTakeover, summarize } from "~/server/failover";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";

export async function loader({ request, context }: Route.LoaderArgs) {
  const config = context.get(appConfigContext);
  const auth = context.get(authContext);
  const principal = await auth.require(request);

  if (!config.failover) {
    throw data("Failover is not configured", { status: 404 });
  }
  if (!auth.can(principal, Capabilities.read_network)) {
    throw data("You do not have permission to view this page.", { status: 403 });
  }

  const servers = await readServers(config.failover);
  return {
    servers,
    ...summarize(servers),
    writable: auth.can(principal, Capabilities.write_network),
    now: Date.now() / 1000,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const config = context.get(appConfigContext);
  const auth = context.get(authContext);
  const principal = await auth.require(request);

  if (!config.failover || !auth.can(principal, Capabilities.write_network)) {
    throw data("You do not have permission to switch the control server.", { status: 403 });
  }

  const name = String((await request.formData()).get("server") ?? "");
  try {
    await requestTakeover(config.failover, name);
    return { requested: name };
  } catch (error) {
    return { error: `${name}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function age(now: number, timestamp?: number) {
  if (!timestamp) {
    return "never";
  }
  return `${Math.max(0, Math.round(now - timestamp))} s ago`;
}

function Fact({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <Text>
      <span className="font-medium">{label}: </span>
      <span className={bad ? "text-red-600 dark:text-red-400" : undefined}>{value}</span>
    </Text>
  );
}

function ServerCard({
  server,
  isActive,
  writable,
  now,
}: {
  server: FailoverServer;
  isActive: boolean;
  writable: boolean;
  now: number;
}) {
  const metrics = server.state?.metrics ?? {};
  const voteAge = metrics.vote_age_seconds;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <StatusCircle isOnline={server.state !== undefined} className="h-4 w-4" />
        <Card.Title className="mb-0">{server.name}</Card.Title>
        {isActive ? <span className="text-sm font-medium">active</span> : undefined}
      </div>

      {server.state ? (
        <div className="flex flex-col gap-1">
          <Fact label="Address" value={server.state.self_ip} />
          <Fact label="Fenced" value={metrics.fenced ? "yes" : "no"} bad={metrics.fenced === 1} />
          <Fact
            label="Witness vote"
            value={voteAge === undefined || voteAge < 0 ? "none" : `${voteAge} s old`}
            bad={voteAge === undefined || voteAge < 0 || voteAge > 300}
          />
          <Fact
            label="Replication errors"
            value={String(metrics.replication_errors ?? 0)}
            bad={(metrics.replication_errors ?? 0) > 0}
          />
          <Fact label="DNS API" value={metrics.dns_ok ? "ok" : "down"} bad={metrics.dns_ok === 0} />
          <Fact label="Last check" value={age(now, metrics.last_tick_timestamp_seconds)} />
          {server.state.takeover_requested ? (
            <Notice title="Takeover requested">
              The next check on this server, within a minute, makes it active.
            </Notice>
          ) : undefined}
        </div>
      ) : (
        <Notice variant="error" title="Unreachable">
          {server.error}
        </Notice>
      )}

      {writable && server.state && !isActive && !server.state.takeover_requested ? (
        <Dialog>
          <Button variant="heavy">Make {server.name} active</Button>
          <DialogPanel variant="destructive">
            <Title>Make {server.name} the control server?</Title>
            <Text>
              {server.name} restores the newest replica of the database, points the mesh name at
              itself and starts headscale; the current server stops on its own. Clients reconnect
              without logging in again.
            </Text>
            <input name="server" type="hidden" value={server.name} />
          </DialogPanel>
        </Dialog>
      ) : undefined}
    </Card>
  );
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();

  return (
    <div className="flex max-w-(--breakpoint-lg) flex-col gap-8">
      <div className="flex w-full flex-col sm:w-2/3">
        <Title>Failover</Title>
        <Text>
          Which server runs headscale and how ready the other one is to take over.{" "}
          {loaderData.active
            ? `The mesh name points at ${loaderData.active}.`
            : `The mesh name points at ${loaderData.activeIp ?? "an unknown address"}.`}
        </Text>
      </div>

      {result?.error ? (
        <Notice variant="error" title="Request failed">
          {result.error}
        </Notice>
      ) : undefined}

      <div className="grid gap-4 sm:grid-cols-2">
        {loaderData.servers.map((server) => (
          <ServerCard
            key={server.name}
            server={server}
            isActive={server.name === loaderData.active}
            writable={loaderData.writable}
            now={loaderData.now}
          />
        ))}
      </div>
    </div>
  );
}
