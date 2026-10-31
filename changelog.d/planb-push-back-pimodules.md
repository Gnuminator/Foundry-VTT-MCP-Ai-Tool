### Pi scripts

- **Plan B push-back takes `-PiModules`:** `push-back.ps1 -Modules '' -PiModules id1,id2` builds a bundle for a world whose modules are already on the Pi, without shipping them (it passes the list on to `push-world.ps1`). This lets the Pi-side rollback drill run on the training world without touching the campaign's module folders.
