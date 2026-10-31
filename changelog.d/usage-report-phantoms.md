### Fixes

- **usage-report.py:** a response that called the advisor reports its last executor pass as the context (it was the two passes summed, about double), and its cost now includes the advisor's own pass.
