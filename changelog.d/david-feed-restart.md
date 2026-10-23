### Dashboard

- **Live Feed keeps going:** the feed no longer depends on one time cursor alone. Every few polls it reads the newest events again and passes on the ones it has not shown, and a cursor that is ahead of Foundry's clock is dropped, so an event stamped behind the cursor cannot hide the feed after a session ends and starts again.
