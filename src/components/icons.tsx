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

/* ── Vendor brand logos (fixed brand colors; size via className) ─────────── */

export const IconMicrosoft365 = (p: IconProps) => (
  <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <path fill="#F25022" d="M2 2h9.4v9.4H2z" />
    <path fill="#7FBA00" d="M12.6 2H22v9.4h-9.4z" />
    <path fill="#00A4EF" d="M2 12.6h9.4V22H2z" />
    <path fill="#FFB900" d="M12.6 12.6H22V22h-9.4z" />
  </svg>
);

export const IconGoogleCloud = (p: IconProps) => (
  <svg width={24} height={24} viewBox="0 0 48 48" aria-hidden="true" {...p}>
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

export const IconAws = (p: IconProps) => (
  <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <path
      fill="#FF9900"
      d="M6.8 10.4c0 .3 0 .5.1.7.1.2.2.4.3.6 0 .1.1.1.1.2 0 .1 0 .1-.1.2l-.5.3h-.2c-.1 0-.1-.1-.2-.1-.1-.1-.2-.2-.2-.4-.1-.1-.1-.3-.2-.5-.5.6-1.2.9-2 .9-.6 0-1-.2-1.4-.5-.3-.3-.5-.8-.5-1.3 0-.6.2-1.1.6-1.4.4-.4 1-.5 1.7-.5.2 0 .5 0 .7.1.3 0 .5.1.8.1v-.5c0-.5-.1-.9-.3-1.1-.2-.2-.6-.3-1.1-.3-.2 0-.5 0-.7.1-.3.1-.5.1-.7.2h-.2c-.1 0-.1 0-.1-.2v-.4c0-.1 0-.2.1-.2 0-.1.1-.1.2-.1.2-.1.5-.2.8-.3.3-.1.7-.1 1-.1.8 0 1.4.2 1.7.5.4.4.5.9.5 1.6v2.1zm-2.8 1c.2 0 .4 0 .7-.1.2-.1.4-.2.6-.4.1-.1.2-.2.2-.4 0-.2.1-.3.1-.5v-.3c-.2-.1-.4-.1-.6-.1-.2 0-.4-.1-.6-.1-.4 0-.7.1-.9.3-.2.2-.3.4-.3.7s.1.5.2.6c.1.2.3.3.6.3zm5.6.7c-.1 0-.2 0-.2-.1-.1 0-.1-.1-.2-.2L7.3 5.6c0-.1-.1-.2-.1-.3 0-.1 0-.1.1-.1h.8c.1 0 .2 0 .2.1 0 0 .1.1.1.2l1.2 4.7 1.1-4.7c0-.1 0-.2.1-.2 0-.1.1-.1.2-.1h.6c.1 0 .2 0 .2.1.1 0 .1.1.1.2l1.1 4.8 1.2-4.8c0-.1.1-.2.1-.2.1-.1.1-.1.2-.1h.7c.1 0 .1 0 .1.1v.1c0 .1 0 .1-.1.2l-1.7 5.4c0 .1-.1.2-.1.2-.1.1-.1.1-.2.1h-.6c-.1 0-.2 0-.2-.1-.1 0-.1-.1-.1-.2l-1.1-4.6-1.1 4.6c0 .1 0 .2-.1.2-.1.1-.1.1-.2.1h-.6zm9 .2c-.3 0-.7 0-1-.1-.3-.1-.5-.2-.7-.3-.1-.1-.2-.1-.2-.2v-.5c0-.1.1-.2.2-.2h.1c0 0 .1 0 .2.1.2.1.5.2.7.2.3.1.5.1.8.1.4 0 .7-.1.9-.2.2-.1.3-.3.3-.6 0-.2-.1-.3-.2-.4-.1-.1-.3-.2-.7-.3l-.9-.3c-.5-.1-.8-.4-1-.6-.2-.3-.3-.6-.3-.9 0-.3.1-.5.2-.7.1-.2.3-.4.5-.5.2-.1.4-.2.7-.3.3-.1.5-.1.8-.1h.4c.1 0 .3.1.4.1.1 0 .2.1.4.1.1 0 .2.1.2.1.1 0 .1.1.2.1 0 .1.1.1.1.2v.4c0 .2-.1.2-.2.2-.1 0-.2 0-.3-.1-.4-.2-.8-.3-1.3-.3-.4 0-.6.1-.8.2-.2.1-.3.3-.3.5 0 .2.1.3.2.4.1.1.4.2.7.3l.9.3c.4.1.7.3.9.6.2.2.3.5.3.9 0 .3-.1.5-.2.8-.1.2-.3.4-.5.6-.2.1-.5.3-.8.3-.3.2-.6.2-1 .2z"
    />
    <path
      fill="#FF9900"
      d="M20.5 16.3c-2.4 1.8-5.8 2.7-8.8 2.7-4.2 0-8-1.5-10.8-4.1-.2-.2 0-.5.2-.3 3.1 1.8 6.9 2.9 10.8 2.9 2.6 0 5.5-.5 8.2-1.7.4-.2.7.3.4.5zm.9-1.1c-.3-.4-2-.2-2.8-.1-.2 0-.3-.2-.1-.3 1.4-1 3.6-.7 3.9-.4.3.4-.1 2.6-1.4 3.6-.2.2-.4.1-.3-.1.3-.7.9-2.3.7-2.7z"
    />
  </svg>
);

export const IconWebhook = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="5.5" r="2.5" />
    <circle cx="5.5" cy="16" r="2.5" />
    <circle cx="18.5" cy="16" r="2.5" />
    <path d="M10.4 7.5 6.7 13.6" />
    <path d="M13.6 7.5l3.7 6.1" />
    <path d="M8 16h8" />
  </Svg>
);
