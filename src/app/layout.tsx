import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

/*
 * S1 Blueprint type: IBM Plex Mono carries labels, figures and titles; IBM Plex
 * Sans carries the little prose there is. Packaged at build time by next/font,
 * so the deployed site needs no font CDN.
 */
const body = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Line-Mate",
  description:
    "One more technician on the line: a WebMCP-native shop floor where the manager and a browser agent recover a failing schedule together — the manager keeps authority.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
