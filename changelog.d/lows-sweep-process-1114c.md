### Fixes

- **Process lows:** the merge runner's supervisor posts one line when a child ends with a code other than 0, 1 or 3 or a signal, and a test covers `FOUNDRY_TEST_SERVER=GPU` picking the GPU lock.
