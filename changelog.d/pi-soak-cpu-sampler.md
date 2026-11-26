### Orange Pi

- **Pi soak measures Foundry CPU on the container stack:** the soak's Foundry CPU bar now reads the `foundry` compose container's cgroup (and reports container restarts); the `foundry.service` unit is only the fallback on the old systemd stack. The first soak on containers showed the bar as "not measured" (pi-soak-cpu-sampler).
