import type { Config } from "tailwindcss";

const hsl = (v: string) => `hsl(var(${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        bg: { DEFAULT: hsl("--bg"), subtle: hsl("--bg-subtle") },
        surface: { DEFAULT: hsl("--surface"), 2: hsl("--surface-2") },
        fg: { DEFAULT: hsl("--fg"), muted: hsl("--fg-muted") },
        border: hsl("--border"),
        primary: { DEFAULT: hsl("--primary"), fg: hsl("--primary-fg") },
        accent: hsl("--accent"),
        ring: hsl("--ring"),
        success: hsl("--success"),
        warning: hsl("--warning"),
        danger: hsl("--danger"),
        info: hsl("--info"),
        // Status palette (PRD §9) — semantic aliases.
        status: {
          success: hsl("--success"),
          warning: hsl("--warning"),
          failed: hsl("--danger"),
          disabled: hsl("--fg-muted"),
          suppressed: hsl("--info"),
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 8px)",
      },
      boxShadow: {
        card: "0 1px 2px 0 hsl(222 47% 11% / 0.04), 0 1px 3px 0 hsl(222 47% 11% / 0.06)",
        elevated: "0 10px 30px -10px hsl(222 47% 11% / 0.18)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
