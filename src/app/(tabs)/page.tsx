import { HomeView } from "@/components/HomeView";

// Client-only page (localStorage data + current time); see (tabs)/layout.tsx.
export const instant = false;

export default function TodayPage() {
  return <HomeView />;
}
