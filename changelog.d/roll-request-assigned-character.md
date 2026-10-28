### Fixes

- **Roll requests use the player's assigned character:** a roll button asked for a player rolled for the first actor that player owns, so a player with more than one actor (an alternate character, a familiar) could roll with the wrong bonuses, or fall back to a plain d20 when the weapon was on another actor. It now uses the character assigned to the player in User Configuration, and the first owned actor only when none is assigned.
