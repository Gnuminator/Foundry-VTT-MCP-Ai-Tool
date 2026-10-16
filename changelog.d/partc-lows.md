### Remote access (Part C)

- **Tunnel installer:** a failing task registration in `tunnel-client.ps1` Install now ends with a plain
  error line that says the old tunnel was stopped and to run Install again; a `-StateDir` that ends in a
  backslash is trimmed so the quoted task and `-NoTask` arguments work.
- **Obsidian plugin:** the Cloudflare Access Id and Secret fields accept both pasted header lines in one
  field, and a Secret line pasted into the Id field sends no Id instead of a wrong one.
- **Docs:** `set-dashboard-access.sh` no longer says stage 5 must be run again; Remote access step 5 says
  to save the route again.
