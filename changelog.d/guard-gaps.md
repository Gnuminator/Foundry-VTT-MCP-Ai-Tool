### Orange Pi (D-068)

- **The remote-command guard closes the older gaps the PR #146 review found:** ssh written another
  way (`bash -c 'ssh ...'`, `/usr/bin/ssh`, `"ssh"`) is checked, and
  `ssh localhost "ssh foundry-pi ..."` no longer passes as a localhost-only command. A command word
  behind a wrapper counts (`sudo -n reboot`, `nohup reboot`, `then reboot`, `timeout 10 reboot`,
  `env A=1 userdel x`). `rm` options after the path count (`rm /srv/data -rf`), which also catches
  `rm --interactive=never -rf /etc` (it passed before). A recursive `chmod`, `chown` or `chgrp` of
  any path outside our own folders asks (`chmod -R 777 /etc/ssh`, `chown -R x /usr/lib`), and
  `/usr/*` is denied like `/usr`. `chmod`, `chown`, `chattr` and `install` on a critical file in
  /etc ask, and writes to /boot ask (`sed -i ... /boot/dietpiEnv.txt`). Network changes ask
  (`ip link set eth0 down`, `ifconfig`, `ifdown`, `nmcli ... off`, `tailscale down` or `logout`),
  and so do SSH and network services stopped through `systemctl stop "ssh"`, `service ssh stop`,
  `/etc/init.d/ssh` or `pkill sshd`. `apt-get -o X=y remove` also asks. Every new check runs in
  linear time (the 50,000-character test has 32 new shapes). The old and new guard were compared on
  about 43,000 commands (hand-written, generated and the new shapes) plus the 38 ssh lines in
  PI-SETUP and the Pi scripts: no decision got looser, and the stage scripts and drill commands
  pass as before.
