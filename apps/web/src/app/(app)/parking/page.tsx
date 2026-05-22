import { SpotsBrowser } from "@/components/SpotsBrowser";

export default function ParkingPage() {
  return (
    <SpotsBrowser
      type="PARKING"
      title="Posti auto"
      subtitle="Filtra per sede, piano e data per vedere i posti disponibili."
    />
  );
}
