### Fixes

- **Ambiguous actor names are refused:** a tool given a short name that fits several characters
  ("Aria" for Aria Stormwind and Aria Brightwood) now answers with the candidates and their ids
  instead of acting on the first one. This covers use-item, add-feature, level-up, the roll tools
  and the other tools that take an actor name. An exact name or an id still works, and a name that
  fits only one character still resolves. Roll requests refuse several partial player or
  character names the same way.
