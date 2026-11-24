### Orange Pi

- **The rebuild drill runs more of a real rebuild:** after stage 8 it now also runs stages 10, 16, 20, 21, 27,
  29, 30, 31, 32, 33 and 35 in the container, its service starter applies the drop-ins those stages write, and
  the doc lists the stages it cannot run and why. Rerun on v0.32.0 with the 2026-11-24 backup (3.9 GiB): all
  checks passed in 747 s.
