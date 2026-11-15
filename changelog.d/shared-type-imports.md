### Module

- **One definition per wire type:** the module now takes `GuardedOp`, `ChangeRecord`, `ModuleHelloData`, `SceneInfo` and `WorldInfo` from `@gnuminator/shared` (type-only) instead of keeping copies. A lint rule allows only `import type` from the shared package in module source, and a ratchet test stops new copies of shared type names (Backlog `shared-type-imports`).
