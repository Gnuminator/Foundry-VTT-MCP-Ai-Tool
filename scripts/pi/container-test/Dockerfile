# The one image every Pi scenario script in this folder runs in (Debian 13 "trixie", ARM64, pinned by digest so an
# upstream change cannot alter a check overnight). It holds every apt package the scenarios used to install one by
# one at the start of each run (nodejs, curl, tar, zip, unzip, ca-certificates, the ssh packages, syncthing, tzdata,
# procps), so a run starts without a network round trip. Built by run-stage-container.mjs (tag = a hash of this file)
# and published by .github/workflows/pi-images.yml. Nothing here is deployed to the Pi.
# Update the digest with: docker buildx imagetools inspect debian:13 (the index digest, not one platform's).
FROM debian:13@sha256:913f6706df59a68922d1dd08f78c2476560a8d367897200a6005b00e5f67c2d5
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl nodejs openssh-client openssh-server passwd procps syncthing tar tzdata unzip zip \
 && apt-get clean \
 && find /var/lib/apt/lists -type f -delete
