import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Tab — your Claude + Codex coding ledger",
  description:
    "Local-only dashboard for tracking cost, tokens, and sessions across Claude Code and Codex.",
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
