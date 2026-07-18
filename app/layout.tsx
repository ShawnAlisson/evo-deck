import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import "./globals.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "EvoDeck",
    template: "%s · EvoDeck",
  },
  description:
    "An AI-native collaborative canvas that turns conversation into an evolving, interactive workspace.",
  keywords: [
    "AI workspace",
    "generative UI",
    "collaboration",
    "visual canvas",
    "EvoDeck",
  ],
  openGraph: {
    title: "EvoDeck",
    description:
      "Turn conversation into an evolving, interactive workspace.",
    siteName: "EvoDeck",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "EvoDeck",
    description:
      "Turn conversation into an evolving, interactive workspace.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} h-full`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
