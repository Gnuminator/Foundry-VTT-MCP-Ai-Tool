### Module

- **Seven unused bridge handlers removed:** `requestAbilityCheck`, `requestAttackRoll`,
  `addActorsToScene`, `updateCampaignProgress`, `getEnhancedCreatureIndex` and the camelCase twins
  `getTokenDetails` and `getAvailableConditions` had no caller (the kebab-case names stay). A new
  contract test fails on any registered handler the backend and dashboard never send.
