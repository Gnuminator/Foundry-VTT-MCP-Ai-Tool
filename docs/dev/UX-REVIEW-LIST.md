# UX review list

A short list to check a dashboard or player-page change against before the PR and during review.
It came out of the ui-ux-pro-max trial (I-149, 2026-10-27): the tool itself was dropped, but its UX
rules were sound and are worth keeping as a checklist. Our design rules come first: The Veil
(D-085), the tokens in `packages/cogm-dashboard/web/src/`, and the public docs voice. This list
never overrides them.

## Forms and controls

- Every field has a visible label. A placeholder is an example, never the only name.
- Helper and hint text uses the dim text token and still clears contrast (axe checks it).
- Technical names (parameter ids, tool names) are set in mono so they read as identifiers.
- Required and invalid states say what is wrong next to the field, not only with colour.
- Space for a status or error message is reserved, so the layout does not jump when it appears.
- The main action stays reachable on a long form (sticky footer), and it shows when it is busy.
- Click and touch targets are at least 2.25rem tall on desktop and comfortable on the phone.
- Destructive actions say what they do and are undoable or confirmed (plan, confirm, undo).

## Layout and reading

- One obvious primary action per screen; secondary actions look secondary.
- Related things sit together; spacing groups them more than borders do.
- Text lines stay readable: no long unbroken lines, no tiny type for anything the GM must act on.
- Live play comes first: what the GM or a player needs right now sits above the fold.
- No spoilers on normal screens; GM-only content is not rendered for the player view.

## Colour, contrast and motion

- Use tokens, not literal colours. Check both themes (neutral and Veil).
- Text and meaningful icons meet WCAG AA contrast; state is never colour alone.
- Motion is short, never needed to understand the screen, and respects reduced motion.

## Keyboard, focus and screen readers

- Everything works by keyboard; tab order follows the visual order.
- The focus ring is visible on every interactive element.
- Icon-only buttons have an accessible name; dialogs trap focus and return it on close.
- Live updates (rolls, combat turns) use polite live regions, not focus changes.

## States and feedback

- Every list and panel has a loading, empty and error state that says what to do next.
- Slow work shows progress or a busy state within a moment; results confirm what happened.
- Errors are in plain words (no stack traces or ids as the only message) and keep the user's input.

## Phone and small screens

- Check 390 px wide: no horizontal scroll, nothing cut off, targets still tappable.
- Sticky bars do not cover the field being typed into.

## Pre-delivery checklist

1. Both themes and the phone width looked at by eye, not only by the screenshot diff.
2. `npm run green` passes; no new entry in the axe "known" lists (remove ones you fixed).
3. Visual baselines regenerated (`npm run visual:baselines`) and the changed PNGs actually viewed.
4. Keyboard pass: tab through the screen once, open and close any dialog or picker.
5. Empty, loading and error states seen at least once, not assumed.
6. Copy read aloud: plain words, no em dashes, no campaign or book text.
