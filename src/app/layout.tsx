import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skill Analytics",
  description: "Local Codex skill usage and health dashboard"
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
