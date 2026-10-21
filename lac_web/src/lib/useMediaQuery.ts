import { useSyncExternalStore } from 'react';

/** Phone layout: drawer navigation. Keep in sync with `@media (max-width: 767px)` in the CSS. */
export const MOBILE_QUERY = '(max-width: 767px)';

/** Too narrow for the 330px signals column beside the markets, so signals open in a drawer. */
export const COMPACT_QUERY = '(max-width: 1199px)';

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
