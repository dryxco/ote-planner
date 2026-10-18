"use client";

import { useIsDesktop } from "@/lib/media";
import { DesktopHome } from "./desktop/DesktopHome";
import { TodayView } from "./today/TodayView";

/** Phones keep the Today tab; wide screens get the three-pane home. */
export function HomeView() {
  return useIsDesktop() ? <DesktopHome /> : <TodayView />;
}
