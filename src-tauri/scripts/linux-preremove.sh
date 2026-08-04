#!/usr/bin/env sh
set -eu

if command -v systemctl >/dev/null 2>&1; then
  systemctl disable --now pulsenet-network-control.service 2>/dev/null || true
  rm -f /etc/systemd/system/pulsenet-network-control.service
  systemctl daemon-reload 2>/dev/null || true
fi

if command -v nft >/dev/null 2>&1; then
  nft list tables 2>/dev/null \
    | sed -n 's/^table inet \(pulsenet_[0-9][0-9]*\)$/\1/p' \
    | while IFS= read -r table; do
        nft delete table inet "$table" 2>/dev/null || true
      done
fi

rm -rf /sys/fs/cgroup/pulsenet 2>/dev/null || true
rm -f /run/pulsenet-network-control.pid
