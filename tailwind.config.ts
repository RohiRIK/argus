import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        // Status palette — scannable, not just colored dots (see PRD §9).
        status: {
          success: "hsl(142 71% 45%)",
          warning: "hsl(38 92% 50%)",
          failed: "hsl(0 84% 60%)",
          disabled: "hsl(215 16% 47%)",
          suppressed: "hsl(217 91% 60%)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
