### Tooling

- **Review runner pins the head and has a small-delta mode:** the runner now reads the PR head when
  it plans and checks it again just before the SDK starts (nothing booked if it moved) and before it
  writes the note (no note, so no round is counted, if it moved), so a push during a review can no
  longer leave a note for an old sha. `--delta <sha>` writes a short sha-bound note for a docs, test
  or changelog commit, or a merge of main that leaves the PR's own files alone, after a Merge note
  for `<sha>`, with a small budget and no `--allow-round3`; a change to the PR's own code is refused
  and stays a normal round. The lane skill says to wait for CI green on the head before the last
  review round and to use `--delta` for small commits after a Merge.
