import { GoalsView } from "@/components/goals/GoalsView";

// Client-only page (localStorage data + current time); see (tabs)/layout.tsx.
export const instant = false;

export default function GoalsPage() {
  return <GoalsView />;
}
