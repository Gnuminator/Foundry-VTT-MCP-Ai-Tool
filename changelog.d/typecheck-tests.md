### Tests

- **Test files are type-checked:** every workspace has a `tsconfig.test.json`, and a new `typecheck-tests` check in the `static` group counts the errors per workspace and per error code against `scripts/typecheck-tests-baseline.json`. The count can only go down, and the real mismatches (wrong property, missing name, wrong argument) are held at zero; the mismatches that were there are fixed in the tests.
