import { data, useActionData } from "react-router";

import Button from "~/components/button";
import Card from "~/components/card";
import Chip from "~/components/chip";
import Dialog, { DialogPanel } from "~/components/dialog";
import Notice from "~/components/notice";
import StatusCircle from "~/components/status-circle";
import Text from "~/components/text";
import Title from "~/components/title";
import { appConfigContext, authContext } from "~/server/context";
import {
  type FailoverServer,
  type FailoverSummary,
  readServers,
  requestTakeover,
  summarize,
} from "~/server/failover";
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
    summary: summarize(servers),
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

const BADGE = {
  good: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  bad: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
} as const;

function Badge({ text, tone }: { text: string; tone: keyof typeof BADGE }) {
  return <Chip text={text} className={`px-2 font-medium ${BADGE[tone]}`} />;
}

function Status({ summary }: { summary: FailoverSummary }) {
  const { phase, leader, dnsTarget, requested, activeIp, countdown } = summary;
  const headline = {
    leading: { tone: "good", text: `Leader: ${leader}` },
    switching: {
      tone: "warn",
      text: `Switching: ${leader ?? "nobody"} → ${requested ?? dnsTarget ?? "unknown"}`,
    },
    no_leader: { tone: "bad", text: "No leader" },
    split: { tone: "bad", text: "Two servers serve at once" },
    unknown: { tone: "bad", text: "No server answers" },
  }[phase] as { tone: keyof typeof BADGE; text: string };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Badge text={headline.text} tone={headline.tone} />
      </div>
      <Text>
        The mesh name points at {dnsTarget ?? activeIp ?? "an unknown address"}
        {phase === "no_leader" && dnsTarget ? ", which does not serve yet" : ""}.
        {requested ? ` ${requested} takes over at its next check, within a minute.` : ""}
      </Text>
      {countdown ? (
        <Text>
          {countdown.server} has not seen the leader for {countdown.unseen} s and takes over at{" "}
          {countdown.after} s if the witness agrees.
        </Text>
      ) : undefined}
    </div>
  );
}

function History({ history }: { history: FailoverSummary["history"] }) {
  if (history.length === 0) {
    return <Text>No switches recorded yet.</Text>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {history.map((h) => (
        <li key={`${h.server}-${h.at}`}>
          <Text>
            <span className="font-medium" suppressHydrationWarning>
              {new Date(h.at * 1000).toLocaleString()}
            </span>{" "}
            {h.server}: {h.event}
          </Text>
        </li>
      ))}
    </ul>
  );
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
  summary,
  writable,
  now,
}: {
  server: FailoverServer;
  summary: FailoverSummary;
  writable: boolean;
  now: number;
}) {
  const isLeader = summary.leader === server.name;
  const isTarget = summary.dnsTarget === server.name;
  const metrics = server.state?.metrics ?? {};
  const voteAge = metrics.vote_age_seconds;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <StatusCircle isOnline={server.state !== undefined} className="h-4 w-4" />
        <Card.Title className="mb-0">{server.name}</Card.Title>
        {isLeader ? <Badge text="Leader" tone="good" /> : undefined}
        {isTarget && !isLeader ? <Badge text="Should lead" tone="warn" /> : undefined}
        {server.state?.takeover_requested ? (
          <Badge text="Takeover requested" tone="warn" />
        ) : undefined}
      </div>

      {server.state ? (
        <div className="flex flex-col gap-1">
          <Fact label="Address" value={server.state.self_ip} />
          <Fact
            label="headscale"
            value={metrics.serving ? "serving" : "stopped"}
            bad={isTarget && !metrics.serving}
          />
          <Fact label="Last action" value={server.state.last_action ?? "none"} />
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
        </div>
      ) : (
        <Notice variant="error" title="Unreachable">
          {server.error}
        </Notice>
      )}

      {writable && server.state && !isLeader && !isTarget && !server.state.takeover_requested ? (
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
        <Text>Which server runs headscale and how ready the other one is to take over.</Text>
      </div>

      <Status summary={loaderData.summary} />

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
            summary={loaderData.summary}
            writable={loaderData.writable}
            now={loaderData.now}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Title>History</Title>
        <History history={loaderData.summary.history} />
      </div>
    </div>
  );
}
