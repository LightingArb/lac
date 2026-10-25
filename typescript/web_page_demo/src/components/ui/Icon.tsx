/** Stroke icons drawn on a 24×24 grid, as used across the design. */
const PATHS = {
  dashboard: 'M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z',
  wallet: 'M4 7a2 2 0 0 1 2-2h12v4M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2zM16 14.5h.01',
  users: 'M9 11a4 4 0 1 0 0-8a4 4 0 1 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14.5a7 7 0 0 1 4 6.5',
  tree: 'M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6zM9 12l2 2 4-4',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  logo: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  panelLeft: 'M4 4h16v16H4zM9 4v16',
  panelRight: 'M4 4h16v16H4zM15 4v16',
  usdt: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM8 8h8M12 8v9M8.5 11.2c1 .5 2.2.8 3.5.8s2.5-.3 3.5-.8',
  user: 'M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8zM4 21a8 8 0 0 1 16 0',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  filter: 'M4 6h16M7 12h10M10 18h4',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM21 21l-5.2-5.2',
  check: 'M5 12l5 5 9-10',
  share:
    'M18 8.5a3 3 0 1 0 0-6a3 3 0 1 0 0 6zM6 15a3 3 0 1 0 0-6a3 3 0 1 0 0 6zM18 21.5a3 3 0 1 0 0-6a3 3 0 1 0 0 6zM8.6 13.5l6.8 4M15.4 7l-6.8 4',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2',
  volume: 'M6 20v-7M12 20V5M18 20v-4',
  close: 'M6 6l12 12M18 6 6 18',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  prediction: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  signal: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  stocks: 'M8 3v18M5 7h6v9H5zM16 3v18M13 6h6v6h-6z',
  products: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  gift: 'M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z',
  gear: 'M12 15a3 3 0 1 0 0-6a3 3 0 1 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  trending: 'M12 3c.6 3.5 5 5.4 5 10.2A5 5 0 0 1 7 13c0-2.6 1.5-4 2.4-5.6.8 1.4 1.6 2.3 2.6 2.8C12 8 12 5.5 12 3z',
  politics: 'M3 21h18M5 21V10M9.7 21V10M14.3 21V10M19 21V10M2.5 10 12 4l9.5 6z',
  sports:
    'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5',
  finance:
    'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM15 9.5c-.6-.9-1.7-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.8 3 2 3 .9 3 2-1.3 2-3 2c-1.3 0-2.4-.6-3-1.5M12 6v2M12 16v2',
  crypto: 'M12 2.5 20.2 7.2v9.6L12 21.5l-8.2-4.7V7.2zM10 8v8M10 8h3a2 2 0 0 1 0 4h-3M10 12h3.5a2 2 0 0 1 0 4H10',
  esports:
    'M7 8h10a4.5 4.5 0 0 1 4.5 4.5v1.2a3 3 0 0 1-5.4 1.8L14.8 14H9.2l-1.3 1.5a3 3 0 0 1-5.4-1.8v-1.2A4.5 4.5 0 0 1 7 8zM8 10.5v3M6.5 12h3M15.5 11.5h.01M17.5 13h.01',
  globe:
    'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9M12 3C9.5 5.6 8.3 8.6 8.3 12s1.2 6.4 3.7 9',
  weather: 'M7 19h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.2A3.4 3.4 0 0 0 7 19zM16 3v1.5M20.6 5.4l-1 1M22 10h-1.5',
  forex: 'M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4',
  future: 'M3 19h18l-3.2-7H6.2zM8 12l1.3-5h5.4L16 12',
  lock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  box: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 22, strokeWidth = 1.8, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
