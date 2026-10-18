import { ProjectsView } from "@/components/projects/ProjectsView";

// Client-only page (localStorage data + current time); see (tabs)/layout.tsx.
export const instant = false;

export default function ProjectsPage() {
  return <ProjectsView />;
}
