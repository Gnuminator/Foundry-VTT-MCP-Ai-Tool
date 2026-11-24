### Dashboard

- **Fewer background reads:** the dashboard read Foundry about 85,000 times a day. Module errors are now read every 15 s (was 6 s) and handouts every 15 s (was 5 s; a reveal made in the dashboard still reads at once). While Foundry is unreachable only one read keeps probing, and the rest resume the moment it answers. The 4,100 weekly read errors were Foundry being offline (the nightly 04:30 backup restart and deploys), not a bug (`dashboard-poll-errors`).
