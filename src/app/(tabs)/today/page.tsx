import { TodayView } from "@/components/today/TodayView";

// Client-only page (localStorage data + current time); see (tabs)/layout.tsx.
export const instant = false;

/** Today on its own (on computers "/" is the three-pane Home). */
export default function TodayPage() {
  return <TodayView />;
}
