# Svelte spike: the Party panel brief

Both versions (Svelte 5 + Bits UI + `@tanstack/svelte-query`, and the React control with Radix +
`@tanstack/react-query`) are built from this brief and nothing else. They share
`shared/party.ts` (types, the two calls, story data) and `shared/party.css` (the look), which are
framework-free and not counted in either version's lines.

Never merged: this folder exists for the measurement on the svelte-spike branch.

## The panel

- A modal dialog titled "Party". Under the title a one-line description: "Loading..." while
  loading, otherwise "<group name>, level <n>, <count> members". A close button named "Close
  party". Escape and a click on the overlay close it; the focus goes back to what opened it.
- The data is one TanStack query, key `['spike-party']`, from `load()` (a prop). It runs only
  while the dialog is open, is stale at once and does not retry.
- States:
  - loading: a `role="status"` line "Loading the party...";
  - error: a `role="alert"` line "Couldn't load the party: <message>" and a Retry button;
  - no group: "No party yet. Create a Group actor in Foundry and set it as the primary party.";
  - loaded: the members.
- A "Refresh" button refetches; disabled while fetching.
- When there is more than one group, a select labelled "Party group" picks the group shown (first
  group by default).
- Members: a list labelled "Members". Each row: the name; a star for inspiration with the text
  "Inspiration" for screen readers; a line of facts "Level 5 · AC 16 · Passive Perception 14"
  (each part only when known); condition chips, with "Exhaustion <n>" first when above 0; hit
  points as "31/40" (plus " +5" for temp HP) and a bar whose fill is the ratio, class `low` at or
  under a third, `mid` at or under two thirds.
- Travel pace: "Now: <label>" and one button per pace option. The current pace's button is
  disabled. A click runs a TanStack mutation calling `planPace(groupId, pace)` (a prop); all pace
  buttons are disabled while it runs, and on success the party query is invalidated.

## Each version has

1. `Party` panel component (props: `open`, `onOpenChange`, `load`, `planPace`).
2. A minimal app shell: the query client, a "Party" button that opens the dialog, and the panel
   loaded lazily (a dynamic import), so the shell and the panel measure apart.
3. Stories in the dashboard Storybook: Loaded (open, two groups), Failed (open, error).
