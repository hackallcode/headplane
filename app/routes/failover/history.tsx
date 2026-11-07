import { useState } from "react";

import Button from "~/components/button";
import { Row, RowList } from "~/components/section";
import type { FailoverSummary } from "~/server/failover";
import { formatTimeDelta } from "~/utils/time";

const HISTORY_COLLAPSED = 5;

export default function History({ history }: { history: FailoverSummary["history"] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  if (history.length === 0) {
    return <p className="text-muted text-sm">No switches recorded yet.</p>;
  }

  const shown = isExpanded ? history : history.slice(0, HISTORY_COLLAPSED);
  return (
    <>
      <RowList>
        {shown.map((h) => (
          <Row key={`${h.node}-${h.at}-${h.event}`}>
            <span className="flex gap-3">
              <span
                className="text-muted w-24 shrink-0"
                suppressHydrationWarning
                title={new Date(h.at * 1000).toLocaleString()}
              >
                {formatTimeDelta(new Date(h.at * 1000))}
              </span>
              <span className="min-w-0">
                <span className="font-medium">{h.node}</span> {h.event}
              </span>
            </span>
          </Row>
        ))}
      </RowList>
      {history.length > HISTORY_COLLAPSED ? (
        <Button
          className="mt-2"
          onClick={() => setIsExpanded(!isExpanded)}
          size="sm"
          variant="ghost"
        >
          {isExpanded ? "Show less" : `Show ${history.length - HISTORY_COLLAPSED} more`}
        </Button>
      ) : undefined}
    </>
  );
}
