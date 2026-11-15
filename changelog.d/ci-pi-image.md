### Orange Pi

- **One test image and one test library for the Pi container tests:** the 21 scenario scripts in
  `scripts/pi/container-test/` no longer install their packages at the start of every run. They run in one
  prebuilt ARM64 image (`container-test/Dockerfile`, published by `pi-images.yml`, built locally when it cannot be
  pulled) and share `container-test/lib.sh` for `pass`, `fail`, the counter and the "only in the test container"
  guard. The tests call one helper, `runStageContainer`, instead of 19 copies of the `docker run` line, and a new
  test fails when a scenario script does not source `lib.sh` or brings its own `pass()` or `apt-get`. Tests only:
  nothing changes on the Pi.
