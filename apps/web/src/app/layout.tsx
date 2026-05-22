import type { Metadata } from "next";
import "../styles/globals.scss";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Reservation App",
  description: "Prenotazione posti auto e scrivanie",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
