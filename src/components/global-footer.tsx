"use client";

import ContributorsButton from "./contributors-modal";

// Persistent footer that renders below every tab. Houses the
// "Made by" attribution, the contributors modal trigger, and a one-line
// privacy reassurance. Lives at the bottom of <main> in dashboard-client,
// so the user can find it from any tab — not just Wrapped.
//
// Why it's its own component: the wrapped-view used to be the only place
// these lived. The user pointed out (rightly) that you can't find the
// attribution unless you're on the Wrapped tab. Lifting it here makes
// the credit + contributors list one click away from anywhere.
export default function GlobalFooter() {
  return (
    <footer className="mt-6 flex flex-wrap items-center justify-center gap-1 border-t border-line bg-slate-50 px-4 py-3 text-center text-[11px] text-slate-500">
      <span>Made by</span>
      <a
        href="https://github.com/Suketu-Patel/skill-analytics"
        target="_blank"
        rel="noreferrer"
        className="font-mono text-teal hover:underline"
      >
        github.com/Suketu-Patel/skill-analytics
      </a>
      <span>·</span>
      <ContributorsButton />
      <span>·</span>
      <span>your usage data stays on this machine</span>
    </footer>
  );
}
