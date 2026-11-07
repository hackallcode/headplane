import { useState } from "react";
import { data, isRouteErrorResponse } from "react-router";
import * as v from "valibot";

import PageError from "~/components/page-error";
import PageHeader from "~/components/page-header";
import Section, { RowList } from "~/components/section";
import { appConfigContext, authContext } from "~/server/context";
import { readFailover, requestTakeover } from "~/server/failover";
import { ActionError, createAction } from "~/server/web/actions";
import { Capabilities } from "~/server/web/roles";
import { ok } from "~/utils/form";
import { toastClientAction } from "~/utils/toast";

import type { Route } from "./+types/overview";
import History from "./history";
import { POLL_AFTER_ERROR_MS, useFailoverSnapshot, useRetry, useSwitch } from "./polling";
import ServerRow from "./server-row";
import Status from "./status";

export async function loader({ request, context }: Route.LoaderArgs) {
  const config = context.get(appConfigContext);
  const auth = context.get(authContext);
  const principal = await auth.requireCapability(request, Capabilities.read_network);
  if (!config.failover) {
    throw data("Failover is not configured.", { status: 404 });
  }

  return {
    ...(await readFailover(config.failover)),
    isWritable: auth.can(principal, Capabilities.write_network),
  };
}

export const action = createAction({
  capability: Capabilities.write_network,
  async setup({ request, context }) {
    const config = context.get(appConfigContext);
    const principal = await context.get(authContext).require(request);
    return { principal, failover: config.failover };
  },
  intents: {
    takeover: {
      fields: { server: v.pipe(v.string(), v.minLength(1, "Choose a server.")) },
      async handler(input, { failover }) {
        if (!failover) {
          throw new ActionError("Failover is not configured.", 404);
        }
        const server = failover.servers.find((s) => s.name === input.server);
        if (!server) {
          throw new ActionError(`Unknown server ${input.server}.`, 400);
        }
        try {
          await requestTakeover(failover, server.url);
        } catch (error) {
          throw new ActionError(
            `${input.server}: ${error instanceof Error ? error.message : String(error)}`,
            500,
          );
        }

        return ok(`Switching to ${input.server}`);
      },
    },
  },
});

export const clientAction = toastClientAction;

export default function Page({ loaderData }: Route.ComponentProps) {
  const [isFast, setIsFast] = useState(false);
  const { snapshot, isReachable } = useFailoverSnapshot(loaderData, isFast);
  const { switchingTo, start } = useSwitch(snapshot.summary);
  const nextIsFast = switchingTo !== undefined || snapshot.summary.phase !== "leading";
  if (nextIsFast !== isFast) {
    setIsFast(nextIsFast);
  }

  return (
    <>
      <PageHeader
        description="Headscale runs on one server at a time; the others keep up-to-date copies of its data and take over if it fails."
        title="Failover"
      />
      <div className="max-w-5xl">
        <Status isReachable={isReachable} summary={snapshot.summary} switchingTo={switchingTo} />
        <Section title="Servers">
          <RowList>
            {snapshot.servers.map((server) => (
              <ServerRow
                isWritable={loaderData.isWritable}
                key={server.name}
                onSwitch={start}
                server={server}
                summary={snapshot.summary}
                switchingTo={switchingTo}
              />
            ))}
          </RowList>
        </Section>
        <Section title="History">
          <History history={snapshot.summary.history} />
        </Section>
      </div>
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  useRetry(isRouteErrorResponse(error) ? undefined : POLL_AFTER_ERROR_MS);
  return <PageError error={error} page="failover" />;
}
