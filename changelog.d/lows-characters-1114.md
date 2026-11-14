### Fixes

- **Characters and rules lows:** plan-pc-creation refuses a repeated item uuid, passes its warnings
  to the dashboard diff, and its description names the Character creation switch (listed in the EN
  and DA GM docs). A failed helper build is logged by error code or name only, the player slug is
  trimmed again after shortening, `player-preset` reminds you to delete the file after sending, and
  the login-refused text points to Download my helper.
