#!/usr/bin/env sh
set -eu

warn() {
  message="PulseNet package setup warning: $1"
  if command -v logger >/dev/null 2>&1; then
    logger -t pulsenet-install "$message" || true
  fi
  printf '%s\n' "$message" >&2
}

if command -v setcap >/dev/null 2>&1; then
  found_binary=0
  for bin in /usr/bin/pulsenet /usr/lib/pulsenet/pulsenet /usr/bin/PulseNet; do
    if [ -x "$bin" ]; then
      found_binary=1
      if ! setcap cap_net_raw+ep "$bin" 2>/dev/null; then
        warn "could not grant ICMP capability to $bin; ping may require additional privileges"
      fi
    fi
  done
  if [ "$found_binary" -eq 0 ]; then
    warn "installed executable was not found; ICMP capability was not configured"
  fi
else
  warn "setcap is unavailable; install libcap tools to enable unprivileged ICMP ping"
fi

if command -v systemctl >/dev/null 2>&1; then
  if ! cat > /etc/systemd/system/pulsenet-network-control.service <<'EOF'
[Unit]
Description=PulseNet per-application network control
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/pulsenet --linux-network-helper-daemon
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
CapabilityBoundingSet=CAP_NET_ADMIN CAP_DAC_OVERRIDE CAP_SYS_ADMIN CAP_NET_RAW CAP_SYS_PTRACE
AmbientCapabilities=CAP_NET_ADMIN CAP_DAC_OVERRIDE CAP_SYS_ADMIN CAP_SYS_PTRACE
PrivateTmp=true
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
EOF
  then
    warn "could not write the network control service unit"
  elif ! systemctl daemon-reload; then
    warn "systemd could not reload service units; network control may be unavailable until daemon-reload succeeds"
  elif ! systemctl enable --now pulsenet-network-control.service; then
    warn "network control service could not start; inspect systemctl status pulsenet-network-control.service"
  elif ! systemctl restart pulsenet-network-control.service; then
    warn "network control service could not restart with the updated helper; inspect systemctl status pulsenet-network-control.service"
  fi
else
  warn "systemd is unavailable; per-application network limits cannot run on this system"
fi
