import { MealsView } from "@/components/meals/MealsView";

// Client-only page (localStorage data + current time); see (tabs)/layout.tsx.
export const instant = false;

export default function MealsPage() {
  return <MealsView />;
}
