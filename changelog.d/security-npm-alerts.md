### Fixes

- **Security alerts (npm and CodeQL):** zod moves to 4.6.7 (the memory exhaustion advisory has no 3.x fix), minimatch to 11 and katex to 0.18 through overrides, so `npm audit` reports nothing. The two CodeQL findings in test code are rewritten so the scanner can see the guards.
