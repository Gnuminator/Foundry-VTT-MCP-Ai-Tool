---
title: 'One-time setup: the dashboard'
description: Open the dashboard on your second screen for the first time, sign in through Cloudflare, bookmark it and pick your During layout. About 10 minutes, once.
---

# One-time setup: the dashboard

The dashboard is your control panel on a second screen. The server runs it all the time, so there is
nothing to install. You open it, sign in, bookmark it and choose how the During screen looks. Every
panel is explained in [The dashboard](dashboard.md). About 10 minutes, once.

**You need:** the dashboard address from the person who built the tool, and the email address they
gave Cloudflare for you.

## Open it and sign in

1. Type the dashboard address in your browser (Edge or Chrome) on the screen the players cannot see.
2. Cloudflare asks for your email address. Type it and click **Send me a code**.
3. Open your email, copy the six digit code, paste it in the Cloudflare page and click **Sign in**.
   Cloudflare asks again now and then; that is normal.
4. Bookmark the page (Ctrl + D).

## Look at the header

At the top, the **✈ Pre-flight** button should say "ready" or "N to fix", and no "Connection lost"
mark should show. Click **✈ Pre-flight** once to see the list; fixing it is part of
[Before each session](before-session.md).

## Pick your During layout

1. In the header click **Advanced ▾**. In the **During screen** group click **▦ Try the During layouts**.
   (On a first visit the **Before** screen also has a card **Pick your During layout** with the same
   trial; it is gone once a layout has been picked.)
2. The three layouts show on the real screen, one after another, with a small guide in the corner.
3. Click **Next** until **Auto** shows, then click **Use this one**. **Auto** follows the game: it looks like Cards until
   a fight starts, then the Combat order grows. **Stop** keeps what you had.
4. You can change it any time with **Layout** at the top of the During screen.

## Combat buttons

The Damage / Heal, Condition and Clear buttons in the combat strip work once **GM Actions** is on.
Clicking **Start session** in the header turns it on for the night, so you do not set anything
now. Until then they can be off, and that is normal.

## Done when it looks like this

The dashboard opens from your bookmark, the Live Feed and Recent Changes show, there is no
"Connection lost" mark, and **Layout** at the top of the During screen shows the layout you chose.

## If it does not work

- **Cloudflare says your email is not allowed:** it is not on the list. Tell the person who built
  the tool the exact address you used.
- **No code arrives:** look in the spam folder, then ask for a new code.
- **"Connection lost" or Pre-flight says Foundry is not connected:** see
  [Troubleshooting](troubleshooting.md).
- **GM buttons are refused although the dashboard is connected:** the browser does not have the GM
  token yet. Open the address the person who built the tool gave you for the GM (it ends in
  `?token=` and a long string) once, in the browser you use for the dashboard; the browser
  remembers it for that address. Then use your bookmark. The token is tied to that https address
  and that browser, so a second browser or a changed address needs the link once more.
- **The card "Pick your During layout" is not there:** use **Advanced ▾**, **▦ Try the During
  layouts** instead.
