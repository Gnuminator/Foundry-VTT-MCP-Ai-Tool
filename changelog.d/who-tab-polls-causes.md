### Fixes

- **Who tab counts real use:** the who-uses-what report now separates calls people made through Claude from the GM dashboard's own refreshes, and groups failed calls by cause (Foundry-down windows such as the nightly backup versus real failures). Old report fields stay (item `who-tab-polls-and-causes`).
- **Two GM PCs no longer look like one:** the who-uses-what report shows each Windows client install on its own line with its automatic-update switch (on, off, or unknown), and hides an old sighting without an install id once the same PC reports one. This one PR also fixes the logged low about merged GM rows.
