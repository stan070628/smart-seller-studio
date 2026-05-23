import AppShell from '@/components/AppShell';

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <AppShell mainOverflow="hidden" mainDisplay="flex">{children}</AppShell>;
}
