#!/usr/bin/env sh
set -eu

if command -v setcap >/dev/null 2>&1; then
  for bin in /usr/bin/pulsenet /usr/lib/pulsenet/pulsenet /usr/bin/PulseNet; do
    if [ -x "$bin" ]; then
      setcap cap_net_raw+ep "$bin" 2>/dev/null || true
    fi
  done
fi

if command -v systemctl >/dev/null 2>&1; then
  cat > /etc/systemd/system/pulsenet-network-control.service <<'EOF'
[Unit]
Description=PulseNet per-application network control
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/pulsenet --linux-network-helper-daemon
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
CapabilityBoundingSet=CAP_NET_ADMIN CAP_SYS_ADMIN CAP_DAC_OVERRIDE
AmbientCapabilities=CAP_NET_ADMIN CAP_SYS_ADMIN CAP_DAC_OVERRIDE
PrivateTmp=true
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload || true
  systemctl enable --now pulsenet-network-control.service || true
fi
