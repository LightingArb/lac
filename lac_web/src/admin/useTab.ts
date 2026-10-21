import { useSearchParams } from 'react-router';

/** The open tab lives in the URL (?tab=…), so links from other pages can open a tab directly. */
export function useTab<T extends string>(tabs: readonly T[]): [T, (tab: T) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get('tab') as T | null;
  const tab = value && tabs.includes(value) ? value : tabs[0];
  return [tab, (next: T) => setParams(next === tabs[0] ? {} : { tab: next }, { replace: true })];
}
