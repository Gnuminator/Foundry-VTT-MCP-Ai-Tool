### Fixes

- **Player connector logins:** a tag listed in both `audience` and `appAudience` is now dropped from `appAudience` with a warning, and a valid app login gets "try again" (503) instead of "check your login" (401) when only the app keys could not be fetched.
