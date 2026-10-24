### Fixes

- **Play recorder create hooks:** the actor, item, effect and token create handlers expected Foundry's old four arguments, but Foundry 14 passes three (document, options, userId). They read the options as the user, so create records had no user name. They now take three, and the tests call them the way Foundry does.
- **Item, spell and feature cards reach the Live Feed:** posting a card to chat now shows "Akra used Bless" in the Live Feed, with or without a roll, and a PC's use shows on the player page. A whispered or blind card stays GM-only.
