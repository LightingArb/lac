import { useSyncExternalStore } from 'react';

/** Phone layout: drawer navigation. Keep in sync with `@media (max-width: 767px)` in the CSS. */
export const MOBILE_QUERY = '(max-width: 767px)';

/** Too narrow for the 330px signals column beside the markets, so signals open in a drawer. */
export const COMPACT_QUERY = '(max-width: 1199px)';

/**
 * Too narrow for the 340px terminal column as well: at 1600px, menu 232 + signals 330 + terminal 340
 * still leave about 700px for the list and detail side by side; below that the terminal opens in a drawer.
 */
export const TERMINAL_QUERY = '(max-width: 1599px)';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
