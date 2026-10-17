### Release workflow (audit M1, M2, L1)

- **Pinned actions:** every action in `release.yml` is pinned to a full commit SHA with its version in a comment.
- **Pinned NSIS:** the installer build installs NSIS 3.10 from Chocolatey by version and prints `makensis /VERSION`.
- **Checksums:** the release publishes `SHA256SUMS.txt` for the uploaded files.
- **Tag name:** the tag reaches shell steps only through `env:` and must match `vX.Y.Z` (optional `-suffix`); `build-nsis.js` passes it to `makensis` as an argument list.
