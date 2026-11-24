### Orange Pi

- **Set a world switch on the Pi without a world bundle:** the new stage 37 joins the running world as the GM and sets only the named switches (default `item-piles.enableTrading`), so the trading line no longer needs `push-world.ps1`, which refuses the PC copy of the campaign world. `CHECK=1` reads, `APPLY=1` sets after a snapshot; nothing else is touched (backlog `stage11-clean-world-route`).
