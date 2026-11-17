### Module

- **The old permission path is gone:** `permissions.ts`, `transaction-manager.ts` and the unused creature-type search path in actor creation are deleted. The write gate and the GM gate were already doing the work. The actor quantity limit (10 by default) now sits next to the actor-creation code, and the data-access write functions refuse while "Allow Write Operations" is off with the write gate's own message. The unused `validateWritePermissions` query is removed. Undo of created actors and tokens still comes from the change journal.
