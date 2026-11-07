import React from "react";
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

const BADGE = {
  good: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  bad: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
} as const;

function Badge({ text, tone }: { text: string; tone: keyof typeof BADGE }) {
  return <Chip text={text} className={`px-2 font-medium ${BADGE[tone]}`} />;
}

function ago(now: number, at?: number) {
  if (!at) {
    return "never";
  }
  const s = Math.max(0, Math.round(now - at));
  if (s < 60) {
    return `${s} s ago`;
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)} min ago`;
  }
  if (s < 86400) {
    return `${Math.floor(s / 3600)} h ago`;
  }
  return `${Math.floor(s / 86400)} d ago`;
}

function Fact({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <Text>
      <span className="font-medium">{label}: </span>
      <span className={bad ? "text-red-600 dark:text-red-400" : undefined}>{value}</span>
    </Text>
  );
}

interface FactListItem {
  key: string;
  marker: React.ReactNode;
  text: string;
  extra?: React.ReactNode;
}

function FactList({
  label,
  items,
  empty,
}: {
  label: string;
  items: FactListItem[];
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Text className="font-medium">{label}</Text>
      {items.length ? (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-2">
              <span className="flex w-4 justify-center">{item.marker}</span>
              <Text>{item.text}</Text>
              {item.extra}
            </li>
          ))}
        </ul>
      ) : (
        <Text className="text-red-600 dark:text-red-400">{empty}</Text>
      )}
    </div>
  );
}

function Status({ summary }: { summary: FailoverSummary }) {
  const { phase, leader, requested, serving } = summary;
  if (phase === "leading") {
    return undefined;
  }

  const status: Record<
    Exclude<typeof phase, "leading">,
    { tone: keyof typeof BADGE; title: string; text: string }
  > = {
    switching: {
      tone: "warn",
      title: `Switching to ${requested ?? leader ?? "the next candidate"}`,
      text: `${requested ?? leader ?? "The new leader"} takes the database from etcd, sends clients to itself and starts headscale; the other one stops on its own.`,
    },
    no_leader: {
      tone: "bad",
      title: "No leader",
      text: "No candidate is queued in etcd: neither server can serve headscale.",
    },
    split: {
      tone: "bad",
      title: "Two servers serve at once",
      text: `${serving.join(" and ")} both run headscale; the one that does not lead stops at its next check.`,
    },
    unknown: {
      tone: "bad",
      title: "No quorum",
      text: "No server holds its etcd lease: headscale is stopped everywhere until two etcd members see each other.",
    },
  };
  const current = status[phase];

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Badge text={current.title} tone={current.tone} />
      </div>
      <Text>{current.text}</Text>
    </div>
  );
}

function ServerCard({
  server,
  summary,
  writable,
}: {
  server: FailoverServer;
  summary: FailoverSummary;
  writable: boolean;
}) {
  const state = server.state;
  const isLeader = summary.leader === server.name && Boolean(state?.serving);
  const isTakingOver =
    !isLeader && (summary.requested === server.name || summary.leader === server.name);
  const canSwitch =
    writable &&
    state?.candidate &&
    state.lease_ok &&
    !isLeader &&
    !isTakingOver &&
    summary.phase === "leading";

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <StatusCircle isOnline={state !== undefined} className="h-4 w-4" />
        <Card.Title className="mb-0">{server.name}</Card.Title>
        {isLeader ? <Badge text="Leader" tone="good" /> : undefined}
        {isTakingOver ? <Badge text="Taking over" tone="warn" /> : undefined}
      </div>

      {state ? (
        <div className="flex flex-col gap-1">
          <Fact label="Address" value={state.self_ip} />
          <Fact
            label="headscale"
            value={state.serving ? "serving" : "stopped"}
            bad={summary.leader === server.name && !state.serving}
          />
          <Fact label="Doing" value={state.action} />
          <Fact label="etcd lease" value={state.lease_ok ? "held" : "lost"} bad={!state.lease_ok} />
          {state.error ? <Fact label="Error" value={state.error} bad /> : undefined}
        </div>
      ) : (
        <Notice variant="error" title="Unreachable">
          {server.error}
        </Notice>
      )}

      {canSwitch ? (
        <Dialog>
          <Button variant="heavy">Make {server.name} active</Button>
          <DialogPanel variant="destructive">
            <Title>Make {server.name} the control server?</Title>
            <Text>
              The current leader saves the database to etcd and steps down; {server.name} takes it,
              sends clients to itself and starts headscale. Clients reconnect without logging in
              again.
            </Text>
            <input name="server" type="hidden" value={server.name} />
          </DialogPanel>
        </Dialog>
      ) : undefined}
    </Card>
  );
}

function EtcdCard({ summary, now }: { summary: FailoverSummary; now: number }) {
  const { snapshot } = summary;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <StatusCircle isOnline={summary.phase !== "unknown"} className="h-4 w-4" />
        <Card.Title className="mb-0">etcd</Card.Title>
        <Chip text={summary.term ? `term ${summary.term}` : "no term"} />
      </div>
      <div className="flex flex-col gap-3">
        <FactList
          label="Members"
          items={summary.members.map((member) => ({
            key: member.name,
            marker: <StatusCircle isOnline={member.ok !== false} className="h-3 w-3" />,
            text: member.name,
            extra: (
              <>
                {member.raft_leader ? <Chip text="raft leader" /> : undefined}
                {member.ok === false ? <Badge text="not answering" tone="bad" /> : undefined}
              </>
            ),
          }))}
          empty="unknown"
        />
        <FactList
          label="Failover priority"
          items={summary.queue.map((name, i) => ({
            key: name,
            marker: <span className="text-sm text-mist-500">{i + 1}</span>,
            text: name,
            extra: summary.queue.length < 2 ? <Badge text="no standby" tone="bad" /> : undefined,
          }))}
          empty="nobody"
        />
        <Fact
          label="Database"
          value={
            snapshot
              ? `${Math.round(snapshot.bytes / 1024)} KB from ${snapshot.by}, ${ago(now, snapshot.at)}`
              : "no snapshot"
          }
          bad={!snapshot}
        />
      </div>
    </Card>
  );
}

function History({ history }: { history: FailoverSummary["history"] }) {
  if (history.length === 0) {
    return <Text>No switches recorded yet.</Text>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {history.map((h) => (
        <li key={`${h.server}-${h.at}-${h.event}`}>
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

export default function Page({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();

  return (
    <div className="flex max-w-(--breakpoint-lg) flex-col gap-8">
      <div className="flex w-full flex-col sm:w-2/3">
        <Title>Failover</Title>
        <Text>
          The candidates elect one control server through etcd; it carries the database to the next
          one.
        </Text>
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
          />
        ))}
        <EtcdCard summary={loaderData.summary} now={loaderData.now} />
      </div>

      <div className="flex flex-col gap-2">
        <Title>History</Title>
        <History history={loaderData.summary.history} />
      </div>
    </div>
  );
}
