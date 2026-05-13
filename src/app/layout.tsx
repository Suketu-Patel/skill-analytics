import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Tab — your Claude + Codex coding ledger",
  description:
    "Local-only dashboard for tracking cost, tokens, and sessions across Claude Code and Codex.",
};

// Inline init: reads the persisted theme + system preference and applies
// the `dark` class to <html> before React hydrates. Without this the page
// renders light first and snaps to dark on first paint (FOUC). "system"
// follows prefers-color-scheme; "light"/"dark" pin explicitly.
const THEME_INIT = `
(function() {
  try {
    var t = localStorage.getItem("dashboard.theme") || "system";
    var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = t === "dark" || (t === "system" && prefersDark);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) { /* localStorage blocked — stay light */ }
})();
`;

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
