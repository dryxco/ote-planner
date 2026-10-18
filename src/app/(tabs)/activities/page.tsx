import { ActivitiesView } from "@/components/activities/ActivitiesView";

// Client-only page (localStorage data + current time); see (tabs)/layout.tsx.
export const instant = false;

export default function ActivitiesPage() {
  return <ActivitiesView />;
}
