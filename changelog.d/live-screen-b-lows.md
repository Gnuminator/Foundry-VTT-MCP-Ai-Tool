### Dashboard

- **Live screen B hardening:** the strip page now drops a pick message whose origin is not the page that frames it (when the browser names that origin), the plain dashboard page says only the dashboard itself may frame it, and a refused click on the strip page sends the focus to the strip's own Turn on button. A test covers how the Foundry Live window remembers whether it was open.
