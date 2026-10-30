### Dashboard

- **Fewer requests at first load:** the floating panels (Paper sync, Tarokka, Tools, links, diagnostics, versions) now start downloading five seconds after the page appears, one per idle moment, instead of all at once. Two seconds in, the page has made 38 requests instead of 47 (10 script files instead of 18). A panel opened earlier loads when opened.
