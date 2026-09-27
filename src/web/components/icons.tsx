// The boards' inline SVG icons as components: <Icon.Play size={14} />. Stroke icons use currentColor.

import type { SVGProps } from "react";

type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, "width" | "height">;

function stroke(paths: React.ReactNode, defaults: { width?: number; cap?: boolean; join?: boolean } = {}) {
  return function StrokeIcon({ size = 18, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={defaults.width ?? 1.8}
        strokeLinecap={defaults.cap === false ? undefined : "round"}
        strokeLinejoin={defaults.join ? "round" : undefined}
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

function fill(paths: React.ReactNode) {
  return function FillIcon({ size = 18, ...rest }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
        {paths}
      </svg>
    );
  };
}

export const Icon = {
  Gear: stroke(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </>,
  ),
  Close: stroke(<path d="M6 6l12 12M18 6L6 18" />, { width: 2 }),
  Check: stroke(<path d="M5 12l5 5 9-10" />, { width: 2, join: true }),
  Plus: stroke(<path d="M12 5v14M5 12h14" />, { width: 2 }),
  Search: stroke(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>,
    { width: 2 },
  ),
  Folder: stroke(<path d="M3 6h6l2 2h10v11H3z" />, { cap: false, join: true }),
  AudioFile: stroke(
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <circle cx="10.5" cy="16.5" r="2" />
      <path d="M12.5 16.5V10l3 1" />
    </>,
    { join: true },
  ),
  LyricsFile: stroke(
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 12h7M9 16h7" />
    </>,
    { join: true },
  ),
  Headphones: stroke(
    <>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="4" height="6" rx="1" />
      <rect x="17" y="14" width="4" height="6" rx="1" />
    </>,
    { cap: false, join: true },
  ),
  Mic: stroke(
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>,
  ),
  Loop: stroke(
    <>
      <path d="M17 2l3 3-3 3" />
      <path d="M4 11V9a4 4 0 0 1 4-4h12" />
      <path d="M7 22l-3-3 3-3" />
      <path d="M20 13v2a4 4 0 0 1-4 4H4" />
    </>,
    { join: true },
  ),
  Link: stroke(
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>,
  ),
  Scissors: stroke(
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.5 15.5M14.5 14.5L20 20M8.5 8.5L12 12" />
    </>,
  ),
  Trash: stroke(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />, { join: true }),
  Warning: stroke(
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.5" />
    </>,
    { width: 2.2, join: true },
  ),
  Info: stroke(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </>,
  ),
  Clock: stroke(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
    { width: 2 },
  ),
  Play: fill(<path d="M7 5l12 7-12 7z" />),
  Pause: fill(
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </>,
  ),
  Prev: fill(<path d="M6 5h2v14H6zM19 5v14L9 12z" />),
  Next: fill(<path d="M16 5h2v14h-2zM5 5v14l10-7z" />),
  Spinner: ({ size = 16, ...rest }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="spinner" {...rest}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
};

/** The lrcgen logo mark. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <rect width="26" height="26" rx="7" fill="var(--accent)" />
      <path d="M7 15v-4M11 19V8M15 17v-7M19 14v-2" stroke="var(--on-accent)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** A circular progress ring (0–1), like the Recognize board's stage indicator. Null progress spins. */
export function ProgressRing({ progress, size = 36, stroke: width = 3 }: { progress: number | null; size?: number; stroke?: number }) {
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  const p = progress === null ? 0.25 : Math.min(1, Math.max(0, progress));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className={progress === null ? "spinner" : undefined}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-3)" strokeWidth={width} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={width}
        strokeDasharray={`${c * p} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
