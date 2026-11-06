import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Form, Link as RouterLink, redirect, useSearchParams } from "react-router";

import Button from "~/components/button";
import Card from "~/components/card";
import Code from "~/components/code";
import Input from "~/components/input";
import Link from "~/components/link";
import { appConfigContext, authContext, oidcContext } from "~/server/context";
import type { OidcError, OidcService } from "~/server/oidc/provider";
import { useLiveData } from "~/utils/live-data";
import log from "~/utils/log";

import type { Route } from "./+types/page";
import { loginAction } from "./action";
import { OidcConfigErrorNotice, OidcDiscoveryFailedNotice } from "./config-error";
import Logout from "./logout";
import { OidcErrorNotice } from "./oidc-error";

export async function loader({ request, context, url }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const config = context.get(appConfigContext);
  const oidc = context.get(oidcContext);

  try {
    await auth.require(request);
    return redirect("/machines");
  } catch {}

  const qp = url.searchParams;
  const urlState = qp.get("s") ?? undefined;

  const oidcService = oidc.state === "enabled" ? oidc.value : undefined;
  let oidcStatus: ReturnType<OidcService["status"]> | undefined;
  if (oidcService) {
    try {
      const result = await oidcService.discover();
      if (!result.ok) {
        logLoginOidcError("OIDC discovery failed", result.error);
      }
    } catch (error) {
      log.error("auth", "OIDC discovery failed unexpectedly: %s", String(error));
      log.debug("auth", "OIDC discovery error details: %o", error);
    }

    oidcStatus = oidcService.status();
  }

  if (
    oidcService &&
    config.oidc?.disable_api_key_login &&
    oidcStatus?.state === "ready" &&
    urlState !== "logout"
  ) {
    return redirect("/oidc/start");
  }

  const isOidcConnectorEnabled = oidcStatus?.state === "ready";
  const oidcErrorCodes = oidcStatus?.state === "error" ? [oidcStatus.error.code] : [];

  return {
    isCookieSecureEnabled: config.server.cookie_secure,
    isOidcConnectorEnabled,
    oidcErrorCodes,
    urlState,
  };
}

export const action = loginAction;

function logLoginOidcError(context: string, error: OidcError): void {
  log.error("auth", "%s [%s]: %s", context, error.code, error.message);
  if (error.hint) {
    log.error("auth", "Hint: %s", error.hint);
  }
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const { isCookieSecureEnabled, isOidcConnectorEnabled, oidcErrorCodes, urlState } = loaderData;

  const [showCookieWarning, setShowCookieWarning] = useState(false);
  const [params] = useSearchParams();
  const { pause } = useLiveData();

  useEffect(() => {
    // This page does NOT need stale while revalidate logic
    pause();

    if (isCookieSecureEnabled && window.location.protocol !== "https:") {
      setShowCookieWarning(true);
    }
  });

  useEffect(() => {
    // State is a one time thing, we need to remove it after it has
    // Been consumed to prevent logic loops. The logout marker stays so a
    // reload doesn't auto-redirect into OIDC and silently sign back in.
    if (urlState !== undefined && urlState !== "logout") {
      const searchParams = new URLSearchParams(params);
      searchParams.delete("s");

      // Replacing because it's not a navigation, just a cleanup of the URL
      // We can't use the useSearchParams method since it revalidates
      // Which will trigger a full reload
      const newUrl = searchParams.toString()
        ? `${window.location.pathname}?${searchParams.toString()}`
        : window.location.pathname;

      window.history.replaceState(null, "", newUrl);
    }
  }, [urlState, params]);

  if (urlState === "logout") {
    return <Logout />;
  }

  return (
    <div className="flex min-h-dvh w-full items-center justify-center p-4">
      <div className="w-full max-w-md">
        {urlState?.startsWith("error_") ? (
          <OidcErrorNotice code={urlState} />
        ) : oidcErrorCodes.includes("discovery_failed") ? (
          <OidcDiscoveryFailedNotice />
        ) : oidcErrorCodes.length > 0 ? (
          <OidcConfigErrorNotice errors={oidcErrorCodes} />
        ) : showCookieWarning ? (
          <Card className="mb-4 w-full border border-red-500">
            <div className="flex items-center justify-between gap-4">
              <Card.Title className="text-red-500">Configuration Issue</Card.Title>
              <AlertCircle className="mb-2 h-6 w-6 text-red-500" />
            </div>
            {showCookieWarning ? (
              <Card.Text className="text-sm">
                Headplane is configured to use secure cookies, but this site is being served over an
                insecure connection and login will not work correctly.{" "}
                <Link
                  external
                  styled
                  to="https://headplane.net/configuration/common-issues#issue-logging-in-does-not-do-anything"
                >
                  Learn more.
                </Link>
              </Card.Text>
            ) : undefined}
          </Card>
        ) : undefined}
        <Card className="w-full">
          <Card.Title>Welcome to Headplane</Card.Title>
          {isOidcConnectorEnabled ? (
            <>
              <Card.Text>Sign in with your account.</Card.Text>
              <RouterLink to="/oidc/start" prefetch="none" reloadDocument>
                <Button
                  className="mt-6 w-full"
                  disabled={oidcErrorCodes.length > 0}
                  variant="heavy"
                >
                  Single Sign-On
                </Button>
              </RouterLink>
              <details className="mt-6" open={actionData?.success === false}>
                <summary className="cursor-pointer text-sm text-mist-600 dark:text-mist-300">
                  Sign in with an API key instead
                </summary>
                <ApiKeyForm actionData={actionData} />
              </details>
            </>
          ) : (
            <ApiKeyForm actionData={actionData} primary />
          )}
        </Card>
      </div>
    </div>
  );
}

function ApiKeyForm({
  actionData,
  primary,
}: {
  actionData: Route.ComponentProps["actionData"];
  primary?: boolean;
}) {
  return (
    <Form method="POST">
      <Card.Text className={primary ? undefined : "mt-3 text-sm"}>
        Enter an API key to authenticate with Headplane. You can generate one by running{" "}
        <Code className="break-all">headscale apikeys create</Code> in your terminal.
      </Card.Text>
      <Input
        className="mt-4 mb-2"
        required
        label="API Key"
        labelHidden
        name="api_key"
        placeholder="API Key"
        type="password"
      />
      {actionData?.success === false ? (
        <Card.Text className="mb-2 text-sm text-red-600 dark:text-red-300">
          {actionData.message}
        </Card.Text>
      ) : undefined}
      <Button className="w-full" type="submit" variant={primary ? "heavy" : "light"}>
        Sign In
      </Button>
    </Form>
  );
}
