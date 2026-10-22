### Dashboard (paper-print)

- **Paper night print:** a fourth view on `/me`, "Paper night", is a sheet for a table that plays on
  paper. Each block shows the value as it was when the sheet was printed and a box to write the new
  one in: HP and temp HP, spell and pact slots, hit dice per class, class resources and item uses,
  coins, exhaustion, conditions, inspiration, death saves, and the inventory with a quantity column
  and empty lines. A carry-over strip at the end lists what gets read out when the night is synced.
  No XP. The other three views and their print are unchanged.
- **Print all party sheets:** a GM-only button in the Player links panel opens
  `/party-print.html`, every player character's paper-night sheet, two pages each, from the new
  GM-only route `GET /api/party-sheets`. Players still see only their own sheets.
