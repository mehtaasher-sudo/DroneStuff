import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AeroCommand — sUAS Airspace & Mission Planning",
  description: "FAA UASFM / LAANC pre-checks, live ADS-B conflict alerts, AI waypoint planning and gate-locked checklists for drone operators.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
