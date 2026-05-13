/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1f2528",
        surface: "#f6f7f9",
        panel: "#ffffff",
        line: "#d8dde3",
        teal: "#0f8f8a",
        coral: "#d55c47",
        amber: "#b78318",
        violet: "#6157a8",
        // Source brand colors.
        // Claude → Anthropic's warm coral. Codex → OpenAI's monochrome black.
        claude: "#D97757",
        "claude-tint": "#FAEEE6",
        codex: "#0D0D0D",
        "codex-tint": "#F4F4F4"
      }
    }
  },
  plugins: []
};
