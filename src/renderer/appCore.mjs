export const DRAG_OVERLAY_DROP_ANIMATION = {
  duration: 220,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

const PING_GOOD_THRESHOLD_MS = 120;
export const SPEED_PHASE_DOWNLOAD_DELAY_MS = 1200;
export const DONATE_NUDGE_DELAY_MS = 2 * 60 * 1000;
export const NETWORK_PROCESS_PREVIEW_LIMIT = 20;
export const NETWORK_DOWNLOAD_CHART_COLORS = [
  'var(--accent)',
  'var(--success)',
  'var(--warning)',
  'var(--danger)',
  '#9b8cff',
  '#42c4c7',
];
/** Build precise annular SVG sectors from byte totals (without stroked dash math). */
export const buildNetworkDownloadSegments = (applications, options = {}) => {
  const outerRadius = Number(options.outerRadius) || 48;
  const innerRadius = Number(options.innerRadius) || 39;
  const gapAngle = Number(options.gapAngle) || 0.035;
  const rows = Array.isArray(applications) ? applications : [];
  const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row?.downloadBytes) || 0), 0);
  if (!total || innerRadius <= 0 || outerRadius <= innerRadius) return [];

  const point = (radius, angle) => [60 + radius * Math.cos(angle), 60 + radius * Math.sin(angle)];
  let angle = -Math.PI / 2;
  return rows.map((application) => {
    const share = Math.max(0, Number(application?.downloadBytes) || 0) / total;
    const arc = share * Math.PI * 2;
    const gap = Math.min(gapAngle, arc * 0.12);
    const start = angle + gap / 2;
    const end = angle + arc - gap / 2;
    angle += arc;
    const largeArc = end - start > Math.PI ? 1 : 0;
    const [outerStartX, outerStartY] = point(outerRadius, start);
    const [outerEndX, outerEndY] = point(outerRadius, end);
    const [innerEndX, innerEndY] = point(innerRadius, end);
    const [innerStartX, innerStartY] = point(innerRadius, start);
    const path = arc <= gap
      ? ''
      : `M ${outerStartX} ${outerStartY} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEndX} ${outerEndY} L ${innerEndX} ${innerEndY} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStartX} ${innerStartY} Z`;
    return { ...application, share, path };
  });
};
export const BANDWIDTH_UNIT_FACTORS = {
  kbps: 1000,
  mbps: 1000000,
  kbytes: 8000,
  mbytes: 8000000,
};

const DEFAULT_HOSTS = [
  { type: 'default', label: 'Google DNS', host: '8.8.8.8' },
  { type: 'default', label: 'Cloudflare DNS', host: '1.1.1.1' },
  { type: 'default', label: 'Time.ir', host: 'time.ir' },
  { type: 'default', label: 'YouTube', host: 'youtube.com' },
];

export const HOST_PROFILES = {
  gaming: [
    { type: 'default', label: 'Cloudflare DNS', host: '1.1.1.1' },
    { type: 'default', label: 'Google DNS', host: '8.8.8.8' },
    { type: 'custom', id: 1700000000010, label: 'Steam', host: 'store.steampowered.com' },
    { type: 'custom', id: 1700000000011, label: 'Discord', host: 'discord.com' },
  ],
  work: [
    { type: 'default', label: 'Google DNS', host: '8.8.8.8' },
    { type: 'default', label: 'Cloudflare DNS', host: '1.1.1.1' },
    { type: 'custom', id: 1700000000020, label: 'GitHub', host: 'github.com' },
    { type: 'custom', id: 1700000000021, label: 'Microsoft', host: 'microsoft.com' },
  ],
  streaming: [
    { type: 'default', label: 'Cloudflare DNS', host: '1.1.1.1' },
    { type: 'default', label: 'Google DNS', host: '8.8.8.8' },
    { type: 'custom', id: 1700000000030, label: 'YouTube', host: 'youtube.com' },
    { type: 'custom', id: 1700000000031, label: 'Netflix', host: 'netflix.com' },
  ],
  iran: [
    { type: 'default', label: 'Time.ir', host: 'time.ir' },
    { type: 'custom', id: 1700000000040, label: 'Aparat', host: 'aparat.com' },
    { type: 'custom', id: 1700000000041, label: 'Digikala', host: 'digikala.com' },
    { type: 'default', label: 'Cloudflare DNS', host: '1.1.1.1' },
  ],
};

export const getDnsAdapterKey = (adapter) => adapter?.id || adapter?.name || '';

export const getNetworkProcessCategory = (process) => {
  const name = String(process?.name || '').toLowerCase();
  const path = String(process?.path || '').toLowerCase();
  const text = `${name} ${path}`;
  if (!name || name.startsWith('pid ')) return 'unknown';
  if (/(chrome|firefox|msedge|edge|brave|opera|vivaldi|iexplore|browser)/.test(text)) return 'browsers';
  if (/(system|svchost|services|lsass|csrss|wininit|winlogon|dwm|spoolsv|dns|dhcp|ntoskrnl|registry|runtimebroker|searchhost)/.test(text)) return 'system';
  return 'apps';
};

export const getNetworkProcessStatus = (connections) => {
  const value = Number(connections || 0);
  if (value >= 20) return 'high';
  if (value >= 3) return 'normal';
  return 'idle';
};

export const shouldGroupNetworkProcess = (process) => {
  const name = String(process?.name || '').toLowerCase();
  return getNetworkProcessCategory(process) === 'system' || name === 'svchost' || name === 'svchost.exe';
};

export const maskIpAddress = (ip) => {
  const value = String(ip || '').trim();
  if (!value || value === 'N/A') return 'N/A';
  return value.includes(':') ? '••••:••••:••••:••••' : '•••.•••.•••.•••';
};

export const formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Math.max(0, value);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
};

export const formatByteRate = (bytesPerSecond) => `${formatBytes(bytesPerSecond)}/s`;

export const formatBandwidthLimit = (bitsPerSecond) => {
  const value = Number(bitsPerSecond || 0);
  if (!value) return '--';
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)} Mbps`;
  return `${Math.round(value / 1000)} Kbps`;
};

export const getDefaultHosts = () => DEFAULT_HOSTS.map((host) => ({ ...host }));

export const getLatencyTone = (timeMs, warningThresholdMs) => {
  if (!Number.isFinite(timeMs)) return 'neutral';
  if (timeMs > warningThresholdMs) return 'warning';
  if (timeMs <= PING_GOOD_THRESHOLD_MS) return 'good';
  return 'neutral';
};

export const buildSparklinePath = (points, width, height, padding) => {
  if (!points.length) return '';
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const values = points.map((point) => point.value).filter((value) => Number.isFinite(value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);

  let path = '';
  let segmentOpen = false;
  points.forEach((point) => {
    const x = padding + point.ratio * chartWidth;
    if (!Number.isFinite(point.value)) {
      segmentOpen = false;
      return;
    }
    const normalized = (point.value - min) / range;
    const y = padding + chartHeight - normalized * chartHeight;
    if (!segmentOpen) {
      path += `M ${x.toFixed(2)} ${y.toFixed(2)}`;
      segmentOpen = true;
    } else {
      path += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
    }
  });
  return path;
};
