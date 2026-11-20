/**
 * The Veil (D-085) for Foundry's /join page, as one string the Worker puts in a <style> tag.
 * Colours match the dashboard's themes/veil.css. Unlayered, so it wins over Foundry's layered
 * CSS. Only colours, borders and type: no layout is touched, so the page works as before.
 * Amiri is the serif Foundry's own CSS already loads on /join.
 */
export const VEIL_JOIN_CSS = `
body.join {
  --veil-graphite: #1a1d1c;
  --veil-raised: #262b29;
  --veil-mist: #8fa39a;
  --veil-bone: #e8e6df;
  --veil-bone-2: #c9ccc4;
  --veil-lamp: #f2d88a;
  color: var(--veil-bone);
}
body.join #main-background {
  filter: brightness(0.55) saturate(0.7);
}
body.join #main-header h1,
body.join h2.divider {
  font-family: Amiri, Georgia, serif;
  color: var(--veil-bone);
  text-shadow: 0 0 22px rgb(242 216 138 / 35%);
}
body.join .application.framed {
  background: rgb(26 29 28 / 92%);
  border: 1px solid rgb(143 163 154 / 24%);
  border-top-color: rgb(242 216 138 / 45%);
  border-radius: 4px;
  box-shadow: 0 0 22px -8px rgb(242 216 138 / 45%);
  color: var(--veil-bone);
}
body.join .application label,
body.join .application .form-fields,
body.join #world-description {
  color: var(--veil-bone-2);
}
body.join select,
body.join input[type='text'],
body.join input[type='password'] {
  background: #171a19;
  border: 1px solid rgb(143 163 154 / 35%);
  color: var(--veil-bone);
}
body.join input:focus {
  border-color: var(--veil-lamp);
  box-shadow: 0 0 8px rgb(242 216 138 / 40%);
  outline: none;
}
body.join button.bright,
body.join button[type='submit'] {
  background: var(--veil-raised);
  border: 1px solid var(--veil-lamp);
  color: var(--veil-lamp);
}
body.join button.bright:hover,
body.join button[type='submit']:hover {
  background: #2e3431;
  box-shadow: 0 0 12px rgb(242 216 138 / 40%);
}
body.join #watermark,
body.join #watermark p {
  color: var(--veil-mist);
}
`;
