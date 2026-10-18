### Play

- **Fit tokens to the map's scale:** `plan-token-change` has a new action `fit-scale`. On a scene
  whose squares are not 5 ft (town and overland maps are 16 to 200 ft), it sizes each creature
  token so it covers its real footprint (a medium creature is 5 ft, a large one 10 ft, from the
  actor's size), with a floor of 0.25 squares so tokens stay visible. It also locks the token's
  size so dnd5e's Autosize does not set it back. Name tokens, or leave them out for every creature
  on the scene. A 5 ft scene is left alone. Plan, confirm and Undo like any token change.
