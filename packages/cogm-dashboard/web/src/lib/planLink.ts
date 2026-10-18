// The plan link (I-059, D-067): the Obsidian plugin opens /?plan=<planId> after it made a plan (a
// handout reveal); the dashboard shows that plan's confirm window, so the GM approves it here.
// Port of the old page's plan link handling (public/app.js).

const PLAN_ID = /^plan-[a-z0-9-]{1,80}$/;

/** The plan id in a location's query string, or null when there is none or it is not a plan id. */
export function planIdFromSearch(search: string): string | null {
  try {
    const id = new URLSearchParams(search).get('plan');
    return id !== null && PLAN_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}
