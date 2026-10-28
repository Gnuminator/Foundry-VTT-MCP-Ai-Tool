### Pi (PR #554 review lows)

- **Stage 17 and a loopback nameserver:** a nameserver in `127.0.0.0/8` in `/etc/resolv.conf` (a local resolver such as 127.0.0.53) is no longer put on the runner's allow list, where it would have opened loopback to the jobs. The stage stops before writing anything and names the address.
- **PI-SETUP, stage 17:** says that IPv6 is denied as a whole, that the `/etc/resolv.conf` nameservers are allowed along with the router, and that a failed fence probe turns the gate timer off.
