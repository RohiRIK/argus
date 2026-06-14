import * as React from "react";

/**
 * Original Argus icon set — hand-drawn inline SVG, no third-party icon library.
 * Stroke-based, 24px grid, 1.7 stroke, round caps/joins, `currentColor`.
 * Size with Tailwind (`h-4 w-4`); className overrides the default 24px.
 */
type IconProps = React.SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ── Navigation ─────────────────────────────────────────────────────────── */
export const IconDashboard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Svg>
);

export const IconCatalog = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10v16H5.5A1.5 1.5 0 0 1 4 18.5Z" />
    <path d="M10 4h4.5A1.5 1.5 0 0 1 16 5.5v13a1.5 1.5 0 0 1-1.5 1.5H10" />
    <path d="M16 6.5 19.4 7a1.5 1.5 0 0 1 1.2 1.7l-1.8 9.6" />
    <path d="M7 8h0M7 11h0" />
  </Svg>
);

export const IconLogs = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="2" />
    <path d="M7 9l2.5 2L7 13" />
    <path d="M12.5 13.5H17" />
  </Svg>
);

export const IconTemplate = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3.5" width="16" height="17" rx="2" />
    <path d="M8 8h8" />
    <path d="M8 12h8" />
    <path d="M8 16h5" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.4M12 19.1v2.4M21.5 12h-2.4M4.9 12H2.5M18.7 5.3l-1.7 1.7M7 17l-1.7 1.7M18.7 18.7 17 17M7 7 5.3 5.3" />
  </Svg>
);

/* ── Settings tabs ──────────────────────────────────────────────────────── */
export const IconKey = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="3.5" />
    <path d="M10.5 10.5 20 20" />
    <path d="M16.5 16.5 18.5 14.5M14.5 14.5 16.5 12.5" />
  </Svg>
);

export const IconPlug = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 3v5M15 3v5" />
    <path d="M7 8h10v3a5 5 0 0 1-10 0Z" />
    <path d="M12 16v5" />
  </Svg>
);

export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 5 6v5.5c0 4.2 2.9 7.6 7 8.5 4.1-.9 7-4.3 7-8.5V6Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);

/* ── Actions ────────────────────────────────────────────────────────────── */
export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4.5 18 12 7 19.5Z" />
  </Svg>
);

export const IconPower = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v9" />
    <path d="M6.5 7a8 8 0 1 0 11 0" />
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.5h16" />
    <path d="M9 6.5V4.5h6v2" />
    <path d="M6.5 6.5 7.5 20h9l1-13.5" />
    <path d="M10 10v6M14 10v6" />
  </Svg>
);

export const IconSave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4h11l3 3v13H5Z" />
    <path d="M8 4v5h7V4" />
    <rect x="8" y="13" width="8" height="6" rx="0.5" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconSend = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 4 11 14" />
    <path d="M21 4 14.5 21l-3.5-7-7-3.5Z" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 8a8 8 0 1 0 1 6" />
    <path d="M20 3.5V8h-4.5" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const IconCloud = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 18h9.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6-1.2A4 4 0 0 0 7 18Z" />
  </Svg>
);

/* ── Theme ──────────────────────────────────────────────────────────────── */
export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.4 5.6 17 7M7 17l-1.4 1.4M18.4 18.4 17 17M7 7 5.6 5.6" />
  </Svg>
);

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" />
  </Svg>
);

/* ── Alerts / status ────────────────────────────────────────────────────── */
export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5 21 19H3Z" />
    <path d="M12 10v4M12 16.5h0" />
  </Svg>
);

export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);

export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l16 16" />
    <path d="M9.6 5.9A9.4 9.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.3 3" />
    <path d="M6.4 7.4A15.7 15.7 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 3.3-.6" />
    <path d="M9.9 9.9a2.8 2.8 0 0 0 3.9 4" />
  </Svg>
);

/**
 * Original empty-state illustration — a radar sweep watching for events, with
 * Argus's eye at the center. Inline SVG, theme-aware via currentColor + accent.
 */
export function ArgusEmptyArt({ className }: { className?: string }) {
  const id = React.useId();
  return (
    <svg className={className} width={120} height={120} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-sweep`} cx="60" cy="60" r="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="hsl(38 90% 62%)" stopOpacity="0.35" />
          <stop offset="1" stopColor="hsl(38 90% 62%)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* concentric range rings */}
      <circle cx="60" cy="60" r="48" stroke="currentColor" strokeOpacity="0.15" />
      <circle cx="60" cy="60" r="34" stroke="currentColor" strokeOpacity="0.15" />
      <circle cx="60" cy="60" r="20" stroke="currentColor" strokeOpacity="0.15" />
      {/* sweep wedge */}
      <path d="M60 60 L60 12 A48 48 0 0 1 104 44 Z" fill={`url(#${id}-sweep)`} />
      <path d="M60 60 L104 44" stroke="hsl(38 90% 62%)" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" />
      {/* crosshair */}
      <path d="M60 4v12M60 104v12M4 60h12M104 60h12" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" strokeLinecap="round" />
      {/* center eye */}
      <path d="M48 60s5-7 12-7 12 7 12 7-5 7-12 7-12-7-12-7Z" stroke="hsl(34 78% 50%)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="60" cy="60" r="3.4" fill="hsl(38 90% 62%)" />
      {/* a couple of detected blips */}
      <circle cx="86" cy="40" r="2.4" fill="hsl(44 70% 96%)" />
      <circle cx="38" cy="80" r="2" fill="hsl(38 90% 62%)" />
    </svg>
  );
}

/**
 * Argus logo — the all-seeing guardian (Argus Panoptes): an eye set within a
 * shield, drawn as a single original mark. Uses an internal gradient by default
 * (set `mono` to render in currentColor for tight spaces).
 */
export function ArgusMark({ className, mono = false }: { className?: string; mono?: boolean }) {
  const id = React.useId();
  return (
    <svg className={className} width={28} height={28} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      {!mono && (
        <defs>
          <linearGradient id={`${id}-g`} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
            <stop stopColor="hsl(38 90% 62%)" />
            <stop offset="1" stopColor="hsl(34 78% 50%)" />
          </linearGradient>
        </defs>
      )}
      {/* Shield */}
      <path
        d="M16 2.5 5 6.2v8.3c0 6.3 4.4 11.4 11 13 6.6-1.6 11-6.7 11-13V6.2Z"
        fill={mono ? "none" : `url(#${id}-g)`}
        stroke={mono ? "currentColor" : "none"}
        strokeWidth={mono ? 1.6 : 0}
      />
      {/* Eye (almond) */}
      <path
        d="M9 13.5S11.6 9.5 16 9.5 23 13.5 23 13.5 20.4 17.5 16 17.5 9 13.5 9 13.5Z"
        fill="none"
        stroke={mono ? "currentColor" : "hsl(44 78% 98%)"}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Pupil */}
      <circle cx="16" cy="13.5" r="2.1" fill={mono ? "currentColor" : "hsl(44 78% 98%)"} />
      {/* Vigilance rays below the eye */}
      <path
        d="M12.5 21h7M14 23.5h4"
        stroke={mono ? "currentColor" : "hsl(44 78% 98%)"}
        strokeOpacity={mono ? 0.6 : 0.85}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}
