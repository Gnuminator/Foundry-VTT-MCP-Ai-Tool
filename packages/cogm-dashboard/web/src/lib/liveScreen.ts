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

/** The words of the header switch on the default dashboard and of the way back. */
export const TRY_LIVE_TEXT = 'Try the new live screen';
export const BACK_TO_STANDARD_TEXT = 'Back to the During view';
