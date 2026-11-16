### Fixes

- **Python dependency alerts closed:** the optional transcriber extras and the narrator voice lock move to torch 2.14.1 (cu130 index, because the cu128 index stops at 2.11), transformers 5.23.0 and accelerate 1.15.0, which clears the Dependabot alerts for torch, transformers and accelerate (Backlog `security-pip-alerts`).
