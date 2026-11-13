### Process

- **Every review-note refusal of the merge gate prints the helper command:** a malformed note, a short sha, no note for the head, a carry that did not hold, a Sonnet-only note on a risky PR and an unreadable or missing vault each end with `node scripts/review-note.mjs <PR> --verdict ... --body <file>`, the PR number filled in. Only the "every review must say Merge" veto stays without it (the reviewer's call). A test walks each refusal text.
