### Fixes

- **Undo and the Prone it removes:** the "Also removed: Prone" line is written after the undo ran and only for a Prone that was really removed. A second change that leaves a hero at 0 HP no longer claims the first change's Prone.
- **Renamed tools:** a call to an old tool name now logs under the tool set of the tool it became, and a cut result names that tool's parameters.
- **Who uses what:** the Claude connector and client rows carry a short per-PC id, so two PCs on one bridge are two rows.
- **plan-macro:** the description says how to write a random index the macro check accepts.
