// Live screen A (item live-screen-a): the opt-in "Live" view of the dashboard. During stays the
// default; the Live view is the same page with ?live=1, reached from the header switch or typed.

/**
 * The Live view's address and the default dashboard's, relative to the page they are on: the new
 * dashboard is at /next/ until it becomes / (D-126), and both links work on either.
 */
export const LIVE_SCREEN_HREF = './?live=1';
export const STANDARD_HREF = './';

/** Whether the address asks for the Live view (/?live=1). */
export function isLiveScreen(search: string): boolean {
  return new URLSearchParams(search).get('live') === '1';
}

export type OptInScreenName = 'gm' | 'strip' | 'live';

/**
 * Which opt-in screen the address asks for: the GM page (/gm), the strip alone (?strip=1), the Live
 * view (?live=1), else null (the default dashboard). The entry only decides; each screen is a chunk.
 */
export function optInScreen(pathname: string, search: string): OptInScreenName | null {
  if (pathname === '/gm') return 'gm';
  const params = new URLSearchParams(search);
  if (params.get('strip') === '1') return 'strip';
  return params.get('live') === '1' ? 'live' : null;
}

/** The words of the header switch on the default dashboard and of the way back. */
export const TRY_LIVE_TEXT = 'Try the new live screen';
export const BACK_TO_STANDARD_TEXT = 'Back to the During view';
