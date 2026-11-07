import { CircleCheck } from "lucide-react";

import Callout from "~/components/callout";
import type { FailoverPhase, FailoverSummary } from "~/server/failover";

export default function Status({
  summary,
  switchingTo,
  isReachable,
}: {
  summary: FailoverSummary;
  switchingTo?: string;
  isReachable: boolean;
}) {
  const { leader, serving, standbys, position } = summary;
  const phase: FailoverPhase = switchingTo ? "switching" : summary.phase;
  const target = switchingTo ?? summary.requested ?? leader ?? "the next server";

  const status: Record<
    FailoverPhase,
    { variant: "neutral" | "warning" | "error"; title: string; text: string }
  > = {
    leading: {
      variant: standbys.length > 0 && position ? "neutral" : "warning",
      title: `${leader} is the control server`,
      text:
        standbys.length === 0
          ? "No other server is ready, so nothing takes over if this one fails."
          : position
            ? `${standbys.join(", ")} can take over.`
            : "Its data is not copied anywhere yet, so no other server can take over.",
    },
    switching: {
      variant: "warning",
      title: `Switching to ${target}`,
      text: `${target} takes over the data, points clients to itself and starts headscale; the other server stops on its own.${isReachable ? "" : " This panel moves with it and answers again once it starts there."}`,
    },
    no_leader: {
      variant: "error",
      title: "No active server",
      text: "Headscale is stopped on every server.",
    },
    split: {
      variant: "error",
      title: "Two servers serve at once",
      text: `${serving.join(" and ")} both run headscale; the one that is not active stops at its next check.`,
    },
    no_quorum: {
      variant: "error",
      title: "Servers cut off",
      text: "No server reaches a majority of the cluster: headscale stays stopped until they see each other again.",
    },
    unreachable: {
      variant: "error",
      title: "No agent answers",
      text: "Headplane gets no answer from the failover agent on any server; their errors are listed below.",
    },
  };
  const current = status[phase];
  const copied = position
    ? `Copied: ${Object.entries(position.txids)
        .map(([db, change]) => `${db} up to change ${change}`)
        .join(", ")}`
    : "Nothing copied yet";

  return (
    <Callout
      className="mb-6"
      icon={current.variant === "neutral" ? <CircleCheck /> : undefined}
      title={current.title}
      variant={current.variant}
    >
      {current.text}
      <p className="mt-1 text-xs">{copied}</p>
      {isReachable || phase === "switching" ? undefined : (
        <p className="mt-1 text-xs">
          This panel stopped answering, so the state above may be out of date.
        </p>
      )}
    </Callout>
  );
}
