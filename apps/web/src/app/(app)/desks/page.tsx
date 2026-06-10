import { SpotsBrowser } from "@/components/SpotsBrowser";

interface PageProps {
  searchParams: { date?: string };
}

export default function DesksPage({ searchParams }: PageProps) {
  return (
    <SpotsBrowser
      type="DESK"
      title="Scrivanie"
      initialDate={searchParams.date}
    />
  );
}
