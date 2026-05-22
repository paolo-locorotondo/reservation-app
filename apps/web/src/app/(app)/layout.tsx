import { AppShell } from "@/components/AppShell";
import type { ReactNode } from "react";

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
