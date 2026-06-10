import { SpotsBrowser } from "@/components/SpotsBrowser";

interface PageProps {
  // `?date=YYYY-MM-DD` opzionale: usato per arrivare qui dal calendario di
  // /my-reservations e dal click sui giorni del calendario interno.
  searchParams: { date?: string };
}

export default function ParkingPage({ searchParams }: PageProps) {
  return (
    <SpotsBrowser
      type="PARKING"
      title="Posti auto"
      initialDate={searchParams.date}
    />
  );
}
