### Dashboard

- **Live strip lows (PR #642 review):** the Damage form and the condition chips wait for GM Actions and writes only (not live play), and the form is not offered while they are off. Next turn waits for the same two switches; End combat still needs live play. The Damage form and the strip share one busy lock, so a hit and Next turn cannot run together. After the form closes, Clear or a condition is applied, keyboard focus goes to the pick bar. The fight summary is a live region, small buttons have a 24 px minimum height, and the "may have applied" hint always follows a full stop.
