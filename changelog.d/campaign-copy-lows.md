### Testing

- **Campaign copy refresh keeps the old copy if the swap fails:** if the final move of the new data folder fails, `campaign-copy.ps1 refresh` moves `data.prev` back so the copy is never left empty. Also: the start and pid checks use the data folder of the `-Root` you pass (not a hardcoded name), `start` stops the shell it launched when it cannot find Foundry's process, and the docs note the tar space need, the "file changed as we read it" retry and that `admin.txt` is copied only when server A has one.
