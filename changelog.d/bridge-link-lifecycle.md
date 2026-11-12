### Module

- **The bridge link has its own file:** starting and stopping the link, its connection state, the
  heartbeat, the "server not found" notice and the GM link toasts moved from `main.ts` into
  `bridge-link-lifecycle.ts` with their own tests; `main.ts` hands over to it, and a test keeps
  link state from growing back into `main.ts`. No change in how the link behaves or its timings
  (Fable review pick R9).

### Fixes

- **Link toasts for the other GMs:** when the link went up, down and up quickly, an older write
  settling late could make the bridge user's browser skip telling the other GMs that the link
  was lost again (938 review L1).
