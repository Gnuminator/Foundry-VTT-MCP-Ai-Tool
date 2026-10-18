### NPC turn assistant (I-125; ships off)

- **`plan-npc-turn` (play set):** Claude reads the running fight and proposes a monster's turn. Without
  a move it returns the NPC whose turn it is (speed, attacks) and each enemy's distance, AC and hit
  points. With a grid square it checks the move (inside the speed, square free) and plans it as one
  guarded change with the usual confirmation, Undo and an entry in Recent Changes; with an attack and
  a target it also checks the reach after the move. The attack roll stays with `use-npc-activity` and
  the damage with `plan-actor-change` (the result names both), since a roll cannot be undone. One move
  and one attack per call; multiattack, spells and legendary actions come later. Off by default: the
  module setting "AI Tool: NPC turn assistant (writes)" must be on. Distances count whole squares;
  walls and difficult terrain are not checked.
- **Module:** new read-only bridge query `planNpcTurn` and the feature switch `npc-turn`.
- **Tool budget:** the play set's size budget goes from 32,000 to 33,000 characters for this tool.
