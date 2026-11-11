#!/usr/bin/env bash
set -euo pipefail

mkdir -p /mnt/d/AUTONEX/docker-data
cat <<EOF > /etc/docker/daemon.json
{
  "data-root": "/mnt/d/AUTONEX/docker-data"
}
EOF

systemctl restart docker
docker info | grep 'Docker Root Dir'
