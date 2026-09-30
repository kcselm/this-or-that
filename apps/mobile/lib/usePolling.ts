import { useEffect, useRef } from "react";
import { AppState } from "react-native";

/**
 * Runs `poll` immediately and then on an interval, pausing while the app is
 * backgrounded (or the browser tab is hidden, on web) and polling again the
 * moment it becomes active. `poll` receives a `stop` callback that
 * permanently ends the loop — call it after navigating away or when the
 * room is gone, so a foreground event can't restart polling.
 */
export function usePolling(poll: (stop: () => void) => void | Promise<void>, intervalMs: number) {
  // Latest-ref pattern: ticks always call the newest closure, so the
  // effect never needs to re-run (and reset the interval) on state changes.
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let stopped = false;

    const stop = () => {
      stopped = true;
      clearInterval(interval);
    };
    const tick = () => pollRef.current(stop);
    const start = () => {
      if (stopped) return;
      clearInterval(interval);
      tick();
      interval = setInterval(tick, intervalMs);
    };

    start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else clearInterval(interval);
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [intervalMs]);
}
