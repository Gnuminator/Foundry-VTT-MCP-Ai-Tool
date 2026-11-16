### Tools

- **One name for "the actor":** every tool that takes one actor now calls the parameter `actor`. The old names (`identifier`, `characterIdentifier`, `actorIdentifier`, `actorName`, `targetPlayer`, `character`) are still accepted and renamed by the tool router, so the dashboard and saved prompts keep working. `list-scenes` takes `activeOnly` (was `include_active_only`) and `switch-scene` takes `scene` (was `scene_identifier`), both with the old names accepted. Both scene tools now report errors as errors instead of returning `{success:false}`.
