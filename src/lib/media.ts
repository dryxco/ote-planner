"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 1024px)";

/** Wide screens (computers) get the three-pane layout; phones keep the mobile app. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/** Mouse/trackpad devices (desktop browsers get custom pickers; touch keeps the native wheels). */
export function useFinePointer(): boolean {
  const q = "(hover: hover) and (pointer: fine)";
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(q).matches,
    () => false,
  );
}
