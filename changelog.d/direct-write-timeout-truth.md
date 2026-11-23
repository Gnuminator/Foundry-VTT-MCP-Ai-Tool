### Fixes

- **A direct write that gets no answer now says so honestly:** every direct write (chat message, combat turn, item use and the rest) waits 30 s instead of 10 s for Foundry, and a lost answer reads "no answer from Foundry in 30 s. The change may or may not have happened: check the chat log or the change list before trying again", so Claude no longer retries blindly and double-posts. One helper covers every route, the dashboard buttons included.
