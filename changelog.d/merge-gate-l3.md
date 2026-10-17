### Dev tooling

- **`lane:merge` refuses a review note whose Head line is out of order (#314 L3):** each `## Verdict` needs a `Head reviewed:` line between it and the previous verdict (or the top of the note), and none may follow the last verdict. Before, a verdict written above its own Head line tied to the previous round's sha, so a "Do not merge" could be cleared by a separate Merge note for the new head. The gate now names the note as malformed and says what to fix.
