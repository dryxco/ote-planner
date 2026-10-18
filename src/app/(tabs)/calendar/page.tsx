import { CalendarView } from "@/components/calendar/CalendarView";

// Client-only page (localStorage data + current time); see (tabs)/layout.tsx.
export const instant = false;

export default function CalendarPage() {
  return <CalendarView />;
}
