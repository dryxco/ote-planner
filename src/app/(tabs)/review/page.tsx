import { ReviewView } from "@/components/review/ReviewView";

// Client-only page (localStorage data + current time); see (tabs)/layout.tsx.
export const instant = false;

export default function ReviewPage() {
  return <ReviewView />;
}
