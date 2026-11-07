import { appConfigContext, authContext } from "~/server/context";
import { readFailover } from "~/server/failover";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/state";

export async function loader({ request, context }: Route.LoaderArgs) {
  const config = context.get(appConfigContext);
  const auth = context.get(authContext);
  await auth.requireCapability(request, Capabilities.read_network);
  if (!config.failover) {
    return Response.json({ error: "Failover is not configured." }, { status: 404 });
  }
  return Response.json(await readFailover(config.failover));
}
