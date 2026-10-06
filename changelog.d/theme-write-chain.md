### Fixes

- **Dashboard theme saves no longer race:** two tabs choosing a theme at the same moment could
  trip over the shared temporary file; saves now run one after another, like the layout choices.
