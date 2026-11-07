import { useEffect, useRef, useState } from "react";
import { useHref, useRevalidator } from "react-router";

import type { FailoverSnapshot, FailoverSummary } from "~/server/failover";
import { PANEL_STATE_TIMEOUT_MS } from "~/utils/failover";

const POLL_WHILE_SWITCHING_MS = 2_000;
const POLL_WHILE_LEADING_MS = 15_000;
const SWITCH_GIVE_UP_MS = 120_000;
export const POLL_AFTER_ERROR_MS = 3_000;

export function useFailoverSnapshot(initial: FailoverSnapshot, isFast: boolean) {
  const stateUrl = useHref("/failover/state");
  const [snapshot, setSnapshot] = useState(initial);
  const [isReachable, setIsReachable] = useState(true);
  const isFastRef = useRef(isFast);
  isFastRef.current = isFast;

  useEffect(() => setSnapshot(initial), [initial]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let isStopped = false;
    const next = () => (isFastRef.current ? POLL_WHILE_SWITCHING_MS : POLL_WHILE_LEADING_MS);

    async function poll() {
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch(stateUrl, {
            signal: AbortSignal.timeout(PANEL_STATE_TIMEOUT_MS),
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          setSnapshot((await response.json()) as FailoverSnapshot);
          setIsReachable(true);
        } catch {
          setIsReachable(false);
        }
      }
      if (!isStopped) {
        timer = setTimeout(poll, next());
      }
    }

    timer = setTimeout(poll, next());
    return () => {
      isStopped = true;
      clearTimeout(timer);
    };
  }, [stateUrl]);

  return { snapshot, isReachable };
}

export function useSwitch(summary: FailoverSummary) {
  const revalidator = useRevalidator();
  const [switchingTo, setSwitchingTo] = useState<string>();
  const isDone =
    switchingTo !== undefined &&
    summary.phase === "leading" &&
    summary.leader === switchingTo &&
    summary.serving.includes(switchingTo);

  useEffect(() => {
    if (isDone) {
      setSwitchingTo(undefined);
      void revalidator.revalidate();
    }
  }, [isDone, revalidator]);

  useEffect(() => {
    if (!switchingTo) {
      return;
    }
    const timer = setTimeout(() => setSwitchingTo(undefined), SWITCH_GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [switchingTo]);

  return { switchingTo, start: setSwitchingTo };
}

export function useRetry(intervalMs: number | undefined) {
  const revalidator = useRevalidator();
  const revalidatorRef = useRef(revalidator);
  revalidatorRef.current = revalidator;

  useEffect(() => {
    if (intervalMs === undefined) {
      return;
    }
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        void revalidatorRef.current.revalidate();
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
