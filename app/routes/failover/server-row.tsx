import ActionDialog from "~/components/action-dialog";
import Button from "~/components/button";
import Chip from "~/components/chip";
import { Row } from "~/components/section";
import StatusCircle from "~/components/status-circle";
import type { FailoverAction, FailoverServer, FailoverSummary } from "~/server/failover";

const ROLE_SHOWN_ACTIONS: FailoverAction[] = ["serving", "standby"];

export default function ServerRow({
  server,
  summary,
  isWritable,
  switchingTo,
  onSwitch,
}: {
  server: FailoverServer;
  summary: FailoverSummary;
  isWritable: boolean;
  switchingTo?: string;
  onSwitch: (server: string) => void;
}) {
  const state = server.state;
  const isLeader = summary.leader === server.name && Boolean(state?.serving);
  const isTakingOver =
    !isLeader &&
    (switchingTo === server.name ||
      summary.requested === server.name ||
      summary.leader === server.name);
  const canSwitch =
    !switchingTo &&
    isWritable &&
    state?.candidate &&
    state.cluster_ok &&
    !isLeader &&
    !isTakingOver &&
    summary.phase === "leading";

  let role = <Chip text="Standby" />;
  if (!state) {
    role = <Chip text="Unreachable" variant="bad" />;
  } else if (isLeader) {
    role = <Chip text="Active" />;
  } else if (isTakingOver) {
    role = <Chip text="Taking over" variant="warn" />;
  } else if (!state.candidate) {
    role = <Chip text="Never active" />;
  } else if (!state.cluster_ok) {
    role = <Chip text="Cut off" variant="bad" />;
  }

  return (
    <Row
      action={
        canSwitch ? (
          <ActionDialog
            description={`The active server stops and hands over its latest data; ${server.name} starts headscale and points clients to itself. Clients reconnect without logging in again.`}
            fields={{ server: server.name }}
            intent="takeover"
            isDestructive
            onSuccess={() => onSwitch(server.name)}
            submitLabel="Switch"
            title={`Make ${server.name} the control server?`}
            trigger={<Button size="sm">Make active</Button>}
          />
        ) : undefined
      }
    >
      <span className="flex items-center gap-2 font-medium">
        <StatusCircle isOnline={state !== undefined} />
        {server.name}
        {role}
      </span>
      <div className="text-muted mt-0.5 ml-[15px] flex flex-wrap gap-x-2 gap-y-1 text-xs">
        {state ? (
          <>
            <span className="font-mono">{state.address}</span>
            <span className={summary.leader === server.name && !state.serving ? "text-bad" : ""}>
              headscale {state.serving ? "running" : "stopped"}
            </span>
            <span className={state.cluster_ok ? "" : "text-bad"}>
              {state.cluster_ok ? "sees the other servers" : "cut off from the other servers"}
            </span>
            {ROLE_SHOWN_ACTIONS.includes(state.action) ? undefined : <span>{state.action}</span>}
            {state.error ? <span className="text-bad">{state.error}</span> : undefined}
          </>
        ) : (
          <span className="text-bad">{server.error}</span>
        )}
      </div>
    </Row>
  );
}
