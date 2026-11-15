### Process

- **Cloudflare changes need the user's OK in the app:** a hook makes the app ask before any Cloudflare connector call that writes or cannot be read as GET-only; reads run freely. A `cloudflare-work` skill describes how a change is proposed and logged, and `scripts/cloudflare-compare.mjs` reports drift against an expected state kept outside the repo.
