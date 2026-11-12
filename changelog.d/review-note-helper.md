### Process

- **One helper writes review notes:** `node scripts/review-note.mjs <PR> --verdict merge|fixes|no --model opus|sonnet --body <file>` reads the head sha, names the note the way the merge gate reads it, writes the `Head reviewed:` and verdict lines, checks them with the gate's parser and pushes the vault note. It refuses a Sonnet note on a risky PR, and every merge gate refusal about a review prints the helper command. The API review runner (`scripts/review-runner/`) is removed.
