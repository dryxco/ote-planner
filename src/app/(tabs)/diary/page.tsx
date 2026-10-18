import { DiaryView } from "@/components/diary/DiaryView";

// Client-only page (localStorage data + current time); see (tabs)/layout.tsx.
export const instant = false;

export default function DiaryPage() {
  return <DiaryView />;
}
