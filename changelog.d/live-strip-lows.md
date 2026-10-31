### Dashboard

- **Live strip lows (PR #642 review):** Next turn waits for GM Actions and writes only (it is not a live-play write); the Damage form is not offered while a switch it needs is off. The Damage form and the strip share one busy lock, so a hit and Next turn cannot run together. After the form closes, Clear or a condition is applied, keyboard focus goes to the pick bar. The fight summary is one live region that stays mounted, small buttons have a 24 px minimum height, and the "may have applied" hint always follows a full stop.
