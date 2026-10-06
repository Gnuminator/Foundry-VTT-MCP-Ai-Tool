### Test kit

- **Console errors grouped:** the kit report groups the GM page's console errors by message and place
  (ids and line numbers stripped) with a count, first and last time and the scenarios, marks the known
  ones (Actor Studio's selector error and its 404) and warns about new ones at the top of the report and
  at the end of the run. The raw list stays in `report.json`.
- **The notification error explained and fixed:** the hundreds of `Cannot set properties of null
(setting 'hidden')` page errors in full runs came from chat cards the kit creates and deletes within
  100 ms while Foundry animates them as pop-ups. The kit's GM page no longer shows chat pop-ups, also after the page reloads (confirmed in a live full run: 0 of them, where one run without the reload step logged 8440).
