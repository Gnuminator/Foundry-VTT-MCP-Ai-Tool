### Development

- **Dashboard header test on any checkout:** the static-headers test "matches a group by file
  identity" no longer fails where `player.html` has an NTFS file id over 2^53 (its made-up 8.3
  path is now resolved to the real file).
