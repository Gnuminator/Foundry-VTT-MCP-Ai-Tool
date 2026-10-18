### Fixes

- **An apply that was never sent fails at once:** when Foundry is not connected, a guarded change no
  longer waits up to 2 minutes (holding the write lock, so queued changes waited too) and then says
  it "may or may not have been applied". It now says the change was not sent and nothing was
  applied; the plan stays pending.
- **Undo from the Changes window or the dashboard goes through the same undo guard** as the Undo
  tool: session notes whose Recap was revealed or whose pages the GM edited are no longer deleted
  that way. Undoing a put from there also sends the notes back to staged.
- **Session notes get the same journal id on every put:** an earlier put whose answer was lost no
  longer produces a second journal; the next put meets the first one, stops the automatic retries
  and tells the GM to look in the "Session notes" folder.
- **Applying a plan twice says "already applied"** (with the change id) instead of "plan expired".
