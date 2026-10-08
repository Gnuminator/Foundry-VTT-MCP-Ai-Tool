### Development

- **Lint zero, sweep 1 (D-109):** return types and template strings in the module and the server;
  `require-await` is off and `||` stays allowed on strings, numbers and booleans (the lane's call
  after the user left both to it, 2026-10-08); informational module logs go through `log.ts`. No
  behaviour changes. Lint warnings 6464 to 5825.
