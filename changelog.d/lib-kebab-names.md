### Dashboard

- **Dashboard lib files use kebab-case names:** the 36 camelCase files in the dashboard's `web/src/lib` are renamed (`liveStrip.ts` is now `live-strip.ts`) to match the rest of the repo; only the file names and their imports change, no behaviour. Seven exports only used in their own file are no longer exported.
