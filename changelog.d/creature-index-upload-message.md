### Module

- **Creature index save failure explains itself:** when Foundry refuses the index upload (a
  replaced browser session, `User [] does not have permission to upload files`), the error now
  says so and suggests reloading the world. Found on the test servers, where joining two servers on
  the same host name in one browser shares the session cookie.
