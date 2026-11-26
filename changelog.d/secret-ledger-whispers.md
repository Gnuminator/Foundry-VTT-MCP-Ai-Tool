### Dashboard

- **Who knows what and the whisper desk:** a GM-only ledger of who has heard which secret (Prep
  drawer, plus a "Mark who knows" chip on every page in the read-aloud drawer), and a **Whisper**
  box on the live strip that sends one line to one player as a Foundry whisper and, when linked, a
  private Discord message, and records it in the ledger. Claude reads the ledger with the new
  `get-secret-ledger` tool (Play); it never writes it. The ledger lives in the GM-only vault and
  never reaches the player page or the TV (item `secret-ledger-whispers`).
