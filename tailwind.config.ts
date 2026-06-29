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
        status: {
          success: hsl("--success"),
          warning: hsl("--warning"),
          failed: hsl("--danger"),
          disabled: hsl("--fg-muted"),
          suppressed: hsl("--info"),
        },
      },
      borderRadius: {
        xl: "var(--radius-xl)",
        lg: "var(--radius-lg)",
        md: "var(--radius)",
        sm: "var(--radius-sm)",
        xs: "var(--radius-xs)",
      },
      // Operator: subtle real elevation. Borders carry most structure (esp. dark);
      // shadows are quiet and single-step — no stacks, no glow.
      boxShadow: {
        none: "none",
        sm: "0 1px 2px 0 rgb(0 0 0 / 0.06)",
        DEFAULT: "0 2px 8px -2px rgb(0 0 0 / 0.10)",
        md: "0 2px 8px -2px rgb(0 0 0 / 0.10)",
        lg: "0 6px 16px -4px rgb(0 0 0 / 0.14)",
        xl: "0 8px 24px -6px rgb(0 0 0 / 0.18)",
        card: "0 1px 2px 0 rgb(0 0 0 / 0.06)",
        elevated: "0 8px 24px -6px rgb(0 0 0 / 0.18)",
        "elevated-lg": "0 16px 40px -8px rgb(0 0 0 / 0.24)",
        sidebar: "none",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "none" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
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
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "bg-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out",
        "fade-in-up": "fade-in-up 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-right": "slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-in": "scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
