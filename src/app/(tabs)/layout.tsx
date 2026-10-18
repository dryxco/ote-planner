import { AppShell } from "@/components/AppShell";

// All tab pages are client-only: data lives in localStorage and the UI depends on the
// current time, so nothing below this layout can be prerendered into a static shell.
export const instant = false;

export default function TabsLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
