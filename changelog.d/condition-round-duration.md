### Module

- **Conditions that last a number of rounds:** `plan-actor-change` takes an optional `rounds` (1 to 100) for a condition. The plan builds it into the status effect as a duration in rounds, so Foundry counts it as expired afterwards and `clear-conditions` removes it. The preview says "for 1 round". Exhaustion (a level) refuses it. This is the backend for the live strip's "1 round" choice.
