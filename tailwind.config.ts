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
        bg: {
          DEFAULT: hsl("--bg"),
          subtle: hsl("--bg-subtle"),
        },
        surface: {
          DEFAULT: hsl("--surface"),
          "2": hsl("--surface-2"),
          elevated: hsl("--surface-elevated"),
        },
        fg: {
          DEFAULT: hsl("--fg"),
          muted: hsl("--fg-muted"),
        },
        border: {
          DEFAULT: hsl("--border"),
          subtle: hsl("--border-subtle"),
        },
        primary: {
          DEFAULT: hsl("--primary"),
          fg: hsl("--primary-fg"),
        },
        accent: hsl("--accent"),
        ring: hsl("--ring"),
        success: hsl("--success"),
        warning: hsl("--warning"),
        danger: hsl("--danger"),
        info: hsl("--info"),
        sidebar: {
          bg: hsl("--sidebar-bg"),
          surface: hsl("--sidebar-surface"),
          border: hsl("--sidebar-border"),
          fg: hsl("--sidebar-fg"),
          "fg-muted": hsl("--sidebar-fg-muted"),
        },
      },
      borderRadius: {
        xl: "var(--radius-xl)",
        lg: "var(--radius-lg)",
        md: "var(--radius)",
        sm: "var(--radius-sm)",
        xs: "var(--radius-xs)",
      },
      // Operator: subtle single-step elevation. Borders carry structure; no glow.
      boxShadow: {
        none: "none",
        sm: "0 1px 2px 0 rgb(0 0 0 / 0.06)",
        DEFAULT: "0 2px 8px -2px rgb(0 0 0 / 0.10)",
        md: "0 2px 8px -2px rgb(0 0 0 / 0.10)",
        elevated: "0 8px 24px -6px rgb(0 0 0 / 0.18)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "none" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(-8px)" },
          to: { opacity: "1", transform: "none" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "slide-in-right": "slide-in-right 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-in": "scale-in 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
