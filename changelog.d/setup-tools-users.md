### Foundry setup (D-135)

- **User roles:** `plan-foundry-setup` with area `user` lists users (role, the actors each owns; never a password) and plans a role change between None, Player, Trusted Player and Assistant GM, through plan, confirm and undo. A Gamemaster is never made or changed, nor is the user the bridge runs as; permissions and passwords stay out of reach.
- **Journal and scene ownership:** area `ownership` reads and plans who may see or open a world journal or scene (`journal:<name>`, `scene:<name>`, default level and per-user levels). Actors still use `plan-ownership-change`.
