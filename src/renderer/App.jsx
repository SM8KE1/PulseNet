import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Lenis from 'lenis';
import Lottie from 'lottie-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import 'flag-icons/css/flag-icons.min.css';
import ThemeToggle from './ThemeToggle';
import GitHubIcon from './GitHubIcon';
import {
  compareNetworkProcesses,
  hasActiveBandwidthLimit,
  normalizeLimiterPath,
} from './networkUsage.mjs';
import iconIco from '../../assets/icon.ico';
import iranFlag from '../../assets/iran.svg';
import earthA from '../../assets/earth-a.svg';
import earthB from '../../assets/earth-b.svg';
import dnsIcon from '../../assets/dns.svg';
import pingIcon from '../../assets/ping.svg';
import playIcon from '../../assets/play.svg';
import pauseIcon from '../../assets/pause.svg';
import speedIcon from '../../assets/speed.svg';
import nusageIcon from '../../assets/nusage.svg';
import logIcon from '../../assets/log.svg';
import settingIcon from '../../assets/setting.svg';
import aboutIcon from '../../assets/about.svg';
import reloadLottie from '../../assets/reload-lottie.json';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const DRAG_OVERLAY_DROP_ANIMATION = {
  duration: 220,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

const PING_GOOD_THRESHOLD_MS = 120;
const SPEED_PHASE_DOWNLOAD_DELAY_MS = 1200;
const DONATE_NUDGE_DELAY_MS = 2 * 60 * 1000;
const NETWORK_PROCESS_PREVIEW_LIMIT = 4;
const NETWORK_DOWNLOAD_CHART_COLORS = [
  'var(--accent)',
  'var(--success)',
  'var(--warning)',
  'var(--danger)',
  '#9b8cff',
  '#42c4c7',
];
const NETWORK_DOWNLOAD_CHART_CIRCUMFERENCE = 2 * Math.PI * 46;
const BANDWIDTH_UNIT_FACTORS = {
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

const getDnsAdapterKey = (adapter) => adapter?.id || adapter?.name || '';

const getNetworkProcessCategory = (process) => {
  const name = String(process?.name || '').toLowerCase();
  const path = String(process?.path || '').toLowerCase();
  const text = `${name} ${path}`;
  if (!name || name.startsWith('pid ')) return 'unknown';
  if (/(chrome|firefox|msedge|edge|brave|opera|vivaldi|iexplore|browser)/.test(text)) return 'browsers';
  if (/(system|svchost|services|lsass|csrss|wininit|winlogon|dwm|spoolsv|dns|dhcp|ntoskrnl|registry|runtimebroker|searchhost)/.test(text)) return 'system';
  return 'apps';
};

const getNetworkProcessStatus = (connections) => {
  const value = Number(connections || 0);
  if (value >= 20) return 'high';
  if (value >= 3) return 'normal';
  return 'idle';
};

const shouldGroupNetworkProcess = (process) => {
  const name = String(process?.name || '').toLowerCase();
  return getNetworkProcessCategory(process) === 'system' || name === 'svchost' || name === 'svchost.exe';
};

const HOST_PROFILES = {
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

const maskIpAddress = (ip) => {
  const value = String(ip || '').trim();
  if (!value || value === 'N/A') return 'N/A';
  return value.includes(':') ? '••••:••••:••••:••••' : '•••.•••.•••.•••';
};

const formatBytes = (bytes) => {
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

const formatByteRate = (bytesPerSecond) => `${formatBytes(bytesPerSecond)}/s`;

const formatBandwidthLimit = (bitsPerSecond) => {
  const value = Number(bitsPerSecond || 0);
  if (!value) return '--';
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)} Mbps`;
  return `${Math.round(value / 1000)} Kbps`;
};

const getDefaultHosts = () => DEFAULT_HOSTS.map((host) => ({ ...host }));

const getLatencyTone = (timeMs, warningThresholdMs) => {
  if (!Number.isFinite(timeMs)) return 'neutral';
  if (timeMs > warningThresholdMs) return 'warning';
  if (timeMs <= PING_GOOD_THRESHOLD_MS) return 'good';
  return 'neutral';
};

const buildSparklinePath = (points, width, height, padding) => {
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

// Custom hook for managing all hosts with localStorage
const useHosts = () => {
  const [allHosts, setAllHosts] = useState([]);

  useEffect(() => {
    const stored = localStorage.getItem('allHosts');
    if (stored) {
      try {
        const parsedHosts = JSON.parse(stored);
        setAllHosts(parsedHosts);
      } catch (e) {
        console.error('Error parsing hosts from localStorage:', e);
        setAllHosts(getDefaultHosts());
      }
    } else {
      const defaultHosts = getDefaultHosts();
      setAllHosts(defaultHosts);
      localStorage.setItem('allHosts', JSON.stringify(defaultHosts));
    }
  }, []);

  const addHost = (host) => {
    const newHost = { type: 'custom', id: Date.now(), pinned: false, paused: false, ...host };
    setAllHosts((prevHosts) => {
      const newHosts = [newHost, ...prevHosts];
      localStorage.setItem('allHosts', JSON.stringify(newHosts));
      return newHosts;
    });
  };

  return { allHosts, setAllHosts, addHost };
};

const usePing = (host, statusTexts, intervalMs, enabled = true, showPausedState = true, trackHistory = true) => {
  const [pingData, setPingData] = useState({
    status: '--',
    hasError: false,
    timeMs: null,
    errorKind: null,
  });
  const [history, setHistory] = useState([]);
  const [sampleWindow, setSampleWindow] = useState([]);
  const maxHistoryPoints = useMemo(() => {
    const safeInterval = Math.max(250, Number(intervalMs) || 1000);
    return Math.max(18, Math.min(100, Math.floor(60_000 / safeInterval)));
  }, [intervalMs]);

  useEffect(() => {
    setHistory((prev) => prev.slice(-maxHistoryPoints));
  }, [maxHistoryPoints]);

  useEffect(() => {
    if (!trackHistory) {
      setHistory([]);
    }
  }, [trackHistory]);

  useEffect(() => {
    let isCancelled = false;
    const pushHistory = (value) => {
      if (!trackHistory) return;
      setHistory((prev) => {
        const next = [...prev, value];
        if (next.length > maxHistoryPoints) {
          next.splice(0, next.length - maxHistoryPoints);
        }
        return next;
      });
    };
    const pushSample = (alive) => {
      setSampleWindow((prev) => {
        const next = [...prev, Boolean(alive)];
        if (next.length > 20) {
          next.splice(0, next.length - 20);
        }
        return next;
      });
    };

    if (!enabled) {
      if (showPausedState) {
        setPingData((prev) => ({
          ...prev,
          status: statusTexts.paused,
          hasError: false,
          timeMs: null,
          errorKind: 'paused',
        }));
      }
      return () => {};
    }

    const ping = async () => {
      try {
        const result = await invoke('ping_host', { host });
        if (isCancelled) return;
        if (result.error) {
          pushHistory(null);
          pushSample(false);
          if (result.error.includes('permission')) {
            setPingData({
              status: statusTexts.needAdmin,
              hasError: true,
              timeMs: null,
              errorKind: 'permission',
            });
          } else {
            setPingData({
              status: statusTexts.error,
              hasError: true,
              timeMs: null,
              errorKind: 'error',
            });
          }
        } else if (!result.alive) {
          pushHistory(null);
          pushSample(false);
          setPingData({
            status: statusTexts.noResponse,
            hasError: true,
            timeMs: null,
            errorKind: 'no-response',
          });
        } else {
          pushHistory(result.time);
          pushSample(true);
          setPingData({
            status: `${Math.round(result.time)}ms`,
            hasError: false,
            timeMs: result.time,
            errorKind: null,
          });
        }
      } catch (e) {
        if (isCancelled) return;
        pushHistory(null);
        pushSample(false);
        console.error('Ping IPC failed:', e);
        setPingData({
          status: statusTexts.ipcError,
          hasError: true,
          timeMs: null,
          errorKind: 'ipc',
        });
      }
    };

    ping();
    const intervalId = setInterval(ping, intervalMs);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [host, statusTexts, intervalMs, maxHistoryPoints, enabled, showPausedState, trackHistory]);

  return {
    ...pingData,
    history,
    lossPercent: sampleWindow.length ? Math.round((sampleWindow.filter((alive) => !alive).length / sampleWindow.length) * 100) : 0,
    sampleCount: sampleWindow.length,
    isPending: enabled && history.length === 0,
  };
};

const PingSparkline = ({ values, tone }) => {
  const width = 120;
  const height = 34;
  const padding = 4;
  const points = useMemo(() => {
    if (!Array.isArray(values) || values.length === 0) return [];
    const lastIndex = Math.max(1, values.length - 1);
    return values.map((value, index) => ({
      value: Number.isFinite(value) ? value : null,
      ratio: index / lastIndex,
    }));
  }, [values]);

  const path = useMemo(() => buildSparklinePath(points, width, height, padding), [points]);

  if (!path) {
    return (
      <div className="ping-sparkline empty" aria-hidden="true">
        <span className="ping-sparkline-empty-line"></span>
      </div>
    );
  }

  return (
    <svg className={`ping-sparkline ${tone}`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path className="ping-sparkline-path" d={path}></path>
    </svg>
  );
};

const SortableItem = ({
  id,
  label,
  host,
  editing = false,
  onSave,
  onCancel,
  onDelete,
  showDelete = false,
  isEditMode = false,
  isSorting = false,
  isDragSource = false,
  texts,
  statusTexts,
  pingIntervalMs,
  onLog,
  pingAlertThresholdMs,
  packetLossAlertThreshold,
  isPinned = false,
  isPaused = false,
  isCopied = false,
  optimizationEnabled = false,
  onTogglePin,
  onTogglePause,
  onCopy,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const shouldPollPing = !isPaused && !isEditMode && !editing;
  const { status, hasError, timeMs, errorKind, history, lossPercent, sampleCount, isPending } = usePing(
    host,
    statusTexts,
    pingIntervalMs,
    shouldPollPing,
    isPaused,
    !optimizationEnabled
  );
  const [editLabel, setEditLabel] = useState(label || '');
  const [editHost, setEditHost] = useState(host || '');
  const lastAlertRef = useRef(0);

  const tone = useMemo(() => {
    if (isPaused || errorKind === 'paused') return 'neutral';
    if (hasError) return 'bad';
    return getLatencyTone(timeMs, pingAlertThresholdMs);
  }, [isPaused, errorKind, hasError, timeMs, pingAlertThresholdMs]);

  const toneLabel = useMemo(() => {
    if (isPaused || errorKind === 'paused') return texts.statusPaused;
    if (hasError) return texts.statusDown;
    if (!Number.isFinite(timeMs)) return texts.statusUnknown;
    if (tone === 'good') return texts.statusGood;
    if (tone === 'warning') return texts.statusWarning;
    return texts.statusStable;
  }, [isPaused, errorKind, hasError, timeMs, tone, texts]);

  useEffect(() => {
    if (!onLog) return;
    if (isEditMode) return;
    const now = Date.now();
    const cooldownMs = 60_000;
    if (now - lastAlertRef.current < cooldownMs) return;

    if (hasError && errorKind && errorKind !== 'permission' && errorKind !== 'paused') {
      lastAlertRef.current = now;
      onLog({
        type: 'alert',
        title: texts.logPingAlert,
        detail: `${label} • ${host} • ${status}`,
      });
      return;
    }

    if (typeof timeMs === 'number' && pingAlertThresholdMs && timeMs > pingAlertThresholdMs) {
      lastAlertRef.current = now;
      onLog({
        type: 'alert',
        title: texts.logPingHighLatency,
        detail: `${label} • ${host} • ${Math.round(timeMs)}ms`,
      });
    }
    if (sampleCount >= 8 && lossPercent >= packetLossAlertThreshold) {
      lastAlertRef.current = now;
      onLog({
        type: 'alert',
        title: texts.logPacketLoss,
        detail: `${label} • ${host} • ${lossPercent}%`,
      });
    }
  }, [onLog, isEditMode, hasError, errorKind, timeMs, pingAlertThresholdMs, packetLossAlertThreshold, lossPercent, sampleCount, label, host, status, texts]);

  const handleSave = () => {
    const normalizedHost = editHost.trim();
    if (!normalizedHost) return;

    const normalizedLabel = editLabel.trim() || normalizedHost;
    onSave(normalizedLabel, normalizedHost);
  };

  const handleCancel = () => {
    onCancel();
  };

  const handleDelete = () => {
    onDelete();
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : (transition || 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)'),
    zIndex: isDragging ? 1200 : undefined,
    willChange: 'transform',
  };

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="ping-card editing">
        <div className="ping-info">
          <input
            type="text"
            placeholder={texts.hostNameShortPlaceholder}
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            onKeyDown={handleKeyPress}
            className="edit-input"
            autoFocus
          />
          <input
            type="text"
            placeholder={texts.hostIpShortPlaceholder}
            value={editHost}
            onChange={(e) => setEditHost(e.target.value)}
            onKeyDown={handleKeyPress}
            className="edit-input"
          />
        </div>
        <div className="ping-actions">
          <button className="save-button" onClick={handleSave}>
            {texts.save}
          </button>
          <button className="cancel-button" onClick={handleCancel}>
            {texts.cancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`ping-card ${isDragging ? 'dragging' : ''} ${isEditMode ? 'edit-mode' : ''} ${isSorting ? 'sorting' : ''} ${isDragSource ? 'drag-source' : ''} ${isPinned ? 'pinned' : ''} ${isPaused ? 'paused' : ''}`}
      {...attributes}
    >
      {isEditMode && (
        <div
          ref={setActivatorNodeRef}
          className="drag-handle active"
          {...listeners}
          title={texts.dragToReorder}
          style={{ cursor: 'grab', touchAction: 'none' }}
        >
          <div className="drag-line"></div>
          <div className="drag-line"></div>
          <div className="drag-line"></div>
        </div>
      )}
      <div className="ping-info">
        <div className="ping-label-row">
          <div className="ping-label">{label}</div>
          {!isEditMode && <span className={`status-pill ${tone}`}>{toneLabel}</span>}
        </div>
        <div className="ping-ip">{host}</div>
        {!isEditMode && (
          <div className="ping-loss">{texts.packetLoss}: {sampleCount ? `${lossPercent}%` : '--'}</div>
        )}
        {!isEditMode && (
          <div className="ping-sparkline-slot">
            {!optimizationEnabled && <PingSparkline values={history} tone={tone} />}
          </div>
        )}
      </div>
      <div className="ping-actions">
        <div className={`ping-value ${hasError ? 'error' : ''} ${!optimizationEnabled && isPending ? 'skeleton-line' : ''}`}>{status}</div>
        {!showDelete && (
          <div className="ping-quick-actions">
            <button
              type="button"
              className={`ping-quick-btn ${isCopied ? 'active' : ''}`}
              onClick={() => onCopy?.(id, host)}
              title={isCopied ? texts.copied : texts.copy}
            >
              {isCopied ? texts.copiedShort : texts.copyShort}
            </button>
            <button
              type="button"
              className={`ping-quick-btn ${isPinned ? 'active' : ''}`}
              onClick={() => onTogglePin?.(id)}
              title={isPinned ? texts.unpin : texts.pin}
            >
              {isPinned ? texts.unpinShort : texts.pinShort}
            </button>
            <button
              type="button"
              className={`ping-quick-btn ${isPaused ? 'active warning' : ''}`}
              onClick={() => onTogglePause?.(id)}
              title={isPaused ? texts.resume : texts.pause}
            >
              {isPaused ? texts.resumeShort : texts.pauseShort}
            </button>
          </div>
        )}
        {showDelete && (
          <button className="delete-button" onClick={handleDelete} title={texts.deleteTitle(label)}>
            ×
          </button>
        )}
      </div>
    </div>
  );
};

const PencilIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const EditIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const GiftIcon = () => (
  <svg
    className="sidebar-support-icon"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M12 20.2 5.1 13.4C1.4 9.8 4 3.8 9.1 5.3c1.2.4 2.2 1.2 2.9 2.2.7-1 1.7-1.8 2.9-2.2 5.1-1.5 7.7 4.5 4 8.1L12 20.2Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const EyeOpenIcon = ({ className = '' }) => (
  <svg className={className} width="18" height="18" viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z" />
  </svg>
);

const EyeOffIcon = ({ className = '' }) => (
  <svg className={className} width="18" height="18" viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M53.92,34.62A8,8,0,1,0,42.08,45.38L61.32,66.55C25,88.84,9.38,123.2,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208a127.11,127.11,0,0,0,52.07-10.83l22,24.21a8,8,0,1,0,11.84-10.76Zm47.33,75.84,41.67,45.85a32,32,0,0,1-41.67-45.85ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.16,133.16,0,0,1,25,128c4.69-8.79,19.66-33.39,47.35-49.38l18,19.75a48,48,0,0,0,63.66,70l14.73,16.2A112,112,0,0,1,128,192Zm6-95.43a8,8,0,0,1,3-15.72,48.16,48.16,0,0,1,38.77,42.64,8,8,0,0,1-7.22,8.71,6.39,6.39,0,0,1-.75,0,8,8,0,0,1-8-7.26A32.09,32.09,0,0,0,134,96.57Zm113.28,34.69c-.42.94-10.55,23.37-33.36,43.8a8,8,0,1,1-10.67-11.92A132.77,132.77,0,0,0,231.05,128a133.15,133.15,0,0,0-23.12-30.77C185.67,75.19,158.78,64,128,64a118.37,118.37,0,0,0-19.36,1.57A8,8,0,1,1,106,49.79,134,134,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41A8,8,0,0,1,247.31,131.26Z" />
  </svg>
);

const RefreshIcon = ({ spinning = false }) => {
  const lottieRef = useRef(null);

  useEffect(() => {
    const icon = lottieRef.current;
    if (!icon) return;
    if (spinning) {
      icon.setDirection?.(1);
      icon.setSpeed?.(1);
      icon.play?.();
      return;
    }
    icon.stop?.();
    icon.goToAndStop?.(0, true);
  }, [spinning]);

  return (
    <span className="refresh-lottie" aria-hidden="true">
      <Lottie
        lottieRef={lottieRef}
        animationData={reloadLottie}
        loop={spinning}
        autoplay={false}
        className="refresh-lottie-player"
      />
    </span>
  );
};

const TranslateToggle = ({ isActive, onToggle }) => (
  <div className="translate-toggle" onClick={onToggle} role="button" aria-label="Toggle language">
    <img src={earthA} alt="" className={`translate-icon ${isActive ? '' : 'active'}`} />
    <img src={earthB} alt="" className={`translate-icon ${isActive ? 'active' : ''}`} />
  </div>
);

const AppDropdown = ({
  value,
  onChange,
  options,
  disabled = false,
  className = '',
  placeholder = '',
  prefix = '',
  ariaLabel = '',
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((item) => item.value === value);

  useEffect(() => {
    const onDocumentMouseDown = (event) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [value]);

  return (
    <div
      ref={rootRef}
      className={`app-dropdown ${open ? 'open' : ''} ${disabled ? 'disabled' : ''} ${prefix ? 'has-prefix' : ''} ${className}`.trim()}
    >
      <button
        type="button"
        className="app-dropdown-trigger"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        aria-label={ariaLabel || prefix || placeholder}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="app-dropdown-copy">
          {prefix && <span className="app-dropdown-prefix">{prefix}</span>}
          <span className="app-dropdown-text">{selected?.label || placeholder}</span>
        </span>
        <span className="app-dropdown-chevron" aria-hidden="true"></span>
      </button>
      <div className="app-dropdown-menu" role="listbox" aria-label={ariaLabel || prefix || placeholder}>
        {options.map((item) => (
          <button
            key={`drop-${item.value}`}
            type="button"
            className={`app-dropdown-item ${item.value === value ? 'active' : ''}`}
            role="option"
            aria-selected={item.value === value}
            onClick={() => {
              if (item.value !== value) onChange(item.value);
              setOpen(false);
            }}
          >
            <span>{item.label}</span>
            {item.value === value && <span className="app-dropdown-selected-mark" aria-hidden="true">&#10003;</span>}
          </button>
        ))}
      </div>
    </div>
  );
};

const DragPreviewCard = ({ label, host, moveText }) => (
  <div className="ping-card drag-preview" aria-hidden="true">
    <div className="ping-info">
      <div className="ping-label">{label}</div>
      <div className="ping-ip">{host}</div>
    </div>
    <div className="ping-actions">
      <div className="ping-value preview-hint">{moveText}</div>
    </div>
  </div>
);

const App = () => {
  const [isDarkMode, setDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme ? savedTheme === 'dark' : true; // Default to dark if no preference saved
  });
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved ? saved === 'true' : true;
  });
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [currentPage, setCurrentPage] = useState('ping');
  const [pingIntervalMs, setPingIntervalMs] = useState(() => {
    const saved = localStorage.getItem('pingIntervalMs');
    return saved ? Number(saved) : 2000;
  });
  const [activeProfile, setActiveProfile] = useState(() => localStorage.getItem('activeProfile') || 'custom');
  const [compactMode, setCompactMode] = useState(() => localStorage.getItem('compactMode') === 'true');
  const [optimizationEnabled, setOptimizationEnabled] = useState(() => {
    const saved = localStorage.getItem('optimizationEnabled');
    return saved === 'true';
  });
  const [autoLaunch, setAutoLaunch] = useState(true);
  const [closeAction, setCloseAction] = useState(() => {
    const saved = localStorage.getItem('closeAction');
    return saved || 'ask';
  });
  const [speedStarted, setSpeedStarted] = useState(false);
  const [speedMetrics, setSpeedMetrics] = useState(null);
  const [speedLoading, setSpeedLoading] = useState(false);
  const [speedPhase, setSpeedPhase] = useState('idle');
  const [speedProvider, setSpeedProvider] = useState(() => localStorage.getItem('speedProvider') || 'cloudflare');
  const [networkSnapshot, setNetworkSnapshot] = useState(null);
  const [previousNetworkSnapshot, setPreviousNetworkSnapshot] = useState(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkUsageResetting, setNetworkUsageResetting] = useState(false);
  const [networkError, setNetworkError] = useState('');
  const [networkProcessSearch, setNetworkProcessSearch] = useState('');
  const [hoveredNetworkApplicationId, setHoveredNetworkApplicationId] = useState('');
  const [networkProcessSort, setNetworkProcessSort] = useState(() => (
    localStorage.getItem('networkProcessSort') || 'connections-desc'
  ));
  const [showAllNetworkProcesses, setShowAllNetworkProcesses] = useState(false);
  const [expandedNetworkProcesses, setExpandedNetworkProcesses] = useState({});
  const [bandwidthLimiterState, setBandwidthLimiterState] = useState({ engine: null, rules: [] });
  const [bandwidthLimitModalProcess, setBandwidthLimitModalProcess] = useState(null);
  const [bandwidthLimitForm, setBandwidthLimitForm] = useState({ download: '', upload: '', unit: 'mbps', blocked: false });
  const [bandwidthLimitSaving, setBandwidthLimitSaving] = useState(false);
  const [bandwidthLimitFeedback, setBandwidthLimitFeedback] = useState('');
  const [publicNetworkInfo, setPublicNetworkInfo] = useState({
    ip: 'N/A',
    country: 'N/A',
  });
  const [isPublicIpLoading, setIsPublicIpLoading] = useState(false);
  const [showPublicIp, setShowPublicIp] = useState(() => {
    const saved = localStorage.getItem('showPublicIp');
    return saved ? saved === 'true' : true;
  });
  const [betaUpdates, setBetaUpdates] = useState(() => {
    const saved = localStorage.getItem('betaUpdates');
    return saved === 'true';
  });
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(() => {
    const saved = localStorage.getItem('autoCheckUpdates');
    return saved ? saved === 'true' : true;
  });
  const speedRequestRef = useRef({ id: 0 });
  const speedPhaseTimersRef = useRef([]);
  const [dnsDomain, setDnsDomain] = useState('');
  const [dnsResults, setDnsResults] = useState([]);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsError, setDnsError] = useState('');
  const [dnsSearch, setDnsSearch] = useState('');
  const [dnsStatusFilter, setDnsStatusFilter] = useState('all');
  const [dnsSortKey, setDnsSortKey] = useState('latency-asc');
  const [dnsToolMode, setDnsToolMode] = useState('test');
  const [dnsBenchmarkLoading, setDnsBenchmarkLoading] = useState(false);
  const [dnsBenchmarkStats, setDnsBenchmarkStats] = useState([]);
  const [dnsBenchmarkRounds, setDnsBenchmarkRounds] = useState(() => {
    const saved = localStorage.getItem('dnsBenchmarkRounds');
    const value = saved ? Number(saved) : 3;
    return Number.isFinite(value) && value > 0 ? Math.min(value, 10) : 3;
  });
  const [customDnsInput, setCustomDnsInput] = useState('');
  const [customDnsServers, setCustomDnsServers] = useState(() => {
    const stored = localStorage.getItem('customDnsServers');
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed.map((value) => String(value).trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  });
  const [batchDomainsInput, setBatchDomainsInput] = useState(() => {
    return localStorage.getItem('dnsBatchDomainsInput') || '';
  });
  const [batchResults, setBatchResults] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [dnsAdapters, setDnsAdapters] = useState([]);
  const [dnsManagerLoading, setDnsManagerLoading] = useState(false);
  const [dnsSelectedAdapter, setDnsSelectedAdapter] = useState('');
  const [dnsPrimaryInput, setDnsPrimaryInput] = useState('');
  const [dnsSecondaryInput, setDnsSecondaryInput] = useState('');
  const [dnsManagerStatus, setDnsManagerStatus] = useState('');
  const [lastDnsBackup, setLastDnsBackup] = useState(() => {
    const stored = localStorage.getItem('lastDnsBackup');
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  });
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closeRememberChoice, setCloseRememberChoice] = useState(false);
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [firstRunOpen, setFirstRunOpen] = useState(() => localStorage.getItem('firstRunSetupDone') !== 'true');
  const scrollRef = useRef(null);
  const [isPersian, setIsPersian] = useState(() => {
    const savedLocale = localStorage.getItem('locale');
    return savedLocale ? savedLocale === 'fa' : false;
  });
  const { allHosts, setAllHosts, addHost } = useHosts();
  const [editingHost, setEditingHost] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [logEntries, setLogEntries] = useState(() => {
    const stored = localStorage.getItem('logEntries');
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [logFilter, setLogFilter] = useState('all');
  const [logSearch, setLogSearch] = useState('');
  const [logDateFilter, setLogDateFilter] = useState('all');
  const logAlertCooldownRef = useRef({});
  const copyTimerRef = useRef(0);
  const importSettingsInputRef = useRef(null);
  const [copyFeedbackKey, setCopyFeedbackKey] = useState('');
  const [activeDragId, setActiveDragId] = useState(null);
  const [showDonateNudge, setShowDonateNudge] = useState(false);
  const lastOverIdRef = useRef(null);
  const lenisRef = useRef(null);
  const publicIpFetchInFlightRef = useRef(false);
  const networkUsageInFlightRef = useRef(false);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    const donateNudgeTimer = window.setTimeout(() => {
      setShowDonateNudge(true);
    }, DONATE_NUDGE_DELAY_MS);

    return () => window.clearTimeout(donateNudgeTimer);
  }, []);

  const handleDonateClick = useCallback(() => {
    setShowDonateNudge(false);
    openUrl('https://daramet.com/SM0KE');
  }, []);

  const toggleTheme = () => {
    setDarkMode(prevMode => !prevMode);
  };

  const toggleSidebarCollapse = () => {
    setSidebarCollapsed(prev => !prev);
  };

  const toggleLocale = () => {
    setIsPersian(prev => {
      const next = !prev;
      localStorage.setItem('locale', next ? 'fa' : 'en');
      return next;
    });
  };

  const pingAlertThresholdMs = 250;
  const packetLossAlertThreshold = 30;

  const addLogEntry = useCallback((entry) => {
    setLogEntries((prev) => {
      const next = [
        {
          id: Date.now() + Math.random(),
          time: Date.now(),
          ...entry,
        },
        ...prev,
      ];
      const trimmed = next.slice(0, 200);
      localStorage.setItem('logEntries', JSON.stringify(trimmed));
      return trimmed;
    });
  }, []);

  const handleClearLogs = () => {
    localStorage.removeItem('logEntries');
    setLogEntries([]);
  };

  const clearSpeedPhaseTimers = useCallback(() => {
    speedPhaseTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    speedPhaseTimersRef.current = [];
  }, []);

  const handleCopyText = useCallback(async (text, key) => {
    const payload = String(text || '').trim();
    if (!payload) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const tempInput = document.createElement('textarea');
        tempInput.value = payload;
        tempInput.style.position = 'fixed';
        tempInput.style.opacity = '0';
        document.body.appendChild(tempInput);
        tempInput.focus();
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
      }
      setCopyFeedbackKey(key);
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopyFeedbackKey('');
      }, 1400);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  }, []);

  const loadPublicNetworkInfo = useCallback(async () => {
    if (publicIpFetchInFlightRef.current) return;
    publicIpFetchInFlightRef.current = true;
    setIsPublicIpLoading(true);
    try {
      const result = await invoke('get_public_network_info');
      const nextIp = String(result?.ip || '').trim() || 'N/A';
      const nextCountry = String(result?.country || '').trim().toUpperCase() || 'N/A';
      setPublicNetworkInfo((prev) => {
        const changed = prev.ip !== 'N/A' && nextIp !== 'N/A' && (prev.ip !== nextIp || prev.country !== nextCountry);
        if (changed) {
          const detail = `${prev.ip} (${prev.country}) → ${nextIp} (${nextCountry})`;
          addLogEntry({
            type: 'network',
            title: 'Public IP changed',
            detail,
          });
        }
        return {
          ip: nextIp,
          country: nextCountry,
        };
      });
    } catch (error) {
      console.error('Failed to load public network info:', error);
    } finally {
      publicIpFetchInFlightRef.current = false;
      setIsPublicIpLoading(false);
    }
  }, [addLogEntry]);

  const loadNetworkUsage = useCallback(async () => {
    if (networkUsageInFlightRef.current) return;
    networkUsageInFlightRef.current = true;
    setNetworkLoading(true);
    try {
      const result = await invoke('get_network_usage_snapshot');
      setNetworkSnapshot((current) => {
        const resultTimestamp = Number(result?.timestampMs || 0);
        const currentTimestamp = Number(current?.timestampMs || 0);
        if (current && resultTimestamp && currentTimestamp && resultTimestamp <= currentTimestamp) {
          return current;
        }
        if (current) {
          setPreviousNetworkSnapshot(current);
        }
        return result;
      });
      setNetworkError(result?.error || '');
    } catch (error) {
      console.error('Failed to load network usage:', error);
      setNetworkError(String(error || 'network-usage-failed'));
    } finally {
      networkUsageInFlightRef.current = false;
      setNetworkLoading(false);
    }
  }, []);

  const resetNetworkApplicationUsage = useCallback(async () => {
    if (networkUsageResetting) return;
    setNetworkUsageResetting(true);
    setNetworkError('');
    try {
      await invoke('reset_network_application_usage');
      setHoveredNetworkApplicationId('');
      setNetworkSnapshot((current) => (
        current ? { ...current, applications: [] } : current
      ));
    } catch (error) {
      console.error('Failed to reset network application usage:', error);
      setNetworkError(String(error || 'network-usage-reset-failed'));
    } finally {
      setNetworkUsageResetting(false);
    }
  }, [networkUsageResetting]);

  const loadBandwidthLimiterState = useCallback(async () => {
    try {
      const result = await invoke('get_bandwidth_limiter_state');
      setBandwidthLimiterState({
        engine: result?.engine || null,
        rules: Array.isArray(result?.rules) ? result.rules : [],
      });
    } catch (error) {
      console.error('Failed to load bandwidth limiter state:', error);
      setBandwidthLimitFeedback(String(error || 'bandwidth-limiter-state-failed'));
    }
  }, []);

  useEffect(() => {
    return () => {
      window.clearTimeout(copyTimerRef.current);
      clearSpeedPhaseTimers();
    };
  }, [clearSpeedPhaseTimers]);

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove('light-theme');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.classList.add('light-theme');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    const loadVersion = async () => {
      try {
        const version = await invoke('get_app_version');
        setAppVersion(version);
      } catch (error) {
        console.error('Failed to load app version:', error);
      }
    };
    loadVersion();
  }, []);

  useEffect(() => {
    const loadAutoLaunch = async () => {
      try {
        const enabled = await invoke('get_auto_launch');
        setAutoLaunch(Boolean(enabled));
      } catch (error) {
        console.error('Failed to load auto-launch setting:', error);
      }
    };
    loadAutoLaunch();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('closeAction');
    if (saved) {
      setCloseAction(saved);
      invoke('set_close_action', { action: saved }).catch(() => {});
      return;
    }
    const loadCloseAction = async () => {
      try {
        const action = await invoke('get_close_action');
        if (action) {
          setCloseAction(action);
        }
      } catch (error) {
        console.error('Failed to load close action:', error);
      }
    };
    loadCloseAction();
  }, []);

  useEffect(() => {
    localStorage.setItem('closeAction', closeAction);
    invoke('set_close_action', { action: closeAction }).catch(() => {});
  }, [closeAction]);

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem('activeProfile', activeProfile);
  }, [activeProfile]);

  useEffect(() => {
    localStorage.setItem('compactMode', String(compactMode));
    document.body.classList.toggle('compact-mode', compactMode);
    return () => document.body.classList.remove('compact-mode');
  }, [compactMode]);

  useEffect(() => {
    localStorage.setItem('speedProvider', speedProvider);
  }, [speedProvider]);

  useEffect(() => {
    localStorage.setItem('showPublicIp', String(showPublicIp));
  }, [showPublicIp]);

  useEffect(() => {
    localStorage.setItem('betaUpdates', String(betaUpdates));
  }, [betaUpdates]);

  useEffect(() => {
    localStorage.setItem('autoCheckUpdates', String(autoCheckUpdates));
  }, [autoCheckUpdates]);

  useEffect(() => {
    localStorage.setItem('dnsBatchDomainsInput', batchDomainsInput);
  }, [batchDomainsInput]);

  useEffect(() => {
    localStorage.setItem('dnsBenchmarkRounds', String(dnsBenchmarkRounds));
  }, [dnsBenchmarkRounds]);

  useEffect(() => {
    localStorage.setItem('customDnsServers', JSON.stringify(customDnsServers));
  }, [customDnsServers]);

  useEffect(() => {
    const savedName = localStorage.getItem('displayName');
    if (savedName) {
      setDisplayName(savedName);
      setNameInput(savedName);
      return;
    }
    const loadUsername = async () => {
      try {
        const username = await invoke('get_username');
        setDisplayName(username);
        setNameInput(username);
      } catch (error) {
        console.error('Failed to load username:', error);
      }
    };
    loadUsername();
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      await loadPublicNetworkInfo();
    };

    load();
    const intervalId = window.setInterval(() => {
      if (!active) return;
      load();
    }, 300000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [loadPublicNetworkInfo]);

  useEffect(() => {
    loadBandwidthLimiterState();
  }, [loadBandwidthLimiterState]);

  useEffect(() => {
    if (currentPage !== 'network') return undefined;
    loadNetworkUsage();
    const intervalId = window.setInterval(loadNetworkUsage, 1000);
    return () => window.clearInterval(intervalId);
  }, [currentPage, loadNetworkUsage]);

  useEffect(() => {
    const nextIp = String(speedMetrics?.ip || '').trim();
    const nextCountry = String(speedMetrics?.country || '').trim().toUpperCase();
    if (!nextIp || nextIp === 'N/A') return;
    setPublicNetworkInfo((prev) => ({
      ip: nextIp,
      country: nextCountry || prev.country || 'N/A',
    }));
  }, [speedMetrics]);

  const handleEditName = () => {
    setIsEditingName(true);
  };

  const handleSaveName = () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setDisplayName(trimmed);
    localStorage.setItem('displayName', trimmed);
    setIsEditingName(false);
  };

  const handleCancelName = () => {
    setNameInput(displayName);
    setIsEditingName(false);
  };

  const applyProfile = useCallback((profileKey) => {
    const profileHosts = HOST_PROFILES[profileKey] || DEFAULT_HOSTS;
    const nextHosts = profileHosts.map((host, index) => ({
      ...host,
      id: host.type === 'custom' ? `${Date.now()}-${index}` : host.id,
      pinned: false,
      paused: false,
    }));
    setAllHosts(nextHosts);
    setActiveProfile(profileKey);
    localStorage.setItem('allHosts', JSON.stringify(nextHosts));
    addLogEntry({
      type: 'action',
      title: 'Profile applied',
      detail: profileKey,
    });
  }, [addLogEntry, setAllHosts]);

  const handleFirstRunProfile = (profileKey) => {
    applyProfile(profileKey);
    localStorage.setItem('firstRunSetupDone', 'true');
    setFirstRunOpen(false);
  };

  const sanitizeDomain = (input) => {
    return String(input || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .split('?')[0]
      .split('#')[0];
  };

  const normalizeDnsServer = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return trimmed;
  };

  const isValidDnsServer = (value) => {
    const normalized = normalizeDnsServer(value);
    if (!normalized) return false;
    const ipv4 = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
    const ipv6 = /^([0-9a-fA-F]{1,4}:){1,7}[0-9a-fA-F]{1,4}$/;
    return ipv4.test(normalized) || ipv6.test(normalized);
  };

  const handleAddCustomDns = () => {
    const normalized = normalizeDnsServer(customDnsInput);
    if (!isValidDnsServer(normalized)) {
      setDnsError(texts.dnsCustomInvalid);
      return;
    }
    setDnsError('');
    setCustomDnsServers((prev) => {
      if (prev.includes(normalized)) return prev;
      return [...prev, normalized];
    });
    setCustomDnsInput('');
  };

  const handleRemoveCustomDns = (serverToRemove) => {
    setCustomDnsServers((prev) => prev.filter((server) => server !== serverToRemove));
  };

  const runDnsCheck = async (domain) => {
    const sanitized = sanitizeDomain(domain);
    if (!sanitized) {
      return { domain: '', results: [], error: 'invalid' };
    }
    try {
      const response = await invoke('test_dns_servers_with_custom', {
        domain: sanitized,
        customServers: customDnsServers,
      });
      if (response && !response.error) {
        return { domain: sanitized, results: response.results || [], error: null };
      }
      return { domain: sanitized, results: [], error: response?.error || 'failed' };
    } catch {
      return { domain: sanitized, results: [], error: 'failed' };
    }
  };

  const handleDnsTest = async () => {
    if (dnsLoading || dnsBenchmarkLoading || batchLoading) return;
    const sanitized = sanitizeDomain(dnsDomain);
    if (!sanitized) {
      setDnsError(texts.dnsInvalid);
      return;
    }
    setDnsError('');
    setDnsLoading(true);
    setDnsBenchmarkStats([]);
    setDnsResults([]);
    try {
      const response = await runDnsCheck(sanitized);
      if (response.error) {
        setDnsError(texts.dnsInvalid);
        addLogEntry({
          type: 'dns',
          title: texts.logDnsFailed,
          detail: sanitized,
        });
      } else {
        setDnsResults(response.results);
        const usableCount = response.results.filter((item) => item.status).length;
        const blockedCount = response.results.filter((item) => !item.status).length;
        addLogEntry({
          type: 'dns',
          title: texts.logDnsResult,
          detail: `${sanitized} • ${texts.usable} ${usableCount} / ${texts.blocked} ${blockedCount}`,
        });
      }
    } catch (error) {
      console.error('DNS test failed:', error);
      setDnsError(texts.dnsFailed);
      addLogEntry({
        type: 'dns',
        title: texts.logDnsFailed,
        detail: sanitized,
      });
    } finally {
      setDnsLoading(false);
    }
  };

  const handleDnsBenchmark = async () => {
    if (dnsLoading || dnsBenchmarkLoading || batchLoading) return;
    const sanitized = sanitizeDomain(dnsDomain);
    if (!sanitized) {
      setDnsError(texts.dnsInvalid);
      return;
    }
    const rounds = Math.max(1, Math.min(10, Number(dnsBenchmarkRounds) || 3));
    setDnsError('');
    setDnsBenchmarkLoading(true);
    setDnsBenchmarkStats([]);
    try {
      const statsMap = new Map();
      for (let i = 0; i < rounds; i += 1) {
        const response = await runDnsCheck(sanitized);
        if (response.error) {
          throw new Error('dns-benchmark-failed');
        }
        for (const item of response.results) {
          const existing = statsMap.get(item.server) || { server: item.server, ok: 0, total: 0, totalMs: 0 };
          existing.total += 1;
          if (item.status) {
            existing.ok += 1;
            existing.totalMs += Number(item.responseTimeMs) || 0;
          }
          statsMap.set(item.server, existing);
        }
        if (i === rounds - 1) {
          setDnsResults(response.results);
        }
      }
      const stats = Array.from(statsMap.values())
        .map((item) => {
          const averageMs = item.ok > 0 ? item.totalMs / item.ok : Number.POSITIVE_INFINITY;
          return {
            server: item.server,
            averageMs,
            successRate: Math.round((item.ok / item.total) * 100),
          };
        })
        .sort((a, b) => a.averageMs - b.averageMs);
      setDnsBenchmarkStats(stats);
      const fastest = stats.filter((item) => Number.isFinite(item.averageMs)).slice(0, 3);
      const fastestText = fastest
        .map((item) => `${item.server} ${Math.round(item.averageMs)}ms`)
        .join(' | ');
      addLogEntry({
        type: 'dns',
        title: texts.logDnsBenchmark,
        detail: `${sanitized} • ${rounds}x • ${fastestText || texts.failed}`,
      });
    } catch (error) {
      console.error('DNS benchmark failed:', error);
      setDnsError(texts.dnsBenchmarkFailed);
      addLogEntry({
        type: 'dns',
        title: texts.logDnsFailed,
        detail: `${sanitized} • ${texts.dnsBenchmarkFailed}`,
      });
    } finally {
      setDnsBenchmarkLoading(false);
    }
  };

  const handleBatchDomains = async () => {
    if (dnsLoading || dnsBenchmarkLoading || batchLoading) return;
    const domains = batchDomainsInput
      .split(/\r?\n/)
      .map((value) => sanitizeDomain(value))
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .slice(0, 30);
    if (domains.length === 0) {
      setDnsError(texts.dnsBatchInvalid);
      return;
    }
    setDnsError('');
    setBatchLoading(true);
    setBatchResults([]);
    try {
      const results = [];
      for (const domain of domains) {
        const response = await runDnsCheck(domain);
        const usableCount = response.results.filter((item) => item.status).length;
        const blockedCount = response.results.length - usableCount;
        results.push({
          domain,
          status: usableCount > 0 ? 'resolved' : 'unresolved',
          usableCount,
          blockedCount,
        });
      }
      setBatchResults(results);
      const resolvedCount = results.filter((item) => item.status === 'resolved').length;
      addLogEntry({
        type: 'dns',
        title: texts.logDomainBatch,
        detail: `${results.length} domains • ${texts.dnsResolved} ${resolvedCount}`,
      });
    } catch (error) {
      console.error('Batch DNS check failed:', error);
      setDnsError(texts.dnsBatchFailed);
      addLogEntry({
        type: 'dns',
        title: texts.logDnsFailed,
        detail: texts.dnsBatchFailed,
      });
    } finally {
      setBatchLoading(false);
    }
  };

  const loadDnsAdapters = useCallback(async (forceRefresh = false) => {
    try {
      const adapters = await invoke('list_dns_adapters', { forceRefresh });
      const normalized = Array.isArray(adapters) ? adapters : [];
      setDnsAdapters(normalized);
      if (normalized.length === 0) {
        setDnsSelectedAdapter('');
        setDnsPrimaryInput('');
        setDnsSecondaryInput('');
        return;
      }
      setDnsSelectedAdapter((current) => {
        const exists = normalized.some((item) => getDnsAdapterKey(item) === current);
        const selectedName = exists ? current : getDnsAdapterKey(normalized[0]);
        const selected = normalized.find((item) => getDnsAdapterKey(item) === selectedName);
        if (selected) {
          setDnsPrimaryInput(selected.dns?.[0] || '');
          setDnsSecondaryInput(selected.dns?.[1] || '');
        }
        return selectedName;
      });
    } catch (error) {
      console.error('Failed to load dns adapters:', error);
      setDnsAdapters([]);
    }
  }, []);

  const handleApplySystemDns = async () => {
    if (!dnsSelectedAdapter || !isValidDnsServer(dnsPrimaryInput)) {
      setDnsManagerStatus(texts.dnsCustomInvalid);
      return;
    }
    if (dnsSecondaryInput.trim() && !isValidDnsServer(dnsSecondaryInput)) {
      setDnsManagerStatus(texts.dnsCustomInvalid);
      return;
    }
    setDnsManagerLoading(true);
    setDnsManagerStatus('');
    try {
      const backup = dnsAdapters.find((item) => getDnsAdapterKey(item) === dnsSelectedAdapter);
      const adapterLabel = backup?.name || dnsSelectedAdapter;
      if (backup) {
        const nextBackup = { adapterName: getDnsAdapterKey(backup), adapterLabel: backup.name, dns: backup.dns || [] };
        setLastDnsBackup(nextBackup);
        localStorage.setItem('lastDnsBackup', JSON.stringify(nextBackup));
      }
      const result = await invoke('set_adapter_dns', {
        adapterName: dnsSelectedAdapter,
        primaryDns: dnsPrimaryInput.trim(),
        secondaryDns: dnsSecondaryInput.trim() || null,
      });
      if (result && result.success) {
        setDnsManagerStatus(texts.dnsManagerApplied);
        addLogEntry({
          type: 'dns',
          title: texts.logDnsResult,
          detail: `${adapterLabel} • ${dnsPrimaryInput.trim()}${dnsSecondaryInput.trim() ? `, ${dnsSecondaryInput.trim()}` : ''}`,
        });
        await loadDnsAdapters(true);
      } else {
        setDnsManagerStatus(result?.error || texts.dnsManagerFailed);
      }
    } catch (error) {
      console.error('Failed to apply system dns:', error);
      setDnsManagerStatus(texts.dnsManagerFailed);
    } finally {
      setDnsManagerLoading(false);
    }
  };

  const handleApplyRecommendedDns = async () => {
    if (!dnsRecommendation?.primary) {
      setDnsManagerStatus(texts.dnsRecommendationEmpty);
      return;
    }
    if (!dnsSelectedAdapter) {
      setDnsToolMode('manager');
      setDnsManagerStatus(texts.dnsManagerNoAdapters);
      return;
    }
    setDnsPrimaryInput(dnsRecommendation.primary.server);
    setDnsSecondaryInput(dnsRecommendation.secondary?.server || '');
    setDnsManagerLoading(true);
    setDnsManagerStatus('');
    try {
      const backup = dnsAdapters.find((item) => getDnsAdapterKey(item) === dnsSelectedAdapter);
      const adapterLabel = backup?.name || dnsSelectedAdapter;
      if (backup) {
        const nextBackup = { adapterName: getDnsAdapterKey(backup), adapterLabel: backup.name, dns: backup.dns || [] };
        setLastDnsBackup(nextBackup);
        localStorage.setItem('lastDnsBackup', JSON.stringify(nextBackup));
      }
      const result = await invoke('set_adapter_dns', {
        adapterName: dnsSelectedAdapter,
        primaryDns: dnsRecommendation.primary.server,
        secondaryDns: dnsRecommendation.secondary?.server || null,
      });
      if (result && result.success) {
        setDnsManagerStatus(texts.dnsManagerApplied);
        addLogEntry({
          type: 'dns',
          title: texts.logDnsResult,
          detail: `${adapterLabel} • ${dnsRecommendation.primary.server}${dnsRecommendation.secondary ? `, ${dnsRecommendation.secondary.server}` : ''}`,
        });
        await loadDnsAdapters(true);
      } else {
        setDnsManagerStatus(result?.error || texts.dnsManagerFailed);
      }
    } catch (error) {
      console.error('Failed to apply recommended dns:', error);
      setDnsManagerStatus(texts.dnsManagerFailed);
    } finally {
      setDnsManagerLoading(false);
    }
  };

  const handleRollbackDns = async () => {
    if (!lastDnsBackup?.adapterName) return;
    setDnsSelectedAdapter(lastDnsBackup.adapterName);
    setDnsManagerLoading(true);
    setDnsManagerStatus('');
    try {
      let result;
      if (lastDnsBackup.dns?.[0]) {
        result = await invoke('set_adapter_dns', {
          adapterName: lastDnsBackup.adapterName,
          primaryDns: lastDnsBackup.dns[0],
          secondaryDns: lastDnsBackup.dns[1] || null,
        });
      } else {
        result = await invoke('reset_adapter_dns', { adapterName: lastDnsBackup.adapterName });
      }
      if (result && result.success) {
        setDnsManagerStatus(texts.dnsRollbackDone);
        localStorage.removeItem('lastDnsBackup');
        setLastDnsBackup(null);
        await loadDnsAdapters(true);
      } else {
        setDnsManagerStatus(result?.error || texts.dnsManagerFailed);
      }
    } catch (error) {
      console.error('Failed to rollback dns:', error);
      setDnsManagerStatus(texts.dnsManagerFailed);
    } finally {
      setDnsManagerLoading(false);
    }
  };

  const handleResetSystemDns = async () => {
    if (!dnsSelectedAdapter) return;
    setDnsManagerLoading(true);
    setDnsManagerStatus('');
    try {
      const result = await invoke('reset_adapter_dns', { adapterName: dnsSelectedAdapter });
      if (result && result.success) {
        setDnsManagerStatus(texts.dnsManagerResetDone);
        const adapterLabel = selectedAdapterDetails?.name || dnsSelectedAdapter;
        addLogEntry({
          type: 'dns',
          title: texts.logDnsResult,
          detail: `${adapterLabel} • DHCP`,
        });
        await loadDnsAdapters(true);
      } else {
        setDnsManagerStatus(result?.error || texts.dnsManagerFailed);
      }
    } catch (error) {
      console.error('Failed to reset system dns:', error);
      setDnsManagerStatus(texts.dnsManagerFailed);
    } finally {
      setDnsManagerLoading(false);
    }
  };

  const handleStartSpeed = () => {
    clearSpeedPhaseTimers();
    speedRequestRef.current.id += 1;
    const requestId = speedRequestRef.current.id;
    setSpeedStarted(false);
    setSpeedMetrics(null);
    setSpeedLoading(true);
    setSpeedPhase('download');
    speedPhaseTimersRef.current.push(window.setTimeout(() => {
      if (requestId === speedRequestRef.current.id) {
        setSpeedPhase('upload');
      }
    }, SPEED_PHASE_DOWNLOAD_DELAY_MS));
    const command = speedProvider === 'hetzner' ? 'speedtest_hetzner' : 'speedtest_cloudflare';
    invoke(command)
      .then((result) => {
        if (requestId !== speedRequestRef.current.id) return;
        if (result && !result.error) {
          setSpeedMetrics(result);
          setSpeedStarted(true);
          setSpeedPhase('final');
          const countryName = getCountryName(result.country);
          const countryPart = countryName ? ` • ${countryName}` : '';
          addLogEntry({
            type: 'speed',
            title: texts.logSpeedComplete,
            detail: `${texts.speedDownload}: ${result.downloadMbps} Mbps • ${texts.speedUpload}: ${result.uploadMbps} Mbps • ${texts.speedLatency}: ${result.latencyMs} ms${countryPart}`,
          });
          return;
        }
        setSpeedPhase('idle');
      })
      .catch((error) => {
        console.error('Speed test failed:', error);
        setSpeedPhase('idle');
      })
      .finally(() => {
        if (requestId === speedRequestRef.current.id) {
          setSpeedLoading(false);
          clearSpeedPhaseTimers();
        }
      });
  };

  const handleStopSpeed = () => {
    clearSpeedPhaseTimers();
    speedRequestRef.current.id += 1;
    setSpeedLoading(false);
    setSpeedStarted(false);
    setSpeedMetrics(null);
    setSpeedPhase('idle');
  };

  const handleToggleAutoLaunch = async () => {
    const next = !autoLaunch;
    setAutoLaunch(next);
    try {
      const updated = await invoke('set_auto_launch', { enabled: next });
      setAutoLaunch(Boolean(updated));
    } catch (error) {
      console.error('Failed to update auto-launch:', error);
      setAutoLaunch(!next);
    }
  };

  const requestCloseFlow = useCallback(() => {
    if (closeAction !== 'ask') {
      invoke('perform_close_action', { action: closeAction });
      return;
    }
    setCloseRememberChoice(false);
    setCloseModalOpen(true);
  }, [closeAction]);

  const handleCloseChoice = (action) => {
    if (closeRememberChoice) {
      setCloseAction(action);
    }
    setCloseModalOpen(false);
    invoke('perform_close_action', { action });
  };

  const runUpdateCheck = useCallback(async ({ manual = false } = {}) => {
    if (manual) {
      setUpdateStatus(texts.updateChecking);
    }
    try {
      const result = await invoke('check_for_updates', { includePrerelease: betaUpdates });
      if (result && result.error) {
        if (manual) {
          setUpdateStatus(texts.updateFailed);
        }
        return;
      }
      if (result && result.updateAvailable) {
        setUpdateInfo(result);
        setUpdateModalOpen(true);
        setUpdateStatus('');
        return;
      }
      if (manual) {
        setUpdateStatus(texts.updateUpToDate);
      }
    } catch (error) {
      console.error('Failed to check updates:', error);
      if (manual) {
        setUpdateStatus(texts.updateFailed);
      }
    }
  }, [betaUpdates, isPersian]);

  const handleCheckUpdates = () => {
    runUpdateCheck({ manual: true });
  };

  useEffect(() => {
    if (!autoCheckUpdates || !appVersion) return undefined;
    const lastCheckedAt = Number(localStorage.getItem('lastAutoUpdateCheckAt') || 0);
    const now = Date.now();
    if (Number.isFinite(lastCheckedAt) && now - lastCheckedAt < 24 * 60 * 60 * 1000) {
      return undefined;
    }
    const timerId = window.setTimeout(() => {
      localStorage.setItem('lastAutoUpdateCheckAt', String(Date.now()));
      runUpdateCheck({ manual: false });
    }, 4000);
    return () => window.clearTimeout(timerId);
  }, [appVersion, autoCheckUpdates, runUpdateCheck]);

  const handleUpdateDownload = async () => {
    if (!updateInfo || !updateInfo.url) {
      setUpdateModalOpen(false);
      return;
    }
    try {
      await openUrl(updateInfo.url);
    } catch (error) {
      console.error('Failed to open update URL:', error);
    } finally {
      setUpdateModalOpen(false);
    }
  };

  const handleUpdateDismiss = () => {
    setUpdateModalOpen(false);
  };

  const handlePingIntervalChange = (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value) || value <= 0) return;
    setPingIntervalMs(value);
    localStorage.setItem('pingIntervalMs', String(value));
  };

  const handleToggleOptimization = (event) => {
    const next = Boolean(event.target.checked);
    setOptimizationEnabled(next);
    localStorage.setItem('optimizationEnabled', String(next));
  };

  const handleBenchmarkRoundsChange = (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value) || value <= 0) return;
    setDnsBenchmarkRounds(Math.min(10, Math.max(1, value)));
  };

  useEffect(() => {
    if (currentPage !== 'speed') {
      handleStopSpeed();
    }
  }, [currentPage]);

  useEffect(() => {
    if (currentPage === 'dns' && dnsToolMode === 'manager') {
      loadDnsAdapters(false);
    }
  }, [currentPage, dnsToolMode, loadDnsAdapters]);

  useEffect(() => {
    setDnsBenchmarkStats([]);
  }, [dnsDomain]);

  const usableDns = dnsResults.filter((item) => item.status);
  const blockedDns = dnsResults.filter((item) => !item.status);
  const dnsTableRows = useMemo(() => {
    const query = dnsSearch.trim().toLowerCase();
    let rows = dnsResults.map((item) => {
      const numericLatency = Number(item.responseTimeMs);
      return {
        ...item,
        latencyMs: Number.isFinite(numericLatency) ? numericLatency : null,
        statusKey: item.status ? 'usable' : 'blocked',
      };
    });

    if (dnsStatusFilter !== 'all') {
      rows = rows.filter((item) => item.statusKey === dnsStatusFilter);
    }

    if (query) {
      rows = rows.filter((item) => String(item.server || '').toLowerCase().includes(query));
    }

    const [sortBy = 'latency', sortDir = 'asc'] = String(dnsSortKey || 'latency-asc').split('-');
    rows.sort((a, b) => {
      if (sortBy === 'server') {
        return String(a.server || '').localeCompare(String(b.server || ''), undefined, { sensitivity: 'base' });
      }
      if (sortBy === 'status') {
        const orderA = a.statusKey === 'usable' ? 0 : 1;
        const orderB = b.statusKey === 'usable' ? 0 : 1;
        return orderA - orderB;
      }
      const latencyA = Number.isFinite(a.latencyMs) ? a.latencyMs : Number.POSITIVE_INFINITY;
      const latencyB = Number.isFinite(b.latencyMs) ? b.latencyMs : Number.POSITIVE_INFINITY;
      return latencyA - latencyB;
    });

    if (sortDir === 'desc') {
      rows.reverse();
    }

    return rows;
  }, [dnsResults, dnsSearch, dnsSortKey, dnsStatusFilter]);

  const topFastestDns = dnsBenchmarkStats
    .filter((item) => Number.isFinite(item.averageMs))
    .slice(0, 3);

  const dnsRecommendation = useMemo(() => {
    const source = dnsBenchmarkStats.length
      ? dnsBenchmarkStats
      : dnsResults.map((item) => ({
          server: item.server,
          averageMs: item.status ? Number(item.responseTimeMs) : Number.POSITIVE_INFINITY,
          successRate: item.status ? 100 : 0,
        }));
    const usable = source
      .filter((item) => Number.isFinite(item.averageMs) && item.successRate >= 80)
      .sort((a, b) => a.averageMs - b.averageMs);
    if (!usable.length) return null;
    return {
      primary: usable[0],
      secondary: usable.find((item) => item.server !== usable[0].server) || null,
    };
  }, [dnsBenchmarkStats, dnsResults]);

  const selectedAdapterDetails = useMemo(() => {
    return dnsAdapters.find((adapter) => getDnsAdapterKey(adapter) === dnsSelectedAdapter) || null;
  }, [dnsAdapters, dnsSelectedAdapter]);

  const getInitials = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return 'U';
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  };

  const getCountryName = useCallback((countryCode) => {
    if (!countryCode || countryCode.length !== 2) return '';
    try {
      const display = new Intl.DisplayNames([isPersian ? 'fa-IR' : 'en-US'], {
        type: 'region',
      });
      return display.of(countryCode.toUpperCase()) || '';
    } catch {
      return '';
    }
  }, [isPersian]);

  const getFlagClass = (countryCode) => {
    if (!countryCode || countryCode.length !== 2) return '';
    const lower = countryCode.toLowerCase();
    if (!/^[a-z]{2}$/.test(lower)) return '';
    return `fi fi-${lower}`;
  };

  const isIran = (countryCode) => countryCode && countryCode.toUpperCase() === 'IR';
  const publicIpFlagClass = getFlagClass(publicNetworkInfo.country);
  const visiblePublicIp = showPublicIp ? publicNetworkInfo.ip : maskIpAddress(publicNetworkInfo.ip);

  useEffect(() => {
    const minimizeBtn = document.getElementById('minimize-button');
    const maximizeBtn = document.getElementById('maximize-button');
    const closeBtn = document.getElementById('close-button');
    const githubBtn = document.getElementById('github-button');
    const handleMinimize = () => invoke('perform_close_action', { action: 'minimize' });
    const handleMaximize = () => {
      invoke('toggle_window_maximize')
        .then((maximized) => setIsWindowMaximized(Boolean(maximized)))
        .catch(() => {});
    };
    const handleClose = () => requestCloseFlow();
    const handleGithub = () => openUrl('https://github.com/SM8KE1/PulseNet');

    minimizeBtn.addEventListener('click', handleMinimize);
    maximizeBtn.addEventListener('click', handleMaximize);
    closeBtn.addEventListener('click', handleClose);
    githubBtn.addEventListener('click', handleGithub);

    return () => {
      minimizeBtn.removeEventListener('click', handleMinimize);
      maximizeBtn.removeEventListener('click', handleMaximize);
      closeBtn.removeEventListener('click', handleClose);
      githubBtn.removeEventListener('click', handleGithub);
    };
  }, [requestCloseFlow]);

  useEffect(() => {
    let unlistenMaximized;

    invoke('is_window_maximized')
      .then((maximized) => setIsWindowMaximized(Boolean(maximized)))
      .catch(() => {});

    listen('window-maximized-changed', (event) => {
      setIsWindowMaximized(Boolean(event.payload));
    })
      .then((unlisten) => {
        unlistenMaximized = unlisten;
      })
      .catch(() => {});

    return () => {
      if (unlistenMaximized) unlistenMaximized();
    };
  }, []);

  useEffect(() => {
    const shown = localStorage.getItem('adminNoticeShown');
    if (!shown) {
      setAdminModalOpen(true);
    }
  }, []);

  const handleAdminNoticeClose = () => {
    localStorage.setItem('adminNoticeShown', 'true');
    setAdminModalOpen(false);
  };

  useEffect(() => {
    if (!scrollRef.current) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const wrapper = scrollRef.current;
    const content = wrapper.querySelector('.lenis-content');
    if (!content) return undefined;

    const lenis = new Lenis({
      wrapper,
      content,
      duration: 1.1,
      wheelMultiplier: 0.86,
      smoothWheel: true,
      smoothTouch: false,
      easing: (t) => 1 - Math.pow(1 - t, 3),
    });
    lenisRef.current = lenis;

    let rafId = 0;
    const raf = (time) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
      if (lenisRef.current === lenis) {
        lenisRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const lenis = lenisRef.current;
    if (!lenis) return;
    if (Boolean(activeDragId)) {
      lenis.stop();
    } else {
      lenis.start();
    }
  }, [activeDragId]);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      if (lenisRef.current) {
        lenisRef.current.scrollTo(0, { immediate: true, force: true });
      }
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [currentPage]);

  useEffect(() => {
    let unlistenClose;
    let unlistenTray;
    listen('close-requested', (event) => {
      const payload = event && event.payload ? event.payload : null;
      if (payload && payload.reason === 'exit') return;
      requestCloseFlow();
    }).then((fn) => {
      unlistenClose = fn;
    });
    listen('tray-open-page', (event) => {
      const payload = event && event.payload ? event.payload : null;
      const page = payload && payload.page ? payload.page : null;
      if (page === 'settings') {
        setCurrentPage('settings');
      }
    }).then((fn) => {
      unlistenTray = fn;
    });
    return () => {
      if (typeof unlistenClose === 'function') {
        unlistenClose();
      }
      if (typeof unlistenTray === 'function') {
        unlistenTray();
      }
    };
  }, [requestCloseFlow]);


  const getHostKey = useCallback((host) => {
    return host.type === 'custom'
      ? `custom-${host.id}`
      : `default-${host.label}-${host.host}`;
  }, []);

  const handleAddNewHost = () => {
    setEditingHost({ id: 'temp', label: '', host: '' });
  };

  const handleSaveHost = (label, host) => {
    if (editingHost && editingHost.id === 'temp') {
      addHost({ label, host });
      setEditingHost(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingHost(null);
  };

  const handleDeleteHost = (hostToDelete) => {
    const updatedHosts = allHosts.filter(host => {
      if (host.type === 'custom') {
        return host.id !== hostToDelete.id;
      } else {
        return !(host.label === hostToDelete.label && host.host === hostToDelete.host);
      }
    });
    setAllHosts(updatedHosts);
    localStorage.setItem('allHosts', JSON.stringify(updatedHosts));
  };

  const updateHostById = useCallback((hostId, updater) => {
    setAllHosts((prevHosts) => {
      const nextHosts = prevHosts.map((item) => {
        if (getHostKey(item) !== hostId) return item;
        return updater(item);
      });
      localStorage.setItem('allHosts', JSON.stringify(nextHosts));
      return nextHosts;
    });
  }, [getHostKey, setAllHosts]);

  const handleToggleHostPin = useCallback((hostId) => {
    setAllHosts((prevHosts) => {
      const sourceIndex = prevHosts.findIndex((item) => getHostKey(item) === hostId);
      if (sourceIndex === -1) return prevHosts;
      const source = prevHosts[sourceIndex];
      const nextPinned = !Boolean(source.pinned);
      const updated = { ...source, pinned: nextPinned };
      const rest = prevHosts.filter((_, index) => index !== sourceIndex);
      const nextHosts = nextPinned ? [updated, ...rest] : [...rest.slice(0, sourceIndex), updated, ...rest.slice(sourceIndex)];
      localStorage.setItem('allHosts', JSON.stringify(nextHosts));
      return nextHosts;
    });
  }, [getHostKey, setAllHosts]);

  const handleToggleHostPause = useCallback((hostId) => {
    updateHostById(hostId, (item) => ({
      ...item,
      paused: !Boolean(item.paused),
    }));
  }, [updateHostById]);

  const hostItems = useMemo(() => {
    return allHosts.map((host) => ({
      host,
      id: getHostKey(host),
    }));
  }, [allHosts, getHostKey]);

  const setDraggingClass = useCallback((isDragging) => {
    document.body.classList.toggle('dragging-host-card', isDragging);
  }, []);

  const clearDragState = useCallback(() => {
    setActiveDragId(null);
    lastOverIdRef.current = null;
    setDraggingClass(false);
  }, [setDraggingClass]);

  const moveHostByIds = useCallback((activeId, overId) => {
    setAllHosts((prevHosts) => {
      const oldIndex = prevHosts.findIndex((host) => getHostKey(host) === activeId);
      const newIndex = prevHosts.findIndex((host) => getHostKey(host) === overId);

      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        return prevHosts;
      }

      const nextOrder = arrayMove(prevHosts, oldIndex, newIndex);
      localStorage.setItem('allHosts', JSON.stringify(nextOrder));
      return nextOrder;
    });
  }, [getHostKey, setAllHosts]);

  const handleDragStart = useCallback((event) => {
    const { active } = event;
    const activeId = active?.id ?? null;
    setActiveDragId(activeId);
    lastOverIdRef.current = activeId;
    setDraggingClass(Boolean(activeId));
  }, [setDraggingClass]);

  const handleDragOver = useCallback((event) => {
    const { over } = event;
    if (over?.id) {
      lastOverIdRef.current = over.id;
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    clearDragState();
  }, [clearDragState]);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    const activeId = active?.id;
    const fallbackOverId = over?.id ?? lastOverIdRef.current;

    if (!activeId || !fallbackOverId || activeId === fallbackOverId) {
      clearDragState();
      return;
    }

    moveHostByIds(activeId, fallbackOverId);
    clearDragState();
  }, [clearDragState, moveHostByIds]);

  const activeDragHost = useMemo(() => {
    if (!activeDragId) return null;
    return hostItems.find((item) => item.id === activeDragId)?.host || null;
  }, [activeDragId, hostItems]);

  const isSortingHosts = Boolean(activeDragId);

  useEffect(() => {
    return () => {
      setDraggingClass(false);
    };
  }, [setDraggingClass]);

  const texts = useMemo(() => {
    const en = {
      platform: 'Platform',
      ping: 'Ping',
      dnsChecker: 'DNS Checker',
      dnsToolTest: 'DNS Test',
      dnsToolManager: 'DNS Manager',
      speedTest: 'Speed Test',
      networkUsage: 'Network Usage',
      networkMonitorSubtitle: 'Live adapter traffic and active network processes',
      networkDownloadLive: 'Download now',
      networkUploadLive: 'Upload now',
      networkTotalReceived: 'Total received',
      networkTotalSent: 'Total sent',
      networkAdapters: 'Adapters',
      networkProcesses: 'Active processes',
      networkRefresh: 'Refresh',
      networkRefreshing: 'Refreshing...',
      networkNoAdapters: 'No adapter data',
      networkNoProcesses: 'No active process data',
      networkProcess: 'Process',
      networkPid: 'PID',
      networkConnections: 'Connections',
      networkRemote: 'Remote',
      networkPath: 'Path',
      networkSearchProcesses: 'Search process or remote IP...',
      networkSortBy: 'Sort',
      networkSortMostConnections: 'Most connections',
      networkSortFewestConnections: 'Fewest connections',
      networkSortLimitedFirst: 'Limited first',
      networkSortNameAsc: 'Name A-Z',
      networkSortNameDesc: 'Name Z-A',
      networkAppDownloadTitle: 'App download share',
      networkAppDownloadSubtitle: 'Tracked TCP downloads by application',
      networkAppDownloadEmpty: 'No tracked app download data yet',
      networkAppDownloadOther: 'Other apps',
      networkAppDownloadTracked: 'Tracked total',
      networkAppDownloadReset: 'Reset download history',
      networkCategoryMain: 'Applications',
      networkCategoryBrowsers: 'Browsers',
      networkCategoryApps: 'Apps',
      networkCategorySystem: 'System',
      networkCategoryUnknown: 'Unknown',
      networkStatusHigh: 'High activity',
      networkStatusNormal: 'Normal',
      networkStatusIdle: 'Idle',
      networkGroupedPids: 'Grouped PIDs',
      networkDetails: 'Details',
      networkHideDetails: 'Hide',
      networkShowMoreProcesses: 'Show more',
      networkShowLessProcesses: 'Show less',
      networkNoProcessMatches: 'No matching processes',
      networkUnavailable: 'Network usage data is not available.',
      networkLinuxProcessNote: 'Per-process usage is currently available on Windows. Linux shows total adapter traffic in this version.',
      limiterTitle: 'Bandwidth limit',
      limiterSetLimit: 'Set limit',
      limiterEditLimit: 'Edit limit',
      limiterActive: 'Limited',
      limiterStaged: 'Staged',
      limiterEngineReady: 'Network control ready',
      limiterSetupRequired: 'Network control setup required',
      limiterServiceStopped: 'Network control service is stopped',
      limiterServicePreparing: 'Network control service is preparing',
      limiterStagedHint: 'Install the PulseNet network control helper once to activate these rules.',
      limiterBlockInternet: 'Block internet',
      limiterUnblockInternet: 'Unblock internet',
      limiterBlocked: 'Blocked',
      limiterBlockSaved: 'Internet access blocked',
      limiterDownload: 'Download limit',
      limiterUpload: 'Upload limit',
      limiterOptional: 'Optional',
      limiterUnit: 'Unit',
      limiterApply: 'Save rule',
      limiterRemove: 'Remove limit',
      limiterCancel: 'Cancel',
      limiterSaved: 'Bandwidth rule saved',
      limiterRemoved: 'Bandwidth rule removed',
      limiterRequired: 'Enter at least one download or upload limit.',
      limiterNoPath: 'An executable path is required for app limits.',
      limiterKbps: 'Kbps',
      limiterMbps: 'Mbps',
      limiterKBps: 'KB/s',
      limiterMBps: 'MB/s',
      alerts: 'Log',
      settings: 'Settings',
      logAll: 'All',
      logSpeed: 'Speed Test',
      logAlerts: 'Alerts',
      logDns: 'DNS',
      logNetwork: 'Network',
      logAction: 'Action',
      logSearch: 'Search logs...',
      logDateAll: 'All dates',
      logDateToday: 'Last 24h',
      logDateWeek: 'Last 7 days',
      logExportJson: 'Export JSON',
      logExportCsv: 'Export CSV',
      logEmpty: 'No logs yet.',
      logClear: 'Clear logs',
      logOverview: 'Log overview',
      logControls: 'Filters and export',
      logTimeline: 'Event timeline',
      logTotal: 'Total logs',
      logFiltered: 'Visible',
      logLatest: 'Latest event',
      logNoLatest: 'No event recorded',
      logSpeedComplete: 'Speed test completed',
      logDnsResult: 'DNS test result',
      logDnsFailed: 'DNS test failed',
      logDnsBenchmark: 'DNS benchmark',
      logDomainBatch: 'Domain batch check',
      logPingAlert: 'Ping alert',
      logPingHighLatency: 'High latency',
      logPacketLoss: 'Packet loss',
      logIpChanged: 'Public IP changed',
      logProfileApplied: 'Profile applied',
      settingsGeneral: 'General',
      settingsMonitoring: 'Monitoring',
      settingsUpdates: 'Updates',
      settingsAutoLaunch: 'Auto launch',
      settingsAutoLaunchHint: 'Start app when Windows boots',
      settingsPingInterval: 'Ping interval (ms)',
      settingsPingIntervalHint: 'How often pings refresh',
      settingsOptimization: 'Optimization',
      settingsOptimizationHint: 'Disable sparkline to reduce CPU usage',
      settingsCompactMode: 'Compact mode',
      settingsCompactModeHint: 'Show denser cards and controls',
      settingsBackup: 'Settings backup',
      settingsBackupHint: 'Export or import hosts, DNS tools, and preferences',
      settingsExport: 'Export',
      settingsImport: 'Import',
      settingsImportDone: 'Settings imported',
      settingsImportFailed: 'Settings import failed',
      settingsUpdateTitle: 'Check Update Now',
      settingsUpdateHint: 'Compare your version with GitHub',
      settingsUpdateButton: 'Check',
      settingsAutoUpdateCheck: 'Auto check updates',
      settingsAutoUpdateCheckHint: 'Notify when a newer version is available',
      settingsBetaUpdate: 'Beta updates',
      settingsBetaUpdateHint: 'Include pre-release versions in update check',
      updateChecking: 'Checking...',
      updateUpToDate: 'You are up to date',
      updateFailed: 'Update check failed',
      updateModalTitle: 'Update available',
      updateModalBody: 'A newer version is available. Download now?',
      updateModalPrereleaseWarning: 'Warning: this is a beta pre-release and is not recommended for normal users.',
      updateModalYes: 'Yes',
      updateModalNo: 'Not now',
      closeActionTitle: 'Action to closing',
      closeActionHint: 'Choose what happens when closing the app',
      closeActionHide: 'Hide',
      closeActionExit: 'Exit',
      closeActionAsk: 'Ask every time',
      closeModalTitle: 'Hide or Exit the application',
      closeModalRemember: 'Remember my choice',
      adminNoticeTitle: 'Run PulseNet as administrator',
      adminNoticeBody: 'This application uses ICMP to receive ping responses from servers, so it needs administrator privileges.',
      adminNoticeOk: 'OK',
      monitoring: 'Monitoring',
      about: 'About',
      add: 'Add',
      edit: 'Edit',
      publicIpLabel: 'Public IP',
      publicIpRefresh: 'Refresh IP',
      publicIpHide: 'Hide IP',
      publicIpShow: 'Show IP',
      save: 'Save',
      cancel: 'Cancel',
      copy: 'Copy',
      copied: 'Copied',
      copyShort: 'CP',
      copiedShort: 'OK',
      pin: 'Pin to top',
      unpin: 'Unpin',
      pinShort: 'PIN',
      unpinShort: 'TOP',
      pause: 'Pause ping',
      resume: 'Resume ping',
      pauseShort: 'PAUSE',
      resumeShort: 'RUN',
      statusGood: 'Good',
      statusWarning: 'High',
      statusStable: 'Stable',
      statusDown: 'Down',
      statusPaused: 'Paused',
      statusUnknown: 'Unknown',
      hostNameShortPlaceholder: 'Host name',
      hostIpShortPlaceholder: 'IP address or domain',
      packetLoss: 'Loss',
      profiles: 'Profiles',
      profileGaming: 'Gaming',
      profileGamingHint: 'Low latency targets for games and voice',
      profileWork: 'Work',
      profileWorkHint: 'Developer and productivity endpoints',
      profileStreaming: 'Streaming',
      profileStreamingHint: 'Video and media services',
      profileIran: 'Iran',
      profileIranHint: 'Local services and domestic checks',
      firstRunTitle: 'Choose a monitoring profile',
      firstRunSkip: 'Skip for now',
      dnsPlaceholder: 'example.com',
      dnsTest: 'Test DNS',
      dnsTesting: 'Testing...',
      dnsBenchmark: 'Benchmark DNS',
      dnsBenchmarking: 'Benchmarking...',
      dnsBenchmarkRounds: 'Rounds',
      dnsTopFastest: 'Top fastest',
      dnsAverage: 'Avg',
      dnsSuccessRate: 'Success',
      dnsInvalid: 'Enter a domain (e.g. example.com)',
      dnsFailed: 'DNS test failed',
      dnsBenchmarkDone: 'DNS benchmark completed',
      dnsBenchmarkFailed: 'DNS benchmark failed',
      dnsCustomTitle: 'Custom DNS tools',
      dnsCustomPlaceholder: 'DNS server (e.g. 1.1.1.2)',
      dnsAddServer: 'Add DNS',
      dnsCustomEmpty: 'No custom DNS added',
      dnsCustomInvalid: 'Enter a valid DNS IP',
      dnsBatchTitle: 'Domain Batch Checker',
      dnsBatchPlaceholder: 'One domain per line (e.g. youtube.com)',
      dnsBatchRun: 'Run Batch',
      dnsBatchRunning: 'Running...',
      dnsBatchInvalid: 'Enter at least one valid domain',
      dnsBatchDone: 'Batch check completed',
      dnsBatchFailed: 'Batch check failed',
      dnsResolved: 'Resolved',
      dnsUnresolved: 'Unresolved',
      dnsSearchPlaceholder: 'Search DNS...',
      dnsSortLatencyAsc: 'Latency (Low to High)',
      dnsSortLatencyDesc: 'Latency (High to Low)',
      dnsSortServerAsc: 'Server (A-Z)',
      dnsSortServerDesc: 'Server (Z-A)',
      dnsSortStatus: 'Status',
      dnsTableServer: 'Server',
      dnsTableLatency: 'Latency',
      dnsTableStatus: 'Status',
      dnsTableActions: 'Actions',
      dnsTableEmpty: 'No DNS results found',
      dnsManagerTitle: 'System DNS Manager',
      dnsManagerAdapter: 'Network adapter',
      dnsManagerRefresh: 'Refresh',
      dnsManagerPrimary: 'Primary DNS',
      dnsManagerSecondary: 'Secondary DNS (optional)',
      dnsManagerApply: 'Apply DNS',
      dnsManagerReset: 'Reset (DHCP)',
      dnsManagerNoAdapters: 'No adapter found',
      dnsManagerApplied: 'DNS updated successfully',
      dnsManagerResetDone: 'DNS reset to automatic',
      dnsManagerFailed: 'Failed to update DNS',
      dnsRecommendation: 'Recommended DNS',
      dnsApplyRecommended: 'Apply recommended DNS',
      dnsRecommendationEmpty: 'Run a DNS test or benchmark first',
      dnsRollback: 'Rollback DNS',
      dnsRollbackDone: 'DNS rollback completed',
      adapterCurrentDns: 'Current DNS',
      adapterIpv4: 'IPv4',
      adapterGateway: 'Gateway',
      adapterStatus: 'Status',
      usable: 'Usable',
      blocked: 'Blocked',
      failed: 'failed',
      speedDownload: 'Download',
      speedUpload: 'Upload',
      speedLatency: 'Latency',
      speedJitter: 'Jitter',
      speedStart: 'Start',
      speedStop: 'Stop',
      speedPhaseIdle: 'Ready',
      speedPhaseDownload: 'Testing Download',
      speedPhaseUpload: 'Testing Upload',
      speedPhaseFinal: 'Completed',
      speedProviderTitle: 'Provider',
      speedProviderCloudflare: 'Cloudflare',
      speedProviderHetzner: 'Hetzner',
      speedOverview: 'Connection overview',
      speedPublicIp: 'Public IP',
      speedQuality: 'Quality',
      speedQualityReady: 'Not tested',
      speedQualityGreat: 'Great',
      speedQualityStable: 'Stable',
      speedQualityUnstable: 'Unstable',
      speedNote: 'Note: If you use IP-changing tools, enable the Tunnel option in the tool settings to show updates.',
      aboutProductLabel: 'Product',
      aboutVersionLabel: 'Version',
      aboutDeveloperLabel: 'Developer',
      aboutContactLabel: 'Contact',
      aboutDevTitle: 'Web Application Developer',
      aboutDevLine1: 'This web application was designed and developed by',
      aboutDevLine2: 'For contact and to see other projects, visit the link below:',
      aboutGithubLink: 'View on GitHub',
      dragToReorder: 'Drag to reorder',
      dragPreviewMove: 'Move',
      reorderHint: 'Reorder mode is on: drag cards to change order and use × to delete.',
      deleteTitle: (label) => `Delete ${label}`,
    };
    const fa = {
      platform: '\u067e\u0644\u062a\u0641\u0631\u0645',
      ping: '\u067e\u06cc\u0646\u06af',
      dnsChecker: '\u062a\u0633\u062a \u062f\u0627\u0645\u0646\u0647',
      dnsToolTest: 'DNS تست',
      dnsToolManager: 'DNS مدیریت',
      speedTest: '\u062a\u0633\u062a \u0633\u0631\u0639\u062a',
      networkUsage: 'مصرف شبکه',
      networkMonitorSubtitle: 'نمایش زنده ترافیک آداپتورها و پردازش‌های فعال شبکه',
      networkDownloadLive: 'دانلود لحظه‌ای',
      networkUploadLive: 'آپلود لحظه‌ای',
      networkTotalReceived: 'کل دریافت',
      networkTotalSent: 'کل ارسال',
      networkAdapters: 'آداپتورها',
      networkProcesses: 'پردازش‌های فعال',
      networkRefresh: 'به‌روزرسانی',
      networkRefreshing: 'در حال به‌روزرسانی...',
      networkNoAdapters: 'داده‌ای از آداپتور وجود ندارد',
      networkNoProcesses: 'داده‌ای از پردازش فعال وجود ندارد',
      networkProcess: 'پردازش',
      networkPid: 'PID',
      networkConnections: 'اتصال‌ها',
      networkRemote: 'ریموت',
      networkPath: 'مسیر',
      networkSearchProcesses: 'جستجو',
      networkSortBy: 'مرتب‌سازی',
      networkSortMostConnections: 'بیشترین اتصال',
      networkSortFewestConnections: 'کمترین اتصال',
      networkSortLimitedFirst: 'دارای محدودیت',
      networkSortNameAsc: 'نام A-Z',
      networkSortNameDesc: 'نام Z-A',
      networkAppDownloadTitle: 'سهم دانلود برنامه‌ها',
      networkAppDownloadSubtitle: 'TCP دانلود ها بر حسب کانکشن',
      networkAppDownloadEmpty: 'هنوز داده‌ای از دانلود برنامه‌ها ثبت نشده است',
      networkAppDownloadOther: 'سایر برنامه‌ها',
      networkAppDownloadTracked: 'مجموع ثبت‌شده',
      networkAppDownloadReset: 'بازنشانی تاریخچه دانلود',
      networkCategoryMain: 'برنامه‌ها',
      networkCategoryBrowsers: 'مرورگرها',
      networkCategoryApps: 'برنامه‌ها',
      networkCategorySystem: 'سیستم',
      networkCategoryUnknown: 'نامشخص',
      networkStatusHigh: 'فعالیت بالا',
      networkStatusNormal: 'عادی',
      networkStatusIdle: 'کم‌فعال',
      networkGroupedPids: 'PIDهای گروه‌شده',
      networkDetails: 'جزئیات',
      networkHideDetails: 'بستن',
      networkShowMoreProcesses: 'نمایش بیشتر',
      networkShowLessProcesses: 'نمایش کمتر',
      networkNoProcessMatches: 'پردازشی مطابق جستجو پیدا نشد',
      networkUnavailable: 'داده مصرف شبکه در دسترس نیست.',
      networkLinuxProcessNote: 'مصرف به تفکیک پردازش فعلا روی ویندوز فعال است. در لینوکس، این نسخه ترافیک کلی آداپتورها را نشان می‌دهد.',
      limiterTitle: 'محدودیت پهنای باند',
      limiterSetLimit: 'اعمال محدودیت',
      limiterEditLimit: 'ویرایش محدودیت',
      limiterActive: 'محدودشده',
      limiterStaged: 'در انتظار راه‌اندازی',
      limiterEngineReady: 'کنترل شبکه آماده است',
      limiterSetupRequired: 'راه‌اندازی کنترل شبکه لازم است',
      limiterServiceStopped: 'سرویس کنترل شبکه متوقف است',
      limiterServicePreparing: 'سرویس کنترل شبکه در حال آماده‌سازی است',
      limiterStagedHint: ' برای فعال‌شدن قانون‌ها، ابزار کنترل شبکه را یک‌بار نصب کنید.',
      limiterBlockInternet: 'قطع اینترنت',
      limiterUnblockInternet: 'وصل اینترنت',
      limiterBlocked: 'قطع‌شده',
      limiterBlockSaved: 'دسترسی اینترنت برنامه قطع شد',
      limiterDownload: 'محدودیت دانلود',
      limiterUpload: 'محدودیت آپلود',
      limiterOptional: 'اختیاری',
      limiterUnit: 'واحد',
      limiterApply: 'ذخیره قانون',
      limiterRemove: 'حذف محدودیت',
      limiterCancel: 'انصراف',
      limiterSaved: 'قانون پهنای باند ذخیره شد',
      limiterRemoved: 'محدودیت حذف شد',
      limiterRequired: 'حداقل مقدار دانلود یا آپلود را وارد کنید.',
      limiterNoPath: 'برای محدودسازی برنامه، مسیر فایل اجرایی لازم است.',
      limiterKbps: 'Kbps',
      limiterMbps: 'Mbps',
      limiterKBps: 'KB/s',
      limiterMBps: 'MB/s',
      alerts: '\u0644\u0627\u06af',
      settings: '\u062a\u0646\u0638\u06cc\u0645\u0627\u062a',
      logAll: '\u0647\u0645\u0647',
      logSpeed: '\u062a\u0633\u062a \u0633\u0631\u0639\u062a',
      logAlerts: '\u0647\u0634\u062f\u0627\u0631\u0647\u0627',
      logDns: 'DNS',
      logNetwork: '\u0634\u0628\u06a9\u0647',
      logAction: '\u0627\u0642\u062f\u0627\u0645',
      logSearch: '\u062c\u0633\u062a\u062c\u0648\u06cc \u0644\u0627\u06af...',
      logDateAll: '\u0647\u0645\u0647 \u062a\u0627\u0631\u06cc\u062e\u200c\u0647\u0627',
      logDateToday: '\u06f2\u06f4 \u0633\u0627\u0639\u062a \u0627\u062e\u06cc\u0631',
      logDateWeek: '\u06f7 \u0631\u0648\u0632 \u0627\u062e\u06cc\u0631',
      logExportJson: '\u062e\u0631\u0648\u062c\u06cc JSON',
      logExportCsv: '\u062e\u0631\u0648\u062c\u06cc CSV',
      logEmpty: '\u0647\u0646\u0648\u0632 \u0644\u0627\u06af\u06cc \u062b\u0628\u062a \u0646\u0634\u062f\u0647 \u0627\u0633\u062a.',
      logClear: '\u067e\u0627\u06a9 \u06a9\u0631\u062f\u0646 \u0644\u0627\u06af\u200c\u0647\u0627',
      logOverview: '\u062e\u0644\u0627\u0635\u0647 \u0644\u0627\u06af',
      logControls: '\u0641\u06cc\u0644\u062a\u0631 \u0648 \u062e\u0631\u0648\u062c\u06cc',
      logTimeline: '\u062e\u0637 \u0632\u0645\u0627\u0646 \u0631\u0648\u06cc\u062f\u0627\u062f\u0647\u0627',
      logTotal: '\u06a9\u0644 \u0644\u0627\u06af\u200c\u0647\u0627',
      logFiltered: '\u0646\u0645\u0627\u06cc\u0634\u200c\u062f\u0627\u062f\u0647 \u0634\u062f\u0647',
      logLatest: '\u0622\u062e\u0631\u06cc\u0646 \u0631\u0648\u06cc\u062f\u0627\u062f',
      logNoLatest: '\u0631\u0648\u06cc\u062f\u0627\u062f\u06cc \u062b\u0628\u062a \u0646\u0634\u062f\u0647',
      logSpeedComplete: '\u067e\u0627\u06cc\u0627\u0646 \u062a\u0633\u062a \u0633\u0631\u0639\u062a',
      logDnsResult: '\u0646\u062a\u06cc\u062c\u0647 \u062a\u0633\u062a DNS',
      logDnsFailed: '\u062e\u0637\u0627 \u062f\u0631 \u062a\u0633\u062a DNS',
      logDnsBenchmark: '\u0628\u0646\u0686\u0645\u0627\u0631\u06a9 DNS',
      logDomainBatch: '\u0628\u0631\u0631\u0633\u06cc \u062f\u0633\u062a\u0647\u200c\u0627\u06cc \u062f\u0627\u0645\u0646\u0647',
      logPingAlert: '\u0647\u0634\u062f\u0627\u0631 \u067e\u06cc\u0646\u06af',
      logPingHighLatency: '\u062a\u0627\u062e\u06cc\u0631 \u0628\u0627\u0644\u0627',
      logPacketLoss: '\u0627\u0641\u062a \u067e\u06a9\u062a',
      logIpChanged: '\u062a\u063a\u06cc\u06cc\u0631 \u0622\u06cc\u200c\u067e\u06cc \u0639\u0645\u0648\u0645\u06cc',
      logProfileApplied: '\u067e\u0631\u0648\u0641\u0627\u06cc\u0644 \u0627\u0639\u0645\u0627\u0644 \u0634\u062f',
      settingsGeneral: '\u0639\u0645\u0648\u0645\u06cc',
      settingsMonitoring: '\u067e\u0627\u06cc\u0634',
      settingsUpdates: '\u0622\u067e\u062f\u06cc\u062a\u200c\u0647\u0627',
      settingsAutoLaunch: '\u0627\u062c\u0631\u0627\u06cc \u062e\u0648\u062f\u06a9\u0627\u0631',
      settingsAutoLaunchHint: '\u0628\u0627 \u0631\u0648\u0634\u0646 \u0634\u062f\u0646 \u0648\u06cc\u0646\u062f\u0648\u0632 \u0627\u062c\u0631\u0627 \u0634\u0648\u062f',
      settingsPingInterval: '\u0628\u0627\u0632\u0647 \u067e\u06cc\u0646\u06af (\u0645\u06cc\u0644\u06cc \u062b\u0627\u0646\u06cc\u0647)',
      settingsPingIntervalHint: '\u0641\u0627\u0635\u0644\u0647 \u0628\u0647 \u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06cc \u067e\u06cc\u0646\u06af',
      settingsOptimization: '\u0628\u0647\u06cc\u0646\u0647\u200c\u0633\u0627\u0632\u06cc',
      settingsOptimizationHint: '\u0628\u0631\u0627\u06cc \u06a9\u0627\u0647\u0634 \u0645\u0635\u0631\u0641 CPU \u0646\u0645\u0648\u062f\u0627\u0631 \u062e\u0637\u06cc \u062e\u0627\u0645\u0648\u0634 \u0645\u06cc\u200c\u0634\u0648\u062f',
      settingsCompactMode: '\u062d\u0627\u0644\u062a \u0641\u0634\u0631\u062f\u0647',
      settingsCompactModeHint: '\u06a9\u0627\u0631\u062a\u200c\u0647\u0627 \u0648 \u0627\u0628\u0632\u0627\u0631\u0647\u0627 \u0641\u0634\u0631\u062f\u0647\u200c\u062a\u0631 \u0646\u0645\u0627\u06cc\u0634 \u062f\u0627\u062f\u0647 \u0645\u06cc\u200c\u0634\u0648\u0646\u062f',
      settingsBackup: '\u067e\u0634\u062a\u06cc\u0628\u0627\u0646 \u062a\u0646\u0638\u06cc\u0645\u0627\u062a',
      settingsBackupHint: '\u0645\u06cc\u0632\u0628\u0627\u0646\u200c\u0647\u0627\u060c DNS \u0648 \u062a\u0646\u0638\u06cc\u0645\u0627\u062a \u0631\u0627 \u062e\u0631\u0648\u062c\u06cc \u06cc\u0627 \u0648\u0631\u0648\u062f\u06cc \u0628\u06af\u06cc\u0631',
      settingsExport: '\u062e\u0631\u0648\u062c\u06cc',
      settingsImport: '\u0648\u0631\u0648\u062f\u06cc',
      settingsImportDone: '\u062a\u0646\u0638\u06cc\u0645\u0627\u062a \u0648\u0627\u0631\u062f \u0634\u062f',
      settingsImportFailed: '\u0648\u0631\u0648\u062f \u062a\u0646\u0638\u06cc\u0645\u0627\u062a \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062f',
      settingsUpdateTitle: '\u0628\u0631\u0631\u0633\u06cc \u0622\u067e\u062f\u06cc\u062a',
      settingsUpdateHint: '\u0645\u0642\u0627\u06cc\u0633\u0647 \u0648\u0631\u0698\u0646 \u0628\u0627 \u06af\u06cc\u062a \u0647\u0627\u0628',
      settingsUpdateButton: '\u0628\u0631\u0631\u0633\u06cc',
      settingsAutoUpdateCheck: '\u0628\u0631\u0631\u0633\u06cc \u062e\u0648\u062f\u06a9\u0627\u0631 \u0622\u067e\u062f\u06cc\u062a',
      settingsAutoUpdateCheckHint: '\u0648\u0642\u062a\u06cc \u0646\u0633\u062e\u0647 \u062c\u062f\u06cc\u062f \u0645\u0648\u062c\u0648\u062f \u0628\u0648\u062f \u0627\u0637\u0644\u0627\u0639 \u0628\u062f\u0647',
      settingsBetaUpdate: '\u0622\u067e\u062f\u06cc\u062a \u0628\u062a\u0627',
      settingsBetaUpdateHint: '\u0646\u0633\u062e\u0647\u200c\u0647\u0627\u06cc pre-release \u0647\u0645 \u0628\u0631\u0631\u0633\u06cc \u0634\u0648\u062f',
      updateChecking: '\u062f\u0631 \u062d\u0627\u0644 \u0628\u0631\u0631\u0633\u06cc...',
      updateUpToDate: '\u0648\u0631\u0698\u0646 \u0634\u0645\u0627 \u0628\u0647\u200c\u0631\u0648\u0632 \u0627\u0633\u062a',
      updateFailed: '\u0628\u0631\u0631\u0633\u06cc \u0622\u067e\u062f\u06cc\u062a \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062f',
      updateModalTitle: '\u0622\u067e\u062f\u06cc\u062a \u062c\u062f\u06cc\u062f',
      updateModalBody: '\u0648\u0631\u0698\u0646 \u062c\u062f\u06cc\u062f\u06cc \u0648\u062c\u0648\u062f \u062f\u0627\u0631\u062f. \u062f\u0627\u0646\u0644\u0648\u062f \u0645\u06cc\u200c\u06a9\u0646\u06cc\u062f\u061f',
      updateModalPrereleaseWarning: '\u0647\u0634\u062f\u0627\u0631: \u0627\u06cc\u0646 \u0646\u0633\u062e\u0647 \u0628\u062a\u0627 (pre-release) \u0627\u0633\u062a \u0648 \u0628\u0631\u0627\u06cc \u06a9\u0627\u0631\u0628\u0631 \u0639\u0627\u062f\u06cc \u067e\u06cc\u0634\u0646\u0647\u0627\u062f \u0646\u0645\u06cc\u200c\u0634\u0648\u062f.',
      updateModalYes: '\u0628\u0644\u0647',
      updateModalNo: '\u0641\u0639\u0644\u0627 \u0646\u0647',
      closeActionTitle: '\u0627\u0642\u062f\u0627\u0645 \u0647\u0646\u06af\u0627\u0645 \u0628\u0633\u062a\u0646',
      closeActionHint: '\u0628\u0627 \u0628\u0633\u062a\u0646 \u0628\u0631\u0646\u0627\u0645\u0647 \u0686\u0647 \u0627\u062a\u0641\u0627\u0642\u06cc \u0628\u06cc\u0641\u062a\u062f',
      closeActionHide: '\u067e\u0646\u0647\u0627\u0646 \u06a9\u0631\u062f\u0646',
      closeActionExit: '\u062e\u0631\u0648\u062c',
      closeActionAsk: '\u0647\u0631 \u0628\u0627\u0631 \u0628\u067e\u0631\u0633',
      closeModalTitle: '\u0628\u0631\u0646\u0627\u0645\u0647 \u067e\u0646\u0647\u0627\u0646 \u0634\u0648\u062f \u06cc\u0627 \u0628\u0633\u062a\u0647 \u0634\u0648\u062f\u061f',
      closeModalRemember: '\u0627\u0646\u062a\u062e\u0627\u0628 \u0645\u0646 \u0631\u0627 \u0628\u0647 \u062e\u0627\u0637\u0631 \u0628\u0633\u067e\u0627\u0631',
      adminNoticeTitle: '\u0627\u062c\u0631\u0627\u06cc PulseNet \u0628\u0627 \u062f\u0633\u062a\u0631\u0633\u06cc \u0645\u062f\u06cc\u0631',
      adminNoticeBody: '\u0627\u06cc\u0646 \u0628\u0631\u0646\u0627\u0645\u0647 \u0628\u0631\u0627\u06cc \u062f\u0631\u06cc\u0627\u0641\u062a \u067e\u0627\u0633\u062e \u067e\u06cc\u0646\u06af \u0627\u0632 \u0633\u0631\u0648\u0631\u0647\u0627 \u0627\u0632 ICMP \u0627\u0633\u062a\u0641\u0627\u062f\u0647 \u0645\u06cc\u200c\u06a9\u0646\u062f\u061b \u0628\u0646\u0627\u0628\u0631\u0627\u06cc\u0646 \u0628\u0647 \u062f\u0633\u062a\u0631\u0633\u06cc \u0645\u062f\u06cc\u0631 \u0646\u06cc\u0627\u0632 \u062f\u0627\u0631\u062f.',
      adminNoticeOk: '\u0645\u062a\u0648\u062c\u0647 \u0634\u062f\u0645',
      monitoring: '\u067e\u0627\u06cc\u0634',
      about: '\u062f\u0631\u0628\u0627\u0631\u0647',
      add: '\u0627\u0641\u0632\u0648\u062f\u0646',
      edit: '\u0648\u06cc\u0631\u0627\u06cc\u0634',
      publicIpLabel: '\u0622\u06cc\u200c\u067e\u06cc \u0639\u0645\u0648\u0645\u06cc',
      publicIpRefresh: '\u0628\u0631\u0631\u0633\u06cc \u0645\u062c\u062f\u062f \u0622\u06cc\u200c\u067e\u06cc',
      publicIpHide: '\u0645\u062e\u0641\u06cc\u200c\u0633\u0627\u0632\u06cc \u0622\u06cc\u200c\u067e\u06cc',
      publicIpShow: '\u0646\u0645\u0627\u06cc\u0634 \u0622\u06cc\u200c\u067e\u06cc',
      save: '\u0630\u062e\u06cc\u0631\u0647',
      cancel: '\u0644\u063a\u0648',
      copy: '\u06a9\u067e\u06cc',
      copied: '\u06a9\u067e\u06cc \u0634\u062f',
      copyShort: 'CP',
      copiedShort: 'OK',
      pin: '\u0633\u0646\u062c\u0627\u0642 \u0628\u0647 \u0628\u0627\u0644\u0627',
      unpin: '\u062d\u0630\u0641 \u0633\u0646\u062c\u0627\u0642',
      pinShort: 'PIN',
      unpinShort: 'TOP',
      pause: '\u062a\u0648\u0642\u0641 \u067e\u06cc\u0646\u06af',
      resume: '\u0627\u062f\u0627\u0645\u0647 \u067e\u06cc\u0646\u06af',
      pauseShort: '\u0645\u06a9\u062b',
      resumeShort: '\u0627\u062c\u0631\u0627',
      statusGood: '\u0639\u0627\u0644\u06cc',
      statusWarning: '\u0628\u0627\u0644\u0627',
      statusStable: '\u067e\u0627\u06cc\u062f\u0627\u0631',
      statusDown: '\u0642\u0637\u0639',
      statusPaused: '\u0645\u062a\u0648\u0642\u0641',
      statusUnknown: '\u0646\u0627\u0645\u0634\u062e\u0635',
      hostNameShortPlaceholder: '\u0646\u0627\u0645 \u0645\u06cc\u0632\u0628\u0627\u0646',
      hostIpShortPlaceholder: '\u0622\u062f\u0631\u0633 IP \u06cc\u0627 \u062f\u0627\u0645\u0646\u0647',
      packetLoss: '\u0627\u0641\u062a',
      profiles: '\u067e\u0631\u0648\u0641\u0627\u06cc\u0644\u200c\u0647\u0627',
      profileGaming: '\u0628\u0627\u0632\u06cc',
      profileGamingHint: '\u0645\u0642\u0635\u062f\u0647\u0627\u06cc \u06a9\u0645\u200c\u062a\u0627\u062e\u06cc\u0631 \u0628\u0631\u0627\u06cc \u0628\u0627\u0632\u06cc \u0648 \u0648\u06cc\u0633',
      profileWork: '\u06a9\u0627\u0631',
      profileWorkHint: '\u0633\u0631\u0648\u06cc\u0633\u200c\u0647\u0627\u06cc \u062a\u0648\u0633\u0639\u0647 \u0648 \u0628\u0647\u0631\u0647\u200c\u0648\u0631\u06cc',
      profileStreaming: '\u0627\u0633\u062a\u0631\u06cc\u0645',
      profileStreamingHint: '\u0633\u0631\u0648\u06cc\u0633\u200c\u0647\u0627\u06cc \u0648\u06cc\u062f\u06cc\u0648 \u0648 \u0631\u0633\u0627\u0646\u0647',
      profileIran: '\u0627\u06cc\u0631\u0627\u0646',
      profileIranHint: '\u0633\u0631\u0648\u06cc\u0633\u200c\u0647\u0627\u06cc \u062f\u0627\u062e\u0644\u06cc \u0648 \u062a\u0633\u062a \u0645\u062d\u0644\u06cc',
      firstRunTitle: '\u06cc\u06a9 \u067e\u0631\u0648\u0641\u0627\u06cc\u0644 \u067e\u0627\u06cc\u0634 \u0627\u0646\u062a\u062e\u0627\u0628 \u06a9\u0646\u06cc\u062f',
      firstRunSkip: '\u0641\u0639\u0644\u0627 \u0631\u062f \u06a9\u0646',
      dnsPlaceholder: 'example.com',
      dnsTest: '\u062a\u0633\u062a DNS',
      dnsTesting: '\u062f\u0631 \u062d\u0627\u0644 \u062a\u0633\u062a...',
      dnsBenchmark: '\u0628\u0646\u0686\u0645\u0627\u0631\u06a9 DNS',
      dnsBenchmarking: '\u062f\u0631 \u062d\u0627\u0644 \u0628\u0646\u0686\u0645\u0627\u0631\u06a9...',
      dnsBenchmarkRounds: '\u062a\u0639\u062f\u0627\u062f \u062f\u0648\u0631',
      dnsTopFastest: '\u0633\u0631\u06cc\u0639\u200c\u062a\u0631\u06cc\u0646\u200c\u0647\u0627',
      dnsAverage: '\u0645\u06cc\u0627\u0646\u06af\u06cc\u0646',
      dnsSuccessRate: '\u0646\u0631\u062e \u0645\u0648\u0641\u0642\u06cc\u062a',
      dnsInvalid: '\u0644\u0637\u0641\u0627\u064b \u06cc\u06a9 \u062f\u0627\u0645\u0646\u0647 \u0648\u0627\u0631\u062f \u06a9\u0646\u06cc\u062f (\u0645\u062b\u0644\u0627\u064b example.com)',
      dnsFailed: '\u062a\u0633\u062a DNS \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062f',
      dnsBenchmarkDone: '\u0628\u0646\u0686\u0645\u0627\u0631\u06a9 DNS \u062a\u0645\u0627\u0645 \u0634\u062f',
      dnsBenchmarkFailed: '\u0628\u0646\u0686\u0645\u0627\u0631\u06a9 DNS \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062f',
      dnsCustomTitle: '\u0627\u0628\u0632\u0627\u0631 DNS \u0633\u0641\u0627\u0631\u0634\u06cc',
      dnsCustomPlaceholder: '\u0622\u062f\u0631\u0633 DNS (\u0645\u062b\u0644 1.1.1.2)',
      dnsAddServer: '\u0627\u0641\u0632\u0648\u062f\u0646 DNS',
      dnsCustomEmpty: 'DNS \u0633\u0641\u0627\u0631\u0634\u06cc \u0627\u06cc \u0627\u0636\u0627\u0641\u0647 \u0646\u0634\u062f\u0647',
      dnsCustomInvalid: '\u06cc\u06a9 IP \u0645\u0639\u062a\u0628\u0631 \u0628\u0631\u0627\u06cc DNS \u0648\u0627\u0631\u062f \u06a9\u0646\u06cc\u062f',
      dnsBatchTitle: '\u0628\u0631\u0631\u0633\u06cc \u062f\u0627\u0645\u0646\u0647\u200c\u0647\u0627',
      dnsBatchPlaceholder: '\u0647\u0631 \u062e\u0637 \u06cc\u06a9 \u062f\u0627\u0645\u0646\u0647 (\u0645\u062b\u0644 youtube.com)',
      dnsBatchRun: '\u0627\u062c\u0631\u0627\u06cc \u062f\u0633\u062a\u0647\u200c\u0627\u06cc',
      dnsBatchRunning: '\u062f\u0631 \u062d\u0627\u0644 \u0627\u062c\u0631\u0627...',
      dnsBatchInvalid: '\u062d\u062f\u0627\u0642\u0644 \u06cc\u06a9 \u062f\u0627\u0645\u0646\u0647 \u0645\u0639\u062a\u0628\u0631 \u0648\u0627\u0631\u062f \u06a9\u0646\u06cc\u062f',
      dnsBatchDone: '\u0628\u0631\u0631\u0633\u06cc \u062f\u0633\u062a\u0647\u200c\u0627\u06cc \u062a\u0645\u0627\u0645 \u0634\u062f',
      dnsBatchFailed: '\u0628\u0631\u0631\u0633\u06cc \u062f\u0633\u062a\u0647\u200c\u0627\u06cc \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062f',
      dnsResolved: '\u0642\u0627\u0628\u0644 \u0631\u06cc\u0632\u0627\u0644\u0648',
      dnsUnresolved: '\u063a\u06cc\u0631\u0642\u0627\u0628\u0644 \u0631\u06cc\u0632\u0627\u0644\u0648',
      dnsSearchPlaceholder: '\u062c\u0633\u062a\u062c\u0648\u06cc DNS...',
      dnsSortLatencyAsc: '\u062a\u0627\u062e\u06cc\u0631 (\u06a9\u0645 \u0628\u0647 \u0632\u06cc\u0627\u062f)',
      dnsSortLatencyDesc: '\u062a\u0627\u062e\u06cc\u0631 (\u0632\u06cc\u0627\u062f \u0628\u0647 \u06a9\u0645)',
      dnsSortServerAsc: '\u0633\u0631\u0648\u0631 (A-Z)',
      dnsSortServerDesc: '\u0633\u0631\u0648\u0631 (Z-A)',
      dnsSortStatus: '\u0648\u0636\u0639\u06cc\u062a',
      dnsTableServer: '\u0633\u0631\u0648\u0631',
      dnsTableLatency: '\u062a\u0627\u062e\u06cc\u0631',
      dnsTableStatus: '\u0648\u0636\u0639\u06cc\u062a',
      dnsTableActions: '\u0627\u0628\u0632\u0627\u0631',
      dnsTableEmpty: '\u0646\u062a\u06cc\u062c\u0647\u200c\u0627\u06cc \u067e\u06cc\u062f\u0627 \u0646\u0634\u062f',
      dnsManagerTitle: '\u0645\u062f\u06cc\u0631 \u0633\u06cc\u0633\u062a\u0645 DNS',
      dnsManagerAdapter: '\u06a9\u0627\u0631\u062a \u0634\u0628\u06a9\u0647',
      dnsManagerRefresh: '\u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06cc',
      dnsManagerPrimary: 'DNS \u0627\u0635\u0644\u06cc',
      dnsManagerSecondary: 'DNS \u062f\u0648\u0645 (\u0627\u062e\u062a\u06cc\u0627\u0631\u06cc)',
      dnsManagerApply: '\u0627\u0639\u0645\u0627\u0644 DNS',
      dnsManagerReset: '\u0628\u0627\u0632\u06af\u0634\u062a \u0628\u0647 DHCP',
      dnsManagerNoAdapters: '\u06a9\u0627\u0631\u062a \u0634\u0628\u06a9\u0647\u200c\u0627\u06cc \u06cc\u0627\u0641\u062a \u0646\u0634\u062f',
      dnsManagerApplied: 'DNS \u0628\u0627 \u0645\u0648\u0641\u0642\u06cc\u062a \u062a\u063a\u06cc\u06cc\u0631 \u06a9\u0631\u062f',
      dnsManagerResetDone: 'DNS \u0628\u0647 \u062d\u0627\u0644\u062a \u062e\u0648\u062f\u06a9\u0627\u0631 \u0628\u0631\u06af\u0634\u062a',
      dnsManagerFailed: '\u062a\u063a\u06cc\u06cc\u0631 DNS \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062f',
      dnsRecommendation: 'DNS \u067e\u06cc\u0634\u0646\u0647\u0627\u062f\u06cc',
      dnsApplyRecommended: '\u0627\u0639\u0645\u0627\u0644 DNS \u067e\u06cc\u0634\u0646\u0647\u0627\u062f\u06cc',
      dnsRecommendationEmpty: '\u0627\u0648\u0644 \u062a\u0633\u062a \u06cc\u0627 \u0628\u0646\u0686\u0645\u0627\u0631\u06a9 DNS \u0631\u0627 \u0627\u062c\u0631\u0627 \u06a9\u0646\u06cc\u062f',
      dnsRollback: '\u0628\u0627\u0632\u06af\u0631\u062f\u0627\u0646\u06cc DNS',
      dnsRollbackDone: '\u0628\u0627\u0632\u06af\u0631\u062f\u0627\u0646\u06cc DNS \u0627\u0646\u062c\u0627\u0645 \u0634\u062f',
      adapterCurrentDns: 'DNS \u0641\u0639\u0644\u06cc',
      adapterIpv4: 'IPv4',
      adapterGateway: '\u06af\u06cc\u062a\u200c\u0648\u06cc',
      adapterStatus: '\u0648\u0636\u0639\u06cc\u062a',
      usable: '\u0642\u0627\u0628\u0644 \u0627\u0633\u062a\u0641\u0627\u062f\u0647',
      blocked: '\u0645\u0633\u062f\u0648\u062f \u0634\u062f\u0647',
      failed: '\u0646\u0627\u0645\u0648\u0641\u0642',
      speedDownload: '\u0633\u0631\u0639\u062a \u062f\u0627\u0646\u0644\u0648\u062f',
      speedUpload: '\u0633\u0631\u0639\u062a \u0622\u067e\u0644\u0648\u062f',
      speedLatency: '\u062a\u0627\u062e\u06cc\u0631',
      speedJitter: '\u0646\u0648\u0633\u0627\u0646',
      speedStart: '\u0634\u0631\u0648\u0639',
      speedStop: '\u062a\u0648\u0642\u0641',
      speedPhaseIdle: '\u0622\u0645\u0627\u062f\u0647',
      speedPhaseDownload: '\u062f\u0631 \u062d\u0627\u0644 \u062a\u0633\u062a \u062f\u0627\u0646\u0644\u0648\u062f',
      speedPhaseUpload: '\u062f\u0631 \u062d\u0627\u0644 \u062a\u0633\u062a \u0622\u067e\u0644\u0648\u062f',
      speedPhaseFinal: '\u067e\u0627\u06cc\u0627\u0646 \u062a\u0633\u062a',
      speedProviderTitle: '\u0633\u0631\u0648\u06cc\u0633',
      speedProviderCloudflare: 'Cloudflare',
      speedProviderHetzner: 'Hetzner',
      speedOverview: '\u062e\u0644\u0627\u0635\u0647 \u0627\u062a\u0635\u0627\u0644',
      speedPublicIp: '\u0622\u06cc\u200c\u067e\u06cc \u0639\u0645\u0648\u0645\u06cc',
      speedQuality: '\u06a9\u06cc\u0641\u06cc\u062a',
      speedQualityReady: '\u062a\u0633\u062a \u0646\u0634\u062f\u0647',
      speedQualityGreat: '\u0639\u0627\u0644\u06cc',
      speedQualityStable: '\u067e\u0627\u06cc\u062f\u0627\u0631',
      speedQualityUnstable: '\u0646\u0627\u067e\u0627\u06cc\u062f\u0627\u0631',
      speedNote: '\u0646\u06a9\u062a\u0647 : \u0627\u06af\u0631 \u0627\u0632 \u0627\u0628\u0632\u0627\u0631 \u0647\u0627\u06cc \u062a\u063a\u06cc\u06cc\u0631 \u0622\u06cc\u067e\u06cc \u0627\u0633\u062a\u0641\u0627\u062f\u0647 \u0645\u06cc\u06a9\u0646\u06cc\u062f \u0628\u0631\u0627\u06cc \u0646\u0645\u0627\u06cc\u0634 \u062a\u063a\u06cc\u06cc\u0631\u0627\u062a \u06af\u0632\u06cc\u0646\u0647 \u062a\u0648\u0646\u0644 \u0631\u0648 \u062f\u0631 \u062a\u0646\u0638\u06cc\u0645\u0627\u062a \u0627\u0628\u0632\u0627\u0631 \u0631\u0648\u0634\u0646 \u06a9\u0646\u06cc\u062f',
      aboutProductLabel: '\u0645\u062d\u0635\u0648\u0644',
      aboutVersionLabel: '\u0648\u0631\u0698\u0646',
      aboutDeveloperLabel: '\u062a\u0648\u0633\u0639\u0647\u200c\u062f\u0647\u0646\u062f\u0647',
      aboutContactLabel: '\u0627\u0631\u062a\u0628\u0627\u0637',
      aboutDevTitle: '\u062a\u0648\u0633\u0639\u0647\u200c\u062f\u0647\u0646\u062f\u0647 \u0648\u0628 \u0627\u067e\u0644\u06cc\u06a9\u06cc\u0634\u0646',
      aboutDevLine1: '\u0627\u06cc\u0646 \u0648\u0628 \u0627\u067e\u0644\u06cc\u06a9\u06cc\u0634\u0646 \u062a\u0648\u0633\u0637',
      aboutDevLine2: '\u0628\u0631\u0627\u06cc \u0627\u0631\u062a\u0628\u0627\u0637 \u0648 \u0645\u0634\u0627\u0647\u062f\u0647 \u067e\u0631\u0648\u0698\u0647\u200c\u0647\u0627\u06cc \u062f\u06cc\u06af\u0631\u060c \u0627\u0632 \u0644\u06cc\u0646\u06a9 \u0632\u06cc\u0631 \u062f\u06cc\u062f\u0646 \u06a9\u0646\u06cc\u062f:',
      aboutGithubLink: '\u0645\u0634\u0627\u0647\u062f\u0647 \u062f\u0631 GitHub',
      dragToReorder: '\u062c\u0627\u0628\u062c\u0627\u06cc\u06cc \u0628\u0631\u0627\u06cc \u062a\u063a\u06cc\u06cc\u0631 \u062a\u0631\u062a\u06cc\u0628',
      dragPreviewMove: '\u062c\u0627\u0628\u062c\u0627\u06cc\u06cc',
      reorderHint: '\u062d\u0627\u0644\u062a \u062a\u0631\u062a\u06cc\u0628\u200c\u062f\u0647\u06cc \u0641\u0639\u0627\u0644 \u0627\u0633\u062a: \u06a9\u0627\u0631\u062a\u200c\u0647\u0627 \u0631\u0627 \u0628\u06a9\u0634\u06cc\u062f \u0648 \u0628\u0627 \u00d7 \u062d\u0630\u0641 \u06a9\u0646\u06cc\u062f.',
      deleteTitle: (label) => `\u062d\u0630\u0641 ${label}`,
    };
    return isPersian ? fa : en;
  }, [isPersian]);

  const bandwidthRulesByPath = useMemo(() => {
    const entries = (bandwidthLimiterState.rules || []).map((rule) => [
      normalizeLimiterPath(rule.executablePath),
      rule,
    ]);
    return new Map(entries);
  }, [bandwidthLimiterState.rules]);

  const networkControlIsWindows = bandwidthLimiterState.engine?.platform === 'windows';

  const handleToggleApplicationBlock = useCallback(async (process) => {
    const executablePath = (process?.paths || [])[0] || '';
    if (!executablePath) {
      setBandwidthLimitFeedback(texts.limiterNoPath);
      return;
    }
    const existing = bandwidthRulesByPath.get(normalizeLimiterPath(executablePath));
    setBandwidthLimitSaving(true);
    setBandwidthLimitFeedback('');
    try {
      const result = existing?.blocked
        ? await invoke('remove_bandwidth_limit_rule', { executablePath })
        : await invoke('upsert_bandwidth_limit_rule', {
          rule: {
            executablePath,
            processName: process.name,
            downloadLimitBps: null,
            uploadLimitBps: null,
            blocked: true,
            enabled: true,
          },
        });
      setBandwidthLimiterState({ engine: result?.engine || null, rules: result?.rules || [] });
      setBandwidthLimitFeedback(existing?.blocked ? texts.limiterRemoved : texts.limiterBlockSaved);
    } catch (error) {
      setBandwidthLimitFeedback(String(error || 'network-control-update-failed'));
    } finally {
      setBandwidthLimitSaving(false);
    }
  }, [bandwidthRulesByPath, texts.limiterBlockSaved, texts.limiterNoPath, texts.limiterRemoved]);

  const openBandwidthLimitModal = useCallback((process) => {
    const executablePath = (process?.paths || [])[0] || '';
    if (!executablePath) {
      setBandwidthLimitFeedback(texts.limiterNoPath);
      return;
    }
    const existing = bandwidthRulesByPath.get(normalizeLimiterPath(executablePath));
    const factor = BANDWIDTH_UNIT_FACTORS.mbps;
    const inputValue = (value) => {
      if (!value) return '';
      return String(Number((Number(value) / factor).toFixed(3)));
    };
    setBandwidthLimitForm({
      download: inputValue(existing?.downloadLimitBps),
      upload: inputValue(existing?.uploadLimitBps),
      unit: 'mbps',
      blocked: Boolean(existing?.blocked),
    });
    setBandwidthLimitFeedback('');
    setBandwidthLimitModalProcess({ ...process, executablePath, existingRule: existing || null });
  }, [bandwidthRulesByPath, texts.limiterNoPath]);

  const closeBandwidthLimitModal = useCallback(() => {
    if (bandwidthLimitSaving) return;
    setBandwidthLimitModalProcess(null);
    setBandwidthLimitFeedback('');
  }, [bandwidthLimitSaving]);

  const handleBandwidthLimitUnitChange = useCallback((nextUnit) => {
    setBandwidthLimitForm((current) => {
      const currentFactor = BANDWIDTH_UNIT_FACTORS[current.unit] || BANDWIDTH_UNIT_FACTORS.mbps;
      const nextFactor = BANDWIDTH_UNIT_FACTORS[nextUnit] || BANDWIDTH_UNIT_FACTORS.mbps;
      const convert = (value) => {
        if (value === '') return '';
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return value;
        return String(Number(((parsed * currentFactor) / nextFactor).toFixed(3)));
      };
      return {
        download: convert(current.download),
        upload: convert(current.upload),
        unit: nextUnit,
        blocked: current.blocked,
      };
    });
  }, []);

  const handleSaveBandwidthLimit = useCallback(async () => {
    if (!bandwidthLimitModalProcess) return;
    const factor = BANDWIDTH_UNIT_FACTORS[bandwidthLimitForm.unit] || BANDWIDTH_UNIT_FACTORS.mbps;
    const toBitsPerSecond = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * factor) : null;
    };
    const downloadLimitBps = toBitsPerSecond(bandwidthLimitForm.download);
    const uploadLimitBps = toBitsPerSecond(bandwidthLimitForm.upload);
    if (!bandwidthLimitForm.blocked && !downloadLimitBps && !uploadLimitBps) {
      setBandwidthLimitFeedback(texts.limiterRequired);
      return;
    }

    setBandwidthLimitSaving(true);
    setBandwidthLimitFeedback('');
    try {
      const result = await invoke('upsert_bandwidth_limit_rule', {
        rule: {
          executablePath: bandwidthLimitModalProcess.executablePath,
          processName: bandwidthLimitModalProcess.name,
          downloadLimitBps,
          uploadLimitBps,
          blocked: bandwidthLimitForm.blocked,
          enabled: true,
        },
      });
      setBandwidthLimiterState({ engine: result?.engine || null, rules: result?.rules || [] });
      setBandwidthLimitModalProcess(null);
      setBandwidthLimitFeedback(texts.limiterSaved);
    } catch (error) {
      setBandwidthLimitFeedback(String(error || 'bandwidth-limit-save-failed'));
    } finally {
      setBandwidthLimitSaving(false);
    }
  }, [bandwidthLimitForm, bandwidthLimitModalProcess, texts.limiterRequired, texts.limiterSaved]);

  const handleRemoveBandwidthLimit = useCallback(async () => {
    if (!bandwidthLimitModalProcess?.executablePath) return;
    setBandwidthLimitSaving(true);
    setBandwidthLimitFeedback('');
    try {
      const result = await invoke('remove_bandwidth_limit_rule', {
        executablePath: bandwidthLimitModalProcess.executablePath,
      });
      setBandwidthLimiterState({ engine: result?.engine || null, rules: result?.rules || [] });
      setBandwidthLimitModalProcess(null);
      setBandwidthLimitFeedback(texts.limiterRemoved);
    } catch (error) {
      setBandwidthLimitFeedback(String(error || 'bandwidth-limit-remove-failed'));
    } finally {
      setBandwidthLimitSaving(false);
    }
  }, [bandwidthLimitModalProcess, texts.limiterRemoved]);





  const statusTexts = useMemo(() => {
    const en = {
      needAdmin: 'Need Admin',
      error: 'Error',
      noResponse: 'No Response',
      ipcError: 'IPC Error',
      paused: 'Paused',
    };
    const fa = {
      needAdmin: '\u0646\u06cc\u0627\u0632 \u0628\u0647 \u062f\u0633\u062a\u0631\u0633\u06cc \u0627\u062f\u0645\u06cc\u0646',
      error: '\u062e\u0637\u0627',
      noResponse: '\u0628\u062f\u0648\u0646 \u067e\u0627\u0633\u062e',
      ipcError: '\u062e\u0637\u0627\u06cc IPC',
      paused: '\u0645\u062a\u0648\u0642\u0641',
    };
    return isPersian ? fa : en;
  }, [isPersian]);

  const dnsSortOptions = useMemo(() => ([
    { value: 'latency-asc', label: texts.dnsSortLatencyAsc },
    { value: 'latency-desc', label: texts.dnsSortLatencyDesc },
    { value: 'server-asc', label: texts.dnsSortServerAsc },
    { value: 'server-desc', label: texts.dnsSortServerDesc },
    { value: 'status-asc', label: texts.dnsSortStatus },
  ]), [texts]);

  const networkProcessSortOptions = useMemo(() => ([
    { value: 'connections-desc', label: texts.networkSortMostConnections },
    { value: 'connections-asc', label: texts.networkSortFewestConnections },
    { value: 'limited-first', label: texts.networkSortLimitedFirst },
    { value: 'name-asc', label: texts.networkSortNameAsc },
    { value: 'name-desc', label: texts.networkSortNameDesc },
  ]), [texts]);

  const bandwidthUnitOptions = useMemo(() => ([
    { value: 'kbps', label: texts.limiterKbps },
    { value: 'mbps', label: texts.limiterMbps },
    { value: 'kbytes', label: texts.limiterKBps },
    { value: 'mbytes', label: texts.limiterMBps },
  ]), [texts]);

  const speedPhaseLabel = useMemo(() => {
    if (speedPhase === 'download') return texts.speedPhaseDownload;
    if (speedPhase === 'upload') return texts.speedPhaseUpload;
    if (speedPhase === 'final') return texts.speedPhaseFinal;
    return texts.speedPhaseIdle;
  }, [speedPhase, texts]);

  const speedQuality = useMemo(() => {
    if (!speedMetrics) {
      return { label: texts.speedQualityReady, tone: 'neutral' };
    }

    const latency = Number(speedMetrics.latencyMs);
    const jitter = Number(speedMetrics.jitterMs);
    if (Number.isFinite(latency) && Number.isFinite(jitter) && latency <= 60 && jitter <= 20) {
      return { label: texts.speedQualityGreat, tone: 'good' };
    }
    if (Number.isFinite(latency) && Number.isFinite(jitter) && latency <= 130 && jitter <= 45) {
      return { label: texts.speedQualityStable, tone: 'warning' };
    }
    return { label: texts.speedQualityUnstable, tone: 'bad' };
  }, [speedMetrics, texts]);

  const networkUsageStats = useMemo(() => {
    const current = networkSnapshot;
    const previous = previousNetworkSnapshot;
    if (!current) {
      return {
        downloadRate: 0,
        uploadRate: 0,
        totalReceived: 0,
      totalSent: 0,
      adapters: [],
      processes: [],
      applicationUsage: [],
      applicationDownloadTotal: 0,
      maxAdapterRate: 0,
      activeAdapters: 0,
      activeProcesses: 0,
      processGroups: [],
    };
  }

    const elapsedSeconds = previous
      ? Math.max(0.5, (Number(current.timestampMs) - Number(previous.timestampMs)) / 1000)
      : 0;
    const previousAdapters = new Map((previous?.adapters || []).map((adapter) => [adapter.name, adapter]));
    const adapters = (current.adapters || []).map((adapter) => {
      const previousAdapter = previousAdapters.get(adapter.name);
      const receivedDelta = previousAdapter ? Math.max(0, Number(adapter.receivedBytes || 0) - Number(previousAdapter.receivedBytes || 0)) : 0;
      const sentDelta = previousAdapter ? Math.max(0, Number(adapter.sentBytes || 0) - Number(previousAdapter.sentBytes || 0)) : 0;
      return {
        ...adapter,
        downloadRate: elapsedSeconds ? receivedDelta / elapsedSeconds : 0,
        uploadRate: elapsedSeconds ? sentDelta / elapsedSeconds : 0,
      };
    }).sort((left, right) => (right.downloadRate + right.uploadRate) - (left.downloadRate + left.uploadRate));

    const receivedDelta = previous ? Math.max(0, Number(current.receivedBytes || 0) - Number(previous.receivedBytes || 0)) : 0;
    const sentDelta = previous ? Math.max(0, Number(current.sentBytes || 0) - Number(previous.sentBytes || 0)) : 0;

    const applicationRows = (current.applications || [])
      .map((application, index) => ({
        ...application,
        id: application.path || `${application.name || 'unknown'}-${index}`,
        name: String(application.name || 'Unknown'),
        downloadBytes: Math.max(0, Number(application.downloadBytes || 0)),
      }))
      .filter((application) => application.downloadBytes > 0)
      .sort((left, right) => right.downloadBytes - left.downloadBytes);
    const applicationDownloadTotal = applicationRows.reduce(
      (total, application) => total + application.downloadBytes,
      0
    );
    const primaryApplications = applicationRows.slice(0, 5);
    const otherDownloadBytes = applicationRows
      .slice(5)
      .reduce((total, application) => total + application.downloadBytes, 0);
    if (otherDownloadBytes > 0) {
      primaryApplications.push({
        id: 'other-applications',
        name: texts.networkAppDownloadOther,
        path: '',
        iconDataUrl: '',
        downloadBytes: otherDownloadBytes,
      });
    }
    let applicationOffset = 0;
    const applicationUsage = primaryApplications.map((application, index) => {
      const share = applicationDownloadTotal
        ? application.downloadBytes / applicationDownloadTotal
        : 0;
      const result = {
        ...application,
        share,
        offset: applicationOffset,
        color: NETWORK_DOWNLOAD_CHART_COLORS[index % NETWORK_DOWNLOAD_CHART_COLORS.length],
      };
      applicationOffset += share;
      return result;
    });

    const processMap = new Map();
    for (const process of current.processes || []) {
      const category = getNetworkProcessCategory(process);
      const normalizedName = String(process.name || 'Unknown').trim() || 'Unknown';
      const groupKey = shouldGroupNetworkProcess(process)
        ? `${category}:${normalizedName.toLowerCase()}`
        : `${category}:${normalizedName.toLowerCase()}:${process.pid}`;
      const existing = processMap.get(groupKey) || {
        id: groupKey,
        name: normalizedName,
        category,
        connections: 0,
        pids: [],
        paths: [],
        icons: [],
        remoteAddresses: [],
        grouped: false,
      };
      existing.connections += Number(process.connections || 0);
      if (process.pid) existing.pids.push(process.pid);
      if (process.path && !existing.paths.includes(process.path)) existing.paths.push(process.path);
      if (process.iconDataUrl && !existing.icons.includes(process.iconDataUrl)) existing.icons.push(process.iconDataUrl);
      for (const remote of process.remoteAddresses || []) {
        if (remote && !existing.remoteAddresses.includes(remote)) existing.remoteAddresses.push(remote);
      }
      existing.grouped = existing.grouped || shouldGroupNetworkProcess(process);
      processMap.set(groupKey, existing);
    }

    const query = networkProcessSearch.trim().toLowerCase();
    const categoryLabels = {
      browsers: texts.networkCategoryBrowsers,
      apps: texts.networkCategoryApps,
      unknown: texts.networkCategoryUnknown,
      system: texts.networkCategorySystem,
    };
    const statusLabels = {
      high: texts.networkStatusHigh,
      normal: texts.networkStatusNormal,
      idle: texts.networkStatusIdle,
    };
    const displayProcesses = [...processMap.values()]
      .map((process) => {
        const connections = Number(process.connections || 0);
        const status = getNetworkProcessStatus(connections);
        const pids = [...new Set(process.pids)].sort((left, right) => Number(left) - Number(right));
        const remoteAddresses = [...new Set(process.remoteAddresses)].slice(0, 8);
        const icons = [...new Set(process.icons || [])];
        const hasBandwidthLimit = hasActiveBandwidthLimit(process.paths, bandwidthRulesByPath);
        return {
          ...process,
          connections,
          pids,
          remoteAddresses,
          icons,
          iconDataUrl: icons[0] || '',
          hasBandwidthLimit,
          status,
          statusLabel: statusLabels[status],
          categoryLabel: categoryLabels[process.category],
          searchText: [
            process.name,
            process.category,
            categoryLabels[process.category],
            status,
            statusLabels[status],
            ...pids.map(String),
            ...remoteAddresses,
            ...process.paths,
          ].join(' ').toLowerCase(),
        };
      })
      .filter((process) => !query || process.searchText.includes(query))
      .sort((left, right) => compareNetworkProcesses(networkProcessSort, left, right))
      .slice(0, 24);

    const processGroups = [
      {
        category: 'main',
        label: texts.networkCategoryMain,
        processes: displayProcesses.filter((process) => process.category !== 'system'),
      },
      {
        category: 'system',
        label: texts.networkCategorySystem,
        processes: displayProcesses.filter((process) => process.category === 'system'),
      },
    ]
      .filter((group) => group.processes.length > 0);

    return {
      downloadRate: elapsedSeconds ? receivedDelta / elapsedSeconds : 0,
      uploadRate: elapsedSeconds ? sentDelta / elapsedSeconds : 0,
      totalReceived: Number(current.receivedBytes || 0),
      totalSent: Number(current.sentBytes || 0),
      adapters,
      maxAdapterRate: adapters.reduce((max, adapter) => Math.max(max, Number(adapter.downloadRate || 0) + Number(adapter.uploadRate || 0)), 0),
      activeAdapters: adapters.filter((adapter) => (Number(adapter.downloadRate || 0) + Number(adapter.uploadRate || 0)) > 0).length,
      activeProcesses: (current.processes || []).filter((process) => Number(process.connections || 0) > 0).length,
      processes: displayProcesses,
      processGroups,
      applicationUsage,
      applicationDownloadTotal,
    };
  }, [bandwidthRulesByPath, networkSnapshot, previousNetworkSnapshot, networkProcessSearch, networkProcessSort, texts]);

  const visibleNetworkProcessGroups = useMemo(() => {
    if (showAllNetworkProcesses) {
      return networkUsageStats.processGroups;
    }

    let remaining = NETWORK_PROCESS_PREVIEW_LIMIT;
    return networkUsageStats.processGroups
      .map((group) => {
        const processes = group.processes.slice(0, Math.max(0, remaining));
        remaining -= processes.length;
        return { ...group, processes };
      })
      .filter((group) => group.processes.length > 0);
  }, [networkUsageStats.processGroups, showAllNetworkProcesses]);

  const visibleNetworkProcessCount = visibleNetworkProcessGroups.reduce(
    (total, group) => total + group.processes.length,
    0
  );
  const canToggleNetworkProcesses = networkUsageStats.processes.length > NETWORK_PROCESS_PREVIEW_LIMIT;
  const hiddenNetworkProcessCount = Math.max(0, networkUsageStats.processes.length - visibleNetworkProcessCount);
  const highlightedNetworkApplication = networkUsageStats.applicationUsage.find(
    (application) => application.id === hoveredNetworkApplicationId
  ) || networkUsageStats.applicationUsage[0] || null;

  useEffect(() => {
    setShowAllNetworkProcesses(false);
    localStorage.setItem('networkProcessSort', networkProcessSort);
  }, [networkProcessSearch, networkProcessSort]);

  const pageTitle = useMemo(() => {
    if (currentPage === 'dns') return texts.dnsChecker;
    if (currentPage === 'speed') return texts.speedTest;
    if (currentPage === 'network') return texts.networkUsage;
    if (currentPage === 'log') return texts.alerts;
    if (currentPage === 'about') return texts.about;
    if (currentPage === 'settings') return texts.settings;
    return 'PulseNet';
  }, [currentPage, texts]);

  useEffect(() => {
    const status = `${pageTitle} • IP ${publicNetworkInfo.ip || 'N/A'} ${publicNetworkInfo.country && publicNetworkInfo.country !== 'N/A' ? `(${publicNetworkInfo.country})` : ''}`;
    invoke('set_tray_status', { status }).catch(() => {});
  }, [pageTitle, publicNetworkInfo]);

  const logFilterOptions = useMemo(() => ([
    { value: 'all', label: texts.logAll },
    { value: 'speed', label: texts.logSpeed },
    { value: 'alert', label: texts.logAlerts },
    { value: 'dns', label: texts.logDns },
    { value: 'network', label: texts.logNetwork },
    { value: 'action', label: texts.logAction },
  ]), [texts]);

  const getLogTypeLabel = useCallback((type) => (
    logFilterOptions.find((option) => option.value === type)?.label || texts.logDns
  ), [logFilterOptions, texts]);

  const filteredLogs = useMemo(() => {
    const now = Date.now();
    const query = logSearch.trim().toLowerCase();
    return logEntries.filter((entry) => {
      if (logFilter !== 'all' && entry.type !== logFilter) return false;
      if (logDateFilter === 'today' && now - Number(entry.time || 0) > 24 * 60 * 60 * 1000) return false;
      if (logDateFilter === 'week' && now - Number(entry.time || 0) > 7 * 24 * 60 * 60 * 1000) return false;
      if (!query) return true;
      return [entry.title, entry.detail, entry.type].some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [logEntries, logFilter, logDateFilter, logSearch]);

  useEffect(() => {
    localStorage.setItem('logEntries', JSON.stringify(logEntries.slice(0, 200)));
  }, [logEntries]);

  const formatLogTime = useCallback((timestamp) => {
    try {
      return new Date(timestamp).toLocaleString(isPersian ? 'fa-IR' : 'en-US');
    } catch {
      return '';
    }
  }, [isPersian]);

  const logStats = useMemo(() => {
    const latest = logEntries[0] || null;
    return {
      total: logEntries.length,
      visible: filteredLogs.length,
      latestTitle: latest ? latest.title : texts.logNoLatest,
      latestTime: latest ? formatLogTime(latest.time) : '',
    };
  }, [filteredLogs.length, formatLogTime, logEntries, texts]);

  const downloadTextFile = useCallback((filename, content, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, []);

  const handleExportLogsJson = () => {
    if (!filteredLogs.length) return;
    const payload = JSON.stringify(filteredLogs, null, 2);
    downloadTextFile(`pulsenet-logs-${Date.now()}.json`, payload, 'application/json;charset=utf-8');
  };

  const handleExportLogsCsv = () => {
    if (!filteredLogs.length) return;
    const escapeCsv = (value) => {
      const asText = String(value ?? '');
      return `"${asText.replace(/"/g, '""')}"`;
    };
    const header = ['id', 'type', 'title', 'detail', 'time', 'displayTime'].join(',');
    const rows = filteredLogs.map((entry) => {
      return [
        escapeCsv(entry.id),
        escapeCsv(entry.type),
        escapeCsv(entry.title),
        escapeCsv(entry.detail),
        escapeCsv(entry.time),
        escapeCsv(formatLogTime(entry.time)),
      ].join(',');
    });
    downloadTextFile(
      `pulsenet-logs-${Date.now()}.csv`,
      `${header}\n${rows.join('\n')}`,
      'text/csv;charset=utf-8'
    );
  };

  const handleExportSettings = () => {
    const payload = {
      version: 1,
      allHosts,
      activeProfile,
      pingIntervalMs,
      optimizationEnabled,
      compactMode,
      customDnsServers,
      dnsBenchmarkRounds,
      speedProvider,
      showPublicIp,
      closeAction,
      betaUpdates,
      autoCheckUpdates,
      displayName,
      locale: isPersian ? 'fa' : 'en',
    };
    downloadTextFile(`pulsenet-settings-${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  };

  const handleImportSettingsClick = () => {
    importSettingsInputRef.current?.click();
  };

  const handleImportSettingsFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1) throw new Error('invalid-settings');
      if (Array.isArray(parsed.allHosts)) {
        setAllHosts(parsed.allHosts);
        localStorage.setItem('allHosts', JSON.stringify(parsed.allHosts));
      }
      if (parsed.activeProfile) setActiveProfile(parsed.activeProfile);
      if (Number.isFinite(Number(parsed.pingIntervalMs))) setPingIntervalMs(Number(parsed.pingIntervalMs));
      if (typeof parsed.optimizationEnabled === 'boolean') setOptimizationEnabled(parsed.optimizationEnabled);
      if (typeof parsed.compactMode === 'boolean') setCompactMode(parsed.compactMode);
      if (Array.isArray(parsed.customDnsServers)) setCustomDnsServers(parsed.customDnsServers.map((item) => String(item).trim()).filter(Boolean));
      if (Number.isFinite(Number(parsed.dnsBenchmarkRounds))) setDnsBenchmarkRounds(Math.min(10, Math.max(1, Number(parsed.dnsBenchmarkRounds))));
      if (parsed.speedProvider) setSpeedProvider(parsed.speedProvider);
      if (typeof parsed.showPublicIp === 'boolean') setShowPublicIp(parsed.showPublicIp);
      if (parsed.closeAction) setCloseAction(parsed.closeAction);
      if (typeof parsed.betaUpdates === 'boolean') setBetaUpdates(parsed.betaUpdates);
      if (typeof parsed.autoCheckUpdates === 'boolean') setAutoCheckUpdates(parsed.autoCheckUpdates);
      if (parsed.displayName) {
        setDisplayName(parsed.displayName);
        setNameInput(parsed.displayName);
        localStorage.setItem('displayName', parsed.displayName);
      }
      if (parsed.locale === 'fa' || parsed.locale === 'en') {
        setIsPersian(parsed.locale === 'fa');
        localStorage.setItem('locale', parsed.locale);
      }
      addLogEntry({ type: 'action', title: texts.settingsImportDone, detail: file.name });
    } catch (error) {
      console.error('Failed to import settings:', error);
      addLogEntry({ type: 'alert', title: texts.settingsImportFailed, detail: file.name });
    }
  };

  const handleOpenDeveloperGithub = useCallback((event) => {
    event.preventDefault();
    openUrl('https://github.com/SM8KE1');
  }, []);







  return (
    <div className={`app-shell ${isSortingHosts ? 'sorting-active' : ''} ${compactMode ? 'compact' : ''} ${isWindowMaximized ? 'maximized' : ''}`}>
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <button
            type="button"
            className="sidebar-team sidebar-team-clickable"
            onClick={() => setCurrentPage('about')}
            aria-label="Open About"
          >
            <div className="sidebar-team-logo">
              <img src={iconIco} alt="PulseNet" className="sidebar-team-icon" />
            </div>
            <div className="sidebar-team-info">
              <div className="sidebar-team-name">PulseNet</div>
              <div className="sidebar-team-plan">
                {currentPage === 'ping'
                  ? texts.monitoring
                  : currentPage === 'dns'
                    ? texts.dnsChecker
                    : currentPage === 'speed'
                      ? texts.speedTest
                      : currentPage === 'network'
                        ? texts.networkUsage
                        : currentPage === 'log'
                          ? texts.alerts
                          : currentPage === 'about'
                            ? texts.about
                            : texts.settings}
              </div>
            </div>
            <span className="sidebar-team-about-icon" aria-hidden="true">
              <img src={aboutIcon} alt="" className="sidebar-team-about-icon-img" />
            </span>
          </button>
          <button className="sidebar-collapse" onClick={toggleSidebarCollapse} aria-label="Toggle sidebar">
            <span className="collapse-line"></span>
            <span className="collapse-line"></span>
          </button>
        </div>
        <div className="sidebar-content">
          <div className="sidebar-group">
            <div className="sidebar-group-label">{texts.platform}</div>
            <div className="sidebar-menu">
              <button
                className={`sidebar-item ${currentPage === 'ping' ? 'active' : ''}`}
                onClick={() => setCurrentPage('ping')}
                data-tooltip={texts.ping}
                aria-label={texts.ping}
              >
                <span className="sidebar-item-icon" aria-hidden="true">
                  <img src={pingIcon} alt="" className="sidebar-item-icon-img" />
                </span>
                <span className="sidebar-item-text">{texts.ping}</span>
              </button>
              <button
                className={`sidebar-item ${currentPage === 'dns' ? 'active' : ''}`}
                onClick={() => setCurrentPage('dns')}
                data-tooltip={texts.dnsChecker}
                aria-label={texts.dnsChecker}
              >
                <span className="sidebar-item-icon" aria-hidden="true">
                  <img src={dnsIcon} alt="" className="sidebar-item-icon-img" />
                </span>
                <span className="sidebar-item-text">{texts.dnsChecker}</span>
              </button>
              <button
                className={`sidebar-item ${currentPage === 'speed' ? 'active' : ''}`}
                onClick={() => setCurrentPage('speed')}
                data-tooltip={texts.speedTest}
                aria-label={texts.speedTest}
              >
                <span className="sidebar-item-icon" aria-hidden="true">
                  <img src={speedIcon} alt="" className="sidebar-item-icon-img" />
                </span>
                <span className="sidebar-item-text">{texts.speedTest}</span>
              </button>
              <button
                className={`sidebar-item ${currentPage === 'network' ? 'active' : ''}`}
                onClick={() => setCurrentPage('network')}
                data-tooltip={texts.networkUsage}
                aria-label={texts.networkUsage}
              >
                <span className="sidebar-item-icon" aria-hidden="true">
                  <img src={nusageIcon} alt="" className="sidebar-item-icon-img" />
                </span>
                <span className="sidebar-item-text">{texts.networkUsage}</span>
              </button>
              <button
                className={`sidebar-item ${currentPage === 'log' ? 'active' : ''}`}
                onClick={() => setCurrentPage('log')}
                data-tooltip={texts.alerts}
                aria-label={texts.alerts}
              >
                <span className="sidebar-item-icon" aria-hidden="true">
                  <img src={logIcon} alt="" className="sidebar-item-icon-img" />
                </span>
                <span className="sidebar-item-text">{texts.alerts}</span>
              </button>
              <button
                className={`sidebar-item ${currentPage === 'settings' ? 'active' : ''}`}
                onClick={() => setCurrentPage('settings')}
                data-tooltip={texts.settings}
                aria-label={texts.settings}
              >
                <span className="sidebar-item-icon" aria-hidden="true">
                  <img src={settingIcon} alt="" className="sidebar-item-icon-img" />
                </span>
                <span className="sidebar-item-text">{texts.settings}</span>
              </button>
            </div>
          </div>
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{getInitials(displayName || 'User')}</div>
            <div className="sidebar-user-info">
              {isEditingName ? (
                <div className="sidebar-user-edit">
                  <input
                    className="sidebar-name-input"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveName();
                      if (e.key === 'Escape') handleCancelName();
                    }}
                    autoFocus
                  />
                  <div className="sidebar-name-actions">
                    <button className="sidebar-name-button" onClick={handleSaveName}>
                      OK
                    </button>
                    <button className="sidebar-name-button ghost" onClick={handleCancelName}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="sidebar-user-name-row">
                  <div className="sidebar-user-name">{displayName || 'User'}</div>
                  <button className="sidebar-name-edit" onClick={handleEditName} aria-label="Edit name">
                    <PencilIcon />
                  </button>
                </div>
              )}
              {appVersion && (
                <div className="sidebar-user-version">v{appVersion}</div>
              )}
            </div>
            <button
              type="button"
              className="sidebar-gift-button"
              onClick={handleDonateClick}
              data-tooltip={isPersian ? 'حمایت از پروژه' : 'Support PulseNet'}
              aria-label="Open gift link"
            >
              <GiftIcon />
            </button>
            {showDonateNudge && (
              <div className={`sidebar-donate-nudge ${isPersian ? 'rtl' : ''}`} role="status" aria-live="polite">
                <button
                  type="button"
                  className="sidebar-donate-close"
                  onClick={() => setShowDonateNudge(false)}
                  aria-label={isPersian ? 'بستن پیام حمایت' : 'Close support message'}
                >
                  ×
                </button>
                <strong>{isPersian ? 'حمایت از PulseNet' : 'Support PulseNet'}</strong>
                <span>
                  {isPersian
                    ? 'اگر برنامه به کارت اومد، می‌تونی توسعه‌اش رو حمایت کنی.'
                    : 'If PulseNet helps, you can support its development.'}
                </span>
              </div>
            )}
          </div>
        </div>
      </aside>
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left" data-tauri-drag-region>
          <img src={iconIco} alt="PulseNet" className="app-icon" />
          <div className="titlebar-title">PulseNet</div>
        </div>
        <div className="titlebar-controls">
          <button type="button" className="titlebar-button minimize" id="minimize-button" aria-label="Minimize">&#x2212;</button>
          <button
            type="button"
            className="titlebar-button maximize"
            id="maximize-button"
            aria-label={isWindowMaximized ? 'Restore window' : 'Maximize'}
          >
            <span className={`titlebar-maximize-icon ${isWindowMaximized ? 'restore' : ''}`} aria-hidden="true"></span>
          </button>
          <button type="button" className="titlebar-button close" id="close-button" aria-label="Close">&#x2715;</button>
        </div>
      </div>
      <div
        className={`container scrollbar ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}
        id="style-2"
        ref={scrollRef}
      >
        <div className="lenis-content">
          <div className="top-left-controls">
            <div id="github-button" className="icon-button">
              <GitHubIcon />
            </div>
            <ThemeToggle isDarkMode={isDarkMode} toggleTheme={toggleTheme} />
            <div className="icon-button">
              <TranslateToggle isActive={isPersian} onToggle={toggleLocale} />
            </div>
          </div>
          <h1>{pageTitle}</h1>

          <div key={`page-${currentPage}`} className="page-transition">
          {currentPage === 'ping' ? (
            <div id="ping-results">
            <div className="add-host-container">
              <div className="public-ip-widget" title={texts.publicIpLabel}>
                <div className="public-ip-info">
                  {isIran(publicNetworkInfo.country) ? (
                    <img src={iranFlag} alt="" className="public-ip-flag-img" />
                  ) : publicIpFlagClass ? (
                    <span className={`public-ip-flag ${publicIpFlagClass}`} aria-hidden="true"></span>
                  ) : (
                    <span className="public-ip-flag-fallback" aria-hidden="true">--</span>
                  )}
                  <span className="public-ip-value">{visiblePublicIp}</span>
                </div>
                <button
                  type="button"
                  className="public-ip-action"
                  onClick={loadPublicNetworkInfo}
                  aria-label={texts.publicIpRefresh}
                  title={texts.publicIpRefresh}
                  disabled={isPublicIpLoading}
                >
                  <RefreshIcon spinning={isPublicIpLoading} />
                </button>
                <button
                  type="button"
                  className="public-ip-action public-ip-action-visibility"
                  onClick={() => setShowPublicIp((prev) => !prev)}
                  aria-label={showPublicIp ? texts.publicIpHide : texts.publicIpShow}
                  title={showPublicIp ? texts.publicIpHide : texts.publicIpShow}
                >
                  {showPublicIp ? <EyeOffIcon className="public-ip-visibility-icon" /> : <EyeOpenIcon className="public-ip-visibility-icon" />}
                </button>
              </div>
              <div className="add-host-actions">
                <button className="add-host-button" onClick={handleAddNewHost}>
                  <PencilIcon />
                  {texts.add}
                </button>
                <button
                  className={`edit-host-button ${isEditMode ? 'active' : ''}`}
                  onClick={() => setIsEditMode(!isEditMode)}
                >
                  <EditIcon />
                  {texts.edit}
                </button>
              </div>
            </div>
            <div className="profile-strip">
              <span>{texts.profiles}</span>
              {['gaming', 'work', 'streaming', 'iran'].map((profileKey) => (
                <button
                  key={profileKey}
                  type="button"
                  className={`profile-chip ${activeProfile === profileKey ? 'active' : ''}`}
                  onClick={() => applyProfile(profileKey)}
                >
                  {texts[`profile${profileKey.charAt(0).toUpperCase()}${profileKey.slice(1)}`]}
                </button>
              ))}
            </div>
            {isEditMode && <div className="reorder-hint">{texts.reorderHint}</div>}

            {/* All Hosts with dnd-kit drag and drop */}
            {/* Editing Host - outside of SortableContext */}
            {editingHost && (
              <SortableItem
                key="editing-temp"
                id="editing-temp"
                label={editingHost.label}
                host={editingHost.host}
                editing={true}
                onSave={handleSaveHost}
                onCancel={handleCancelEdit}
                texts={texts}
                statusTexts={statusTexts}
                pingIntervalMs={pingIntervalMs}
                optimizationEnabled={optimizationEnabled}
                onLog={addLogEntry}
                pingAlertThresholdMs={pingAlertThresholdMs}
                packetLossAlertThreshold={packetLossAlertThreshold}
              />
            )}

            {/* All Hosts with dnd-kit drag and drop */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <SortableContext
                items={hostItems.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                {hostItems.map(({ host, id }) => (
                <SortableItem
                  key={id}
                  id={id}
                  label={host.label}
                  host={host.host}
                  showDelete={isEditMode}
                  isEditMode={isEditMode}
                  isSorting={isSortingHosts}
                  isDragSource={activeDragId === id}
                  isPinned={Boolean(host.pinned)}
                  isPaused={Boolean(host.paused)}
                  isCopied={copyFeedbackKey === `ping-${id}`}
                  onTogglePin={handleToggleHostPin}
                  onTogglePause={handleToggleHostPause}
                  onCopy={(hostId, value) => handleCopyText(value, `ping-${hostId}`)}
                  onDelete={() => handleDeleteHost(host)}
                  texts={texts}
                  statusTexts={statusTexts}
                  pingIntervalMs={pingIntervalMs}
                  optimizationEnabled={optimizationEnabled}
                  onLog={addLogEntry}
                  pingAlertThresholdMs={pingAlertThresholdMs}
                  packetLossAlertThreshold={packetLossAlertThreshold}
                />
              ))}
              </SortableContext>
              {typeof document !== 'undefined'
                ? createPortal(
                    <DragOverlay dropAnimation={DRAG_OVERLAY_DROP_ANIMATION}>
                      {activeDragHost ? (
                        <DragPreviewCard
                          label={activeDragHost.label}
                          host={activeDragHost.host}
                          moveText={texts.dragPreviewMove}
                        />
                      ) : null}
                    </DragOverlay>,
                    document.body
                  )
                : null}
            </DndContext>
          </div>
        ) : currentPage === 'dns' ? (
          <div className="dns-page">
            <div className="dns-tool-tabs">
              <button
                className={`dns-tool-tab ${dnsToolMode === 'test' ? 'active' : ''}`}
                onClick={() => setDnsToolMode('test')}
              >
                {texts.dnsToolTest}
              </button>
              <button
                className={`dns-tool-tab ${dnsToolMode === 'manager' ? 'active' : ''}`}
                onClick={() => setDnsToolMode('manager')}
              >
                {texts.dnsToolManager}
              </button>
            </div>
            {dnsError && <div className="dns-error">{dnsError}</div>}
            {dnsToolMode === 'test' ? (
              <div className="dns-test-layout">
                <div className="dns-panel dns-query-panel">
                  <div className="dns-input-row">
                    <input
                      className="dns-input"
                      placeholder={texts.dnsPlaceholder}
                      value={dnsDomain}
                      onChange={(e) => setDnsDomain(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleDnsTest()}
                      disabled={dnsLoading || dnsBenchmarkLoading || batchLoading}
                    />
                    <div className="dns-primary-actions">
                      <button
                        className="dns-button"
                        onClick={handleDnsTest}
                        disabled={dnsLoading || dnsBenchmarkLoading || batchLoading}
                      >
                        {dnsLoading ? texts.dnsTesting : texts.dnsTest}
                      </button>
                      <button
                        className="dns-button secondary"
                        onClick={handleDnsBenchmark}
                        disabled={dnsLoading || dnsBenchmarkLoading || batchLoading}
                      >
                        {dnsBenchmarkLoading ? texts.dnsBenchmarking : texts.dnsBenchmark}
                      </button>
                    </div>
                    <div className="dns-rounds">
                      <span>{texts.dnsBenchmarkRounds}</span>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={dnsBenchmarkRounds}
                        onChange={handleBenchmarkRoundsChange}
                        disabled={dnsLoading || dnsBenchmarkLoading || batchLoading}
                      />
                    </div>
                  </div>
                  <div className="dns-custom-tools">
                    <div className="dns-custom-title">{texts.dnsCustomTitle}</div>
                    <div className="dns-custom-row">
                      <input
                        className="dns-input dns-custom-input"
                        placeholder={texts.dnsCustomPlaceholder}
                        value={customDnsInput}
                        onChange={(event) => setCustomDnsInput(event.target.value)}
                        onKeyDown={(event) => event.key === 'Enter' && handleAddCustomDns()}
                        disabled={dnsLoading || dnsBenchmarkLoading || batchLoading}
                      />
                      <button
                        className="dns-button dns-custom-add"
                        onClick={handleAddCustomDns}
                        disabled={dnsLoading || dnsBenchmarkLoading || batchLoading}
                      >
                        {texts.dnsAddServer}
                      </button>
                    </div>
                    {customDnsServers.length === 0 ? (
                      <div className="dns-custom-empty">{texts.dnsCustomEmpty}</div>
                    ) : (
                      <div className="dns-custom-list">
                        {customDnsServers.map((server) => (
                          <button
                            key={`custom-dns-${server}`}
                            type="button"
                            className="dns-custom-chip"
                            onClick={() => handleRemoveCustomDns(server)}
                            title={texts.deleteTitle(server)}
                          >
                            <span>{server}</span>
                            <span className="dns-custom-chip-x">x</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {topFastestDns.length > 0 && (
                  <div className="dns-panel dns-benchmark">
                    <div className="dns-benchmark-title">{texts.dnsTopFastest}</div>
                    {dnsRecommendation && (
                      <div className="dns-recommendation">
                        <div>
                          <strong>{texts.dnsRecommendation}</strong>
                          <span>
                            {dnsRecommendation.primary.server}
                            {dnsRecommendation.secondary ? ` + ${dnsRecommendation.secondary.server}` : ''}
                          </span>
                        </div>
                        <button
                          className="dns-button secondary"
                          type="button"
                          onClick={handleApplyRecommendedDns}
                          disabled={dnsManagerLoading}
                        >
                          {texts.dnsApplyRecommended}
                        </button>
                      </div>
                    )}
                    <div className="dns-benchmark-grid">
                      {topFastestDns.map((item) => (
                        <div key={`bench-${item.server}`} className="dns-benchmark-card">
                          <div className="dns-benchmark-main">{item.server}</div>
                          <div className="dns-benchmark-meta">
                            {texts.dnsAverage} {Math.round(item.averageMs)}ms
                          </div>
                          <div className="dns-benchmark-meta">
                            {texts.dnsSuccessRate} {item.successRate}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(dnsResults.length > 0 || dnsLoading) && (
                  <div className="dns-panel dns-table-wrap">
                    <div className="dns-summary">
                      <span className="dns-summary-good">{texts.usable} ({usableDns.length})</span>
                      <span className="dns-summary-bad">{texts.blocked} ({blockedDns.length})</span>
                    </div>
                    <div className="dns-table-toolbar">
                      <input
                        className="dns-table-search"
                        value={dnsSearch}
                        onChange={(event) => setDnsSearch(event.target.value)}
                        placeholder={texts.dnsSearchPlaceholder}
                        disabled={dnsLoading}
                      />
                      <div className="dns-table-filters">
                        <button
                          type="button"
                          className={`dns-table-filter ${dnsStatusFilter === 'all' ? 'active' : ''}`}
                          onClick={() => setDnsStatusFilter('all')}
                        >
                          {texts.logAll}
                        </button>
                        <button
                          type="button"
                          className={`dns-table-filter ${dnsStatusFilter === 'usable' ? 'active' : ''}`}
                          onClick={() => setDnsStatusFilter('usable')}
                        >
                          {texts.usable}
                        </button>
                        <button
                          type="button"
                          className={`dns-table-filter ${dnsStatusFilter === 'blocked' ? 'active' : ''}`}
                          onClick={() => setDnsStatusFilter('blocked')}
                        >
                          {texts.blocked}
                        </button>
                      </div>
                      <AppDropdown
                        className="dns-table-sort"
                        value={dnsSortKey}
                        onChange={setDnsSortKey}
                        options={dnsSortOptions}
                      />
                    </div>
                    <div className="dns-table">
                      <div className="dns-table-head">
                        <span>{texts.dnsTableServer}</span>
                        <span>{texts.dnsTableLatency}</span>
                        <span>{texts.dnsTableStatus}</span>
                        <span>{texts.dnsTableActions}</span>
                      </div>
                      <div className="dns-table-body">
                        {dnsLoading ? (
                          Array.from({ length: 6 }).map((_, index) => (
                            <div key={`dns-skeleton-${index}`} className="dns-table-row skeleton">
                              <span className="skeleton-line"></span>
                              <span className="skeleton-line short"></span>
                              <span className="skeleton-line short"></span>
                              <span className="skeleton-line short"></span>
                            </div>
                          ))
                        ) : dnsTableRows.length === 0 ? (
                          <div className="dns-table-empty">{texts.dnsTableEmpty}</div>
                        ) : (
                          dnsTableRows.map((item, index) => (
                            <div key={`dns-row-${item.server}-${item.status ? 'ok' : 'blocked'}-${Math.round(item.latencyMs ?? -1)}-${index}`} className="dns-table-row">
                              <span className="dns-row-server">{item.server}</span>
                              <span className="dns-row-latency">
                                {Number.isFinite(item.latencyMs) ? `${Math.round(item.latencyMs)}ms` : '--'}
                              </span>
                              <span className={`status-pill ${item.status ? 'good' : 'bad'}`}>
                                {item.status ? texts.usable : texts.blocked}
                              </span>
                              <button
                                type="button"
                                className={`dns-copy-btn ${copyFeedbackKey === `dns-${item.server}` ? 'active' : ''}`}
                                onClick={() => handleCopyText(item.server, `dns-${item.server}`)}
                              >
                                {copyFeedbackKey === `dns-${item.server}` ? texts.copied : texts.copy}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
                <div className="dns-panel dns-batch">
                  <div className="dns-batch-title">{texts.dnsBatchTitle}</div>
                  <textarea
                    className="dns-batch-input"
                    placeholder={texts.dnsBatchPlaceholder}
                    value={batchDomainsInput}
                    onChange={(event) => setBatchDomainsInput(event.target.value)}
                    disabled={dnsLoading || dnsBenchmarkLoading || batchLoading}
                  />
                  <button
                    className="dns-button dns-batch-button"
                    onClick={handleBatchDomains}
                    disabled={dnsLoading || dnsBenchmarkLoading || batchLoading}
                  >
                    {batchLoading ? texts.dnsBatchRunning : texts.dnsBatchRun}
                  </button>
                  {batchResults.length > 0 && (
                    <div className="dns-batch-results">
                      {batchResults.map((item) => (
                        <div
                          key={`batch-${item.domain}`}
                          className={`dns-batch-card ${item.status === 'resolved' ? 'resolved' : 'unresolved'}`}
                        >
                          <div className="dns-batch-main">{item.domain}</div>
                          <div className="dns-batch-meta">
                            {item.status === 'resolved' ? texts.dnsResolved : texts.dnsUnresolved}
                          </div>
                          <div className="dns-batch-meta">
                            {texts.usable}: {item.usableCount} | {texts.blocked}: {item.blockedCount}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="dns-manager">
                <div className="dns-manager-header">
                  <div className="dns-manager-title">{texts.dnsManagerTitle}</div>
                  <button
                    className="dns-button secondary dns-manager-refresh"
                    onClick={() => loadDnsAdapters(true)}
                    disabled={dnsManagerLoading}
                  >
                    {texts.dnsManagerRefresh}
                  </button>
                </div>
                <div className="dns-manager-layout">
                  <div className="dns-manager-form">
                    <div className="dns-manager-row">
                      <label>{texts.dnsManagerAdapter}</label>
                      <div className="dns-manager-controls">
                        <AppDropdown
                          className="dns-manager-select"
                          value={dnsSelectedAdapter}
                          onChange={(selected) => {
                            setDnsSelectedAdapter(selected);
                            const adapter = dnsAdapters.find((item) => getDnsAdapterKey(item) === selected);
                            if (adapter) {
                              setDnsPrimaryInput(adapter.dns?.[0] || '');
                              setDnsSecondaryInput(adapter.dns?.[1] || '');
                            }
                          }}
                          disabled={dnsManagerLoading || dnsAdapters.length === 0}
                          options={
                            dnsAdapters.length === 0
                              ? [{ value: '', label: texts.dnsManagerNoAdapters }]
                              : dnsAdapters.map((adapter) => ({
                                value: getDnsAdapterKey(adapter),
                                label: adapter.name,
                              }))
                          }
                          placeholder={texts.dnsManagerNoAdapters}
                        />
                      </div>
                    </div>
                    <div className="dns-manager-row">
                      <label>{texts.dnsManagerPrimary}</label>
                      <input
                        className="dns-input dns-manager-input"
                        value={dnsPrimaryInput}
                        onChange={(event) => setDnsPrimaryInput(event.target.value)}
                        disabled={dnsManagerLoading || !dnsSelectedAdapter}
                      />
                    </div>
                    <div className="dns-manager-row">
                      <label>{texts.dnsManagerSecondary}</label>
                      <input
                        className="dns-input dns-manager-input"
                        value={dnsSecondaryInput}
                        onChange={(event) => setDnsSecondaryInput(event.target.value)}
                        disabled={dnsManagerLoading || !dnsSelectedAdapter}
                      />
                    </div>
                    <div className="dns-manager-actions">
                      <button
                        className="dns-button"
                        onClick={handleApplySystemDns}
                        disabled={dnsManagerLoading || !dnsSelectedAdapter}
                      >
                        {texts.dnsManagerApply}
                      </button>
                      <button
                        className="dns-button secondary dns-manager-reset"
                        onClick={handleResetSystemDns}
                        disabled={dnsManagerLoading || !dnsSelectedAdapter}
                      >
                        {texts.dnsManagerReset}
                      </button>
                    </div>
                    {dnsManagerStatus && <div className="dns-manager-status">{dnsManagerStatus}</div>}
                  </div>
                  <div className="dns-manager-side">
                    {selectedAdapterDetails && (
                      <div className="adapter-details">
                        <span>{texts.adapterCurrentDns}: {(selectedAdapterDetails.dns || []).join(', ') || 'DHCP'}</span>
                        {selectedAdapterDetails.ipv4 && <span>{texts.adapterIpv4}: {selectedAdapterDetails.ipv4}</span>}
                        {selectedAdapterDetails.gateway && <span>{texts.adapterGateway}: {selectedAdapterDetails.gateway}</span>}
                        {selectedAdapterDetails.status && <span>{texts.adapterStatus}: {selectedAdapterDetails.status}</span>}
                      </div>
                    )}
                    <div className="dns-manager-actions secondary-row">
                      <button
                        className="dns-button secondary"
                        type="button"
                        onClick={handleApplyRecommendedDns}
                        disabled={dnsManagerLoading || !dnsRecommendation}
                      >
                        {texts.dnsApplyRecommended}
                      </button>
                      <button
                        className="dns-button secondary dns-manager-reset"
                        type="button"
                        onClick={handleRollbackDns}
                        disabled={dnsManagerLoading || !lastDnsBackup}
                      >
                        {texts.dnsRollback}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : currentPage === 'speed' ? (
          <div className="speed-page">
            <div className="speed-console">
              <div className="speed-console-main">
                <div className="speed-provider-switch">
                  <span className="speed-provider-label">{texts.speedProviderTitle}</span>
                  <div className="speed-provider-tabs">
                    <button
                      className={`speed-provider-tab ${speedProvider === 'cloudflare' ? 'active' : ''}`}
                      onClick={() => setSpeedProvider('cloudflare')}
                      disabled={speedLoading}
                    >
                      {texts.speedProviderCloudflare}
                    </button>
                    <button
                      className={`speed-provider-tab ${speedProvider === 'hetzner' ? 'active' : ''}`}
                      onClick={() => setSpeedProvider('hetzner')}
                      disabled={speedLoading}
                    >
                      {texts.speedProviderHetzner}
                    </button>
                  </div>
                </div>
                <div className={`speed-phase ${speedPhase}`}>
                  <span className="speed-phase-dot"></span>
                  {speedPhaseLabel}
                </div>
                <button
                  className={`speed-play ${speedLoading ? 'loading' : ''}`}
                  onClick={speedLoading ? handleStopSpeed : handleStartSpeed}
                  aria-label={speedLoading ? 'Stop speed test' : 'Start speed test'}
                >
                  <span className="speed-play-ring"></span>
                  <span className="speed-play-icon">
                    {speedLoading ? <img src={pauseIcon} alt="" className="speed-play-icon-img" /> : <img src={playIcon} alt="" className="speed-play-icon-img" />}
                  </span>
                  <span className="speed-play-label">
                    {speedLoading ? (texts.speedStop || 'Stop') : texts.speedStart}
                  </span>
                </button>
              </div>

              <div className="speed-console-side">
                <div className="speed-overview-head">
                  <span>{texts.speedOverview}</span>
                  <strong className={`speed-quality ${speedQuality.tone}`}>{speedQuality.label}</strong>
                </div>
                <div className="speed-primary-results">
                  <div className="speed-primary-metric download">
                    <span>{texts.speedDownload}</span>
                    <strong>{speedMetrics ? speedMetrics.downloadMbps : '--'}</strong>
                    <em>Mbps</em>
                  </div>
                  <div className="speed-primary-metric upload">
                    <span>{texts.speedUpload}</span>
                    <strong>{speedMetrics ? speedMetrics.uploadMbps : '--'}</strong>
                    <em>Mbps</em>
                  </div>
                </div>
                <div className="speed-details-grid">
                  <div className="speed-detail">
                    <span>{texts.speedLatency}</span>
                    <strong>{speedMetrics ? speedMetrics.latencyMs : '--'} <em>ms</em></strong>
                  </div>
                  <div className="speed-detail">
                    <span>{texts.speedJitter}</span>
                    <strong>{speedMetrics ? speedMetrics.jitterMs : '--'} <em>ms</em></strong>
                  </div>
                  <div className="speed-detail wide">
                    <span>{texts.speedPublicIp}</span>
                    <strong>
                      {speedMetrics && isIran(speedMetrics.country) ? (
                        <img src={iranFlag} alt="" className="speed-ip-flag-img" />
                      ) : (
                        <span
                          className={`speed-ip-flag ${speedMetrics ? getFlagClass(speedMetrics.country) : ''}`}
                          aria-hidden="true"
                        ></span>
                      )}
                      {speedMetrics ? speedMetrics.ip : '--'}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
            <div className="speed-note">
              <div className="speed-note-title">
                {speedProvider === 'hetzner' ? texts.speedProviderHetzner : texts.speedProviderCloudflare}
              </div>
              <div className="speed-note-body">{texts.speedNote}</div>
            </div>
          </div>
        ) : currentPage === 'network' ? (
          <div className="network-page">
            <div className="network-header-panel">
              <div className="network-identity">
                <span className="network-page-icon" aria-hidden="true">
                  <img src={nusageIcon} alt="" />
                </span>
                <div>
                  <div className="network-kicker">{texts.networkUsage}</div>
                  <div className="network-subtitle">{texts.networkMonitorSubtitle}</div>
                </div>
              </div>
              <div className="network-header-actions">
                <span className="network-live-pill">
                  <i aria-hidden="true"></i>
                  1s
                </span>
              </div>
            </div>

            {networkError && (
              <div className="network-error">
                {texts.networkUnavailable} {networkError}
              </div>
            )}

            <div className="network-overview-grid">
              <div className="network-throughput-card">
                <div className="network-throughput-head">
                  <div>
                    <span>{texts.networkDownloadLive}</span>
                    <strong>{formatByteRate(networkUsageStats.downloadRate)}</strong>
                  </div>
                  <div>
                    <span>{texts.networkUploadLive}</span>
                    <strong>{formatByteRate(networkUsageStats.uploadRate)}</strong>
                  </div>
                </div>
                <div className="network-throughput-rail" aria-hidden="true">
                  <span
                    className="down"
                    style={{ width: `${Math.min(100, Math.max(4, networkUsageStats.downloadRate ? (networkUsageStats.downloadRate / Math.max(networkUsageStats.downloadRate + networkUsageStats.uploadRate, 1)) * 100 : 0))}%` }}
                  ></span>
                  <span
                    className="up"
                    style={{ width: `${Math.min(100, Math.max(4, networkUsageStats.uploadRate ? (networkUsageStats.uploadRate / Math.max(networkUsageStats.downloadRate + networkUsageStats.uploadRate, 1)) * 100 : 0))}%` }}
                  ></span>
                </div>
                <div className="network-live-summary">
                  <span>{networkUsageStats.activeAdapters}/{networkUsageStats.adapters.length} {texts.networkAdapters}</span>
                  <span>{networkUsageStats.activeProcesses} {texts.networkProcesses}</span>
                </div>
              </div>

              <div className="network-total-stack">
                <div className="network-metric-card">
                  <span>{texts.networkTotalReceived}</span>
                  <strong>{formatBytes(networkUsageStats.totalReceived)}</strong>
                </div>
                <div className="network-metric-card">
                  <span>{texts.networkTotalSent}</span>
                  <strong>{formatBytes(networkUsageStats.totalSent)}</strong>
                </div>
              </div>
            </div>

            <div className="network-content-grid">
              <div className="network-overview-column">
                <div className="network-panel">
                <div className="network-panel-head">
                  <div className="network-panel-title">{texts.networkAdapters}</div>
                  <span>{networkUsageStats.adapters.length}</span>
                </div>
                {networkUsageStats.adapters.length === 0 ? (
                  <div className="network-empty">{texts.networkNoAdapters}</div>
                ) : (
                  <div className="network-adapter-list">
                    {networkUsageStats.adapters.map((adapter) => {
                      const adapterRate = Number(adapter.downloadRate || 0) + Number(adapter.uploadRate || 0);
                      const adapterShare = networkUsageStats.maxAdapterRate
                        ? Math.min(100, Math.max(3, (adapterRate / networkUsageStats.maxAdapterRate) * 100))
                        : 0;
                      return (
                        <div className="network-adapter-row" key={adapter.name}>
                          <div className="network-adapter-top">
                            <div className="network-adapter-main">
                              <strong>{adapter.name}</strong>
                              <span>{formatBytes(adapter.receivedBytes)} / {formatBytes(adapter.sentBytes)}</span>
                            </div>
                            <div className="network-adapter-rates">
                              <span className="down">{formatByteRate(adapter.downloadRate)}</span>
                              <span className="up">{formatByteRate(adapter.uploadRate)}</span>
                            </div>
                          </div>
                          <div className="network-adapter-meter" aria-hidden="true">
                            <span style={{ width: `${adapterShare}%` }}></span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                </div>
                <section
                  className="network-panel network-download-chart-card"
                  onMouseLeave={() => setHoveredNetworkApplicationId('')}
                >
                  <div className="network-download-chart-head">
                    <div>
                      <strong>{texts.networkAppDownloadTitle}</strong>
                      <span>{texts.networkAppDownloadSubtitle}</span>
                    </div>
                    <div className="network-download-chart-actions">
                      <em title={texts.networkAppDownloadTracked}>
                        {formatBytes(networkUsageStats.applicationDownloadTotal)}
                      </em>
                      <button
                        type="button"
                        className="network-download-reset"
                        onClick={resetNetworkApplicationUsage}
                        disabled={networkUsageResetting}
                        aria-label={texts.networkAppDownloadReset}
                        title={texts.networkAppDownloadReset}
                      >
                        <RefreshIcon spinning={networkUsageResetting} />
                      </button>
                    </div>
                  </div>
                  {networkUsageStats.applicationUsage.length === 0 ? (
                    <div className="network-download-chart-empty">
                      <span className="network-download-empty-ring" aria-hidden="true"></span>
                      <span>{texts.networkAppDownloadEmpty}</span>
                    </div>
                  ) : (
                    <div className="network-download-chart-layout">
                      <div className="network-download-donut">
                        <svg viewBox="0 0 120 120" role="img" aria-label={texts.networkAppDownloadTitle}>
                          <circle className="network-download-donut-track" cx="60" cy="60" r="46" />
                          {networkUsageStats.applicationUsage.map((application) => {
                            const segmentLength = Math.max(
                              0,
                              application.share * NETWORK_DOWNLOAD_CHART_CIRCUMFERENCE - 2.5
                            );
                            return (
                              <circle
                                key={`download-segment-${application.id}`}
                                className={`network-download-donut-segment ${highlightedNetworkApplication?.id === application.id ? 'active' : ''}`}
                                cx="60"
                                cy="60"
                                r="46"
                                stroke={application.color}
                                strokeDasharray={`${segmentLength} ${NETWORK_DOWNLOAD_CHART_CIRCUMFERENCE - segmentLength}`}
                                strokeDashoffset={-application.offset * NETWORK_DOWNLOAD_CHART_CIRCUMFERENCE}
                                onMouseEnter={() => setHoveredNetworkApplicationId(application.id)}
                              >
                                <title>{`${application.name}: ${formatBytes(application.downloadBytes)} (${Math.round(application.share * 100)}%)`}</title>
                              </circle>
                            );
                          })}
                        </svg>
                        {highlightedNetworkApplication && (
                          <div className="network-download-donut-center" aria-live="polite">
                            <span className="network-download-center-icon">
                              {highlightedNetworkApplication.iconDataUrl ? (
                                <img src={highlightedNetworkApplication.iconDataUrl} alt="" />
                              ) : (
                                <strong>
                                  {Array.from(highlightedNetworkApplication.name || '?').slice(0, 2).join('').toUpperCase()}
                                </strong>
                              )}
                            </span>
                            <strong>{highlightedNetworkApplication.name}</strong>
                            <span>{Math.round(highlightedNetworkApplication.share * 100)}%</span>
                          </div>
                        )}
                      </div>
                      <div className="network-download-legend">
                        {networkUsageStats.applicationUsage.map((application) => (
                          <button
                            type="button"
                            key={`download-legend-${application.id}`}
                            className={highlightedNetworkApplication?.id === application.id ? 'active' : ''}
                            style={{ '--chart-color': application.color }}
                            onMouseEnter={() => setHoveredNetworkApplicationId(application.id)}
                            onFocus={() => setHoveredNetworkApplicationId(application.id)}
                            aria-label={`${application.name}: ${formatBytes(application.downloadBytes)}, ${Math.round(application.share * 100)}%`}
                          >
                            <i aria-hidden="true"></i>
                            <span>
                              <strong>{application.name}</strong>
                              <em>{formatBytes(application.downloadBytes)}</em>
                            </span>
                            <b>{Math.round(application.share * 100)}%</b>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              </div>

              <div className="network-panel network-process-panel">
                <div className="network-panel-head">
                  <div className="network-panel-title">{texts.networkProcesses}</div>
                  <span>{networkUsageStats.processes.length}</span>
                </div>
                <div className={`limiter-engine-status ${bandwidthLimiterState.engine?.ready ? 'ready' : 'pending'}`}>
                  <span className="limiter-engine-dot" aria-hidden="true"></span>
                  <strong>
                    {bandwidthLimiterState.engine?.ready
                      ? texts.limiterEngineReady
                      : bandwidthLimiterState.engine?.running
                        ? texts.limiterServicePreparing
                        : bandwidthLimiterState.engine?.installed
                          ? texts.limiterServiceStopped
                          : texts.limiterSetupRequired}
                  </strong>
                  <em>{bandwidthLimiterState.rules?.length || 0}</em>
                </div>
                {!bandwidthLimiterState.engine?.ready && (
                  <div className="limiter-engine-hint">{texts.limiterStagedHint}</div>
                )}
                {bandwidthLimitFeedback && !bandwidthLimitModalProcess && (
                  <div className="limiter-inline-feedback">{bandwidthLimitFeedback}</div>
                )}
                <div className="network-process-tools">
                  <input
                    type="search"
                    value={networkProcessSearch}
                    onChange={(event) => setNetworkProcessSearch(event.target.value)}
                    placeholder={texts.networkSearchProcesses}
                    className="network-process-search"
                  />
                  <AppDropdown
                    value={networkProcessSort}
                    onChange={setNetworkProcessSort}
                    options={networkProcessSortOptions}
                    className="network-process-sort"
                    prefix={texts.networkSortBy}
                    ariaLabel={texts.networkSortBy}
                  />
                </div>
                {networkUsageStats.activeProcesses === 0 ? (
                  <div className="network-empty">
                    {texts.networkNoProcesses}
                    <span>{texts.networkLinuxProcessNote}</span>
                  </div>
                ) : networkUsageStats.processes.length === 0 ? (
                  <div className="network-empty">{texts.networkNoProcessMatches}</div>
                ) : (
                  <div className="network-process-list">
                    {visibleNetworkProcessGroups.map((group) => (
                      <div className="network-process-group" key={group.category}>
                        <div className="network-process-group-title">
                          <span>{group.label}</span>
                          <em>{networkUsageStats.processGroups.find((item) => item.category === group.category)?.processes.length || group.processes.length}</em>
                        </div>
                        {group.processes.map((process) => {
                          const isExpanded = Boolean(expandedNetworkProcesses[process.id]);
                          const processDetailsId = `network-process-details-${String(process.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
                          const processExecutablePath = (process.paths || [])[0] || '';
                          const limitRule = bandwidthRulesByPath.get(normalizeLimiterPath(processExecutablePath));
                          const remotes = (process.remoteAddresses || []).slice(0, 3).join(', ');
                          const pidLabel = process.grouped && process.pids.length > 1
                            ? `${texts.networkGroupedPids}: ${process.pids.slice(0, 4).join(', ')}${process.pids.length > 4 ? '...' : ''}`
                            : `${texts.networkPid}: ${process.pids[0] || '--'}`;
                          return (
                            <div className={`network-process-card ${process.status}`} key={process.id}>
                              <div className="network-process-card-main">
                                <div className="network-process-identity">
                                  <span className="network-process-app-icon">
                                    {process.iconDataUrl ? (
                                      <img src={process.iconDataUrl} alt="" />
                                    ) : (
                                      <strong>{Array.from(process.name || '?').slice(0, 2).join('').toUpperCase()}</strong>
                                    )}
                                  </span>
                                  <div className="network-process-name">
                                    <strong>{process.name}</strong>
                                    <span>{pidLabel}</span>
                                  </div>
                                </div>
                                <div className="network-process-badges">
                                  {limitRule && (
                                    <span className="network-process-limit-badge">
                                      {networkControlIsWindows
                                        ? bandwidthLimiterState.engine?.ready
                                          ? texts.limiterBlocked
                                          : texts.limiterStaged
                                        : bandwidthLimiterState.engine?.ready
                                          ? texts.limiterActive
                                          : texts.limiterStaged}
                                    </span>
                                  )}
                                  <span className={`network-process-status ${process.status}`}>{process.statusLabel}</span>
                                  <span className="network-process-count">{process.connections}</span>
                                </div>
                              </div>
                              <div className="network-process-preview">
                                <span>{texts.networkRemote}: {remotes || '--'}</span>
                              </div>
                              <div
                                id={processDetailsId}
                                className={`network-process-details-shell ${isExpanded ? 'expanded' : ''}`}
                                aria-hidden={!isExpanded}
                              >
                                <div className="network-process-details">
                                  <div>
                                    <span>{texts.networkConnections}</span>
                                    <strong>{process.connections}</strong>
                                  </div>
                                  <div>
                                    <span>{texts.networkRemote}</span>
                                    <strong>{(process.remoteAddresses || []).join(', ') || '--'}</strong>
                                  </div>
                                  {process.paths.length > 0 && (
                                    <div>
                                      <span>{texts.networkPath}</span>
                                      <strong>{process.paths.join(' | ')}</strong>
                                    </div>
                                  )}
                                  {limitRule && !networkControlIsWindows && (
                                    <div>
                                      <span>{texts.limiterTitle}</span>
                                      <strong>
                                        {limitRule.blocked
                                          ? texts.limiterBlocked
                                          : `↓ ${formatBandwidthLimit(limitRule.downloadLimitBps)} / ↑ ${formatBandwidthLimit(limitRule.uploadLimitBps)}`}
                                      </strong>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="network-process-card-actions">
                                <button
                                  type="button"
                                  className="network-process-limit-button"
                                  disabled={!processExecutablePath || bandwidthLimitSaving}
                                  onClick={() => networkControlIsWindows
                                    ? handleToggleApplicationBlock(process)
                                    : openBandwidthLimitModal(process)}
                                >
                                  {networkControlIsWindows
                                    ? limitRule?.blocked
                                      ? texts.limiterUnblockInternet
                                      : texts.limiterBlockInternet
                                    : limitRule
                                      ? texts.limiterEditLimit
                                      : texts.limiterSetLimit}
                                </button>
                                <button
                                  type="button"
                                  className="network-process-toggle"
                                  aria-expanded={isExpanded}
                                  aria-controls={processDetailsId}
                                  onClick={() => setExpandedNetworkProcesses((current) => ({
                                    ...current,
                                    [process.id]: !current[process.id],
                                  }))}
                                >
                                  {isExpanded ? texts.networkHideDetails : texts.networkDetails}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {canToggleNetworkProcesses && (
                      <button
                        type="button"
                        className="network-process-show-more"
                        onClick={() => setShowAllNetworkProcesses((current) => !current)}
                      >
                        {showAllNetworkProcesses
                          ? texts.networkShowLessProcesses
                          : `${texts.networkShowMoreProcesses} (${hiddenNetworkProcessCount})`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : currentPage === 'log' ? (
          <div className="log-page">
            <div className="log-console">
              <div className="log-overview-panel">
                <div className="log-section-title">{texts.logOverview}</div>
                <div className="log-stats">
                  <div className="log-stat">
                    <span>{texts.logTotal}</span>
                    <strong>{logStats.total}</strong>
                  </div>
                  <div className="log-stat">
                    <span>{texts.logFiltered}</span>
                    <strong>{logStats.visible}</strong>
                  </div>
                  <div className="log-stat latest">
                    <span>{texts.logLatest}</span>
                    <strong>{logStats.latestTitle}</strong>
                    {logStats.latestTime && <em>{logStats.latestTime}</em>}
                  </div>
                </div>
              </div>

              <div className="log-controls-panel">
                <div className="log-section-title">{texts.logControls}</div>
                <div className="log-filters">
                  {logFilterOptions.map((option) => (
                    <button
                      key={option.value}
                      className={`log-filter ${logFilter === option.value ? 'active' : ''}`}
                      onClick={() => setLogFilter(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="log-actions">
                  <input
                    className="log-search"
                    value={logSearch}
                    onChange={(event) => setLogSearch(event.target.value)}
                    placeholder={texts.logSearch}
                  />
                  <AppDropdown
                    className="log-date-filter"
                    value={logDateFilter}
                    onChange={setLogDateFilter}
                    options={[
                      { value: 'all', label: texts.logDateAll },
                      { value: 'today', label: texts.logDateToday },
                      { value: 'week', label: texts.logDateWeek },
                    ]}
                  />
                  <button className="log-clear" onClick={handleExportLogsJson} disabled={filteredLogs.length === 0}>
                    {texts.logExportJson}
                  </button>
                  <button className="log-clear" onClick={handleExportLogsCsv} disabled={filteredLogs.length === 0}>
                    {texts.logExportCsv}
                  </button>
                  <button className="log-clear danger" onClick={handleClearLogs} disabled={filteredLogs.length === 0}>
                    {texts.logClear}
                  </button>
                </div>
              </div>
            </div>

            <div className="log-timeline-panel">
              <div className="log-list-header">
                <div className="log-section-title">{texts.logTimeline}</div>
                <span className="log-visible-count">{logStats.visible}</span>
              </div>
              {filteredLogs.length === 0 ? (
                <div className="log-empty">{texts.logEmpty}</div>
              ) : (
                <div className="log-list">
                  {filteredLogs.map((entry) => (
                    <div key={entry.id} className={`log-item ${entry.type}`}>
                      <div className="log-item-main">
                        <div className="log-item-title">{entry.title}</div>
                        <div className="log-item-detail">{entry.detail}</div>
                      </div>
                      <div className="log-item-meta">
                        <span className={`log-badge ${entry.type}`}>{getLogTypeLabel(entry.type)}</span>
                        <span className="log-time">{formatLogTime(entry.time)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : currentPage === 'about' ? (
          <div className="about-page">
            <div className={`about-panel ${isPersian ? 'rtl' : 'ltr'}`}>
              <div className="about-hero">
                <div className="about-logo-mark">
                  <img src={iconIco} alt="" />
                </div>
                <div className="about-hero-copy">
                  <div className="about-kicker">PulseNet</div>
                  <h2>{texts.aboutDevTitle}</h2>
                  <p>{texts.aboutDevLine1} <strong>Arash Bayat</strong>.</p>
                </div>
              </div>
              <div className="about-info-grid">
                <div className="about-info-item">
                  <span>{texts.aboutProductLabel}</span>
                  <strong>PulseNet</strong>
                </div>
                <div className="about-info-item">
                  <span>{texts.aboutVersionLabel}</span>
                  <strong>{appVersion ? `v${appVersion}` : 'N/A'}</strong>
                </div>
                <div className="about-info-item">
                  <span>{texts.aboutDeveloperLabel}</span>
                  <strong>Arash Bayat</strong>
                </div>
                <div className="about-info-item">
                  <span>{texts.aboutContactLabel}</span>
                  <strong>GitHub</strong>
                </div>
              </div>
              <div className="about-contact">
                <p>{texts.aboutDevLine2}</p>
                <a
                  href="https://github.com/SM8KE1"
                  target="_blank"
                  rel="noreferrer"
                  className="github-link"
                  onClick={handleOpenDeveloperGithub}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  {texts.aboutGithubLink}
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div className="settings-page">
            <div className="settings-grid">
              <div className="settings-card">
                <div className="settings-card-title">{texts.settingsGeneral}</div>
                <div className="settings-item">
                  <div className="settings-label">
                    <div className="settings-name">{texts.settingsAutoLaunch}</div>
                    <div className="settings-hint">{texts.settingsAutoLaunchHint}</div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={autoLaunch}
                      onChange={handleToggleAutoLaunch}
                    />
                    <span className="settings-slider"></span>
                  </label>
                </div>
                <div className="settings-item">
                  <div className="settings-label">
                    <div className="settings-name">{texts.closeActionTitle}</div>
                    <div className="settings-hint">{texts.closeActionHint}</div>
                  </div>
                  <AppDropdown
                    className="settings-select"
                    value={closeAction}
                    onChange={setCloseAction}
                    options={[
                      { value: 'hide', label: texts.closeActionHide },
                      { value: 'exit', label: texts.closeActionExit },
                      { value: 'ask', label: texts.closeActionAsk },
                    ]}
                  />
                </div>
                <div className="settings-item">
                  <div className="settings-label">
                    <div className="settings-name">{texts.settingsCompactMode}</div>
                    <div className="settings-hint">{texts.settingsCompactModeHint}</div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={compactMode}
                      onChange={(event) => setCompactMode(event.target.checked)}
                    />
                    <span className="settings-slider"></span>
                  </label>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-card-title">{texts.settingsMonitoring}</div>
                <div className="settings-item">
                  <div className="settings-label">
                    <div className="settings-name">{texts.settingsOptimization}</div>
                    <div className="settings-hint">{texts.settingsOptimizationHint}</div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={optimizationEnabled}
                      onChange={handleToggleOptimization}
                    />
                    <span className="settings-slider"></span>
                  </label>
                </div>
                <div className="settings-item">
                  <div className="settings-label">
                    <div className="settings-name">{texts.settingsPingInterval}</div>
                    <div className="settings-hint">{texts.settingsPingIntervalHint}</div>
                  </div>
                  <input
                    className="settings-input"
                    type="number"
                    min="250"
                    step="250"
                    value={pingIntervalMs}
                    onChange={handlePingIntervalChange}
                  />
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-card-title">{texts.settingsUpdates}</div>
                <div className="settings-item">
                  <div className="settings-label">
                    <div className="settings-name">{texts.settingsUpdateTitle}</div>
                    <div className="settings-hint">
                      {updateStatus || texts.settingsUpdateHint}
                    </div>
                  </div>
                  <button className="settings-button" onClick={handleCheckUpdates}>
                    {texts.settingsUpdateButton}
                  </button>
                </div>
                <div className="settings-item">
                  <div className="settings-label">
                    <div className="settings-name">{texts.settingsAutoUpdateCheck}</div>
                    <div className="settings-hint">{texts.settingsAutoUpdateCheckHint}</div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={autoCheckUpdates}
                      onChange={(event) => setAutoCheckUpdates(event.target.checked)}
                    />
                    <span className="settings-slider"></span>
                  </label>
                </div>
                <div className="settings-item">
                  <div className="settings-label">
                    <div className="settings-name">{texts.settingsBetaUpdate}</div>
                    <div className="settings-hint">{texts.settingsBetaUpdateHint}</div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={betaUpdates}
                      onChange={(event) => setBetaUpdates(event.target.checked)}
                    />
                    <span className="settings-slider"></span>
                  </label>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-card-title">{texts.settingsBackup}</div>
                <div className="settings-item settings-item-stack">
                  <div className="settings-label">
                    <div className="settings-name">{texts.settingsBackup}</div>
                    <div className="settings-hint">{texts.settingsBackupHint}</div>
                  </div>
                  <div className="settings-actions">
                    <button className="settings-button" onClick={handleExportSettings}>
                      {texts.settingsExport}
                    </button>
                    <button className="settings-button secondary" onClick={handleImportSettingsClick}>
                      {texts.settingsImport}
                    </button>
                    <input
                      ref={importSettingsInputRef}
                      className="hidden-file-input"
                      type="file"
                      accept="application/json"
                      onChange={handleImportSettingsFile}
                    />
                  </div>
                </div>
              </div>
            </div>
            {updateModalOpen && (
              <div className="update-modal">
                <div className="update-modal-backdrop" onClick={handleUpdateDismiss}></div>
                <div className="update-modal-card">
                  <div className="update-modal-title">{texts.updateModalTitle}</div>
                  <div className="update-modal-body">
                    {texts.updateModalBody}
                    {updateInfo && updateInfo.latestVersion ? ` (${updateInfo.latestVersion})` : ''}
                    {updateInfo && updateInfo.isPrerelease ? (
                      <div className="update-modal-warning">{texts.updateModalPrereleaseWarning}</div>
                    ) : null}
                  </div>
                  <div className="update-modal-actions">
                    <button className="update-modal-button primary" onClick={handleUpdateDownload}>
                      {texts.updateModalYes}
                    </button>
                    <button className="update-modal-button" onClick={handleUpdateDismiss}>
                      {texts.updateModalNo}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          )}
          </div>
        </div>
      </div>
      {bandwidthLimitModalProcess && !networkControlIsWindows && (
        <div className="bandwidth-limit-modal" role="dialog" aria-modal="true" aria-labelledby="bandwidth-limit-title">
          <button
            type="button"
            className="bandwidth-limit-backdrop"
            aria-label={texts.limiterCancel}
            onClick={closeBandwidthLimitModal}
          ></button>
          <div className="bandwidth-limit-card">
            <div className="bandwidth-limit-heading">
              <div>
                <span>{texts.limiterTitle}</span>
                <strong id="bandwidth-limit-title">{bandwidthLimitModalProcess.name}</strong>
              </div>
              <button type="button" onClick={closeBandwidthLimitModal} aria-label={texts.limiterCancel}>×</button>
            </div>
            <div className="bandwidth-limit-path">{bandwidthLimitModalProcess.executablePath}</div>
            <label className="bandwidth-limit-block-toggle">
              <span>
                <strong>{texts.limiterBlockInternet}</strong>
                <em>{texts.limiterBlocked}</em>
              </span>
              <input
                type="checkbox"
                checked={bandwidthLimitForm.blocked}
                onChange={(event) => setBandwidthLimitForm((current) => ({
                  ...current,
                  blocked: event.target.checked,
                }))}
              />
            </label>
            <div className="bandwidth-limit-fields">
              <label>
                <span>{texts.limiterDownload} <em>{texts.limiterOptional}</em></span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={bandwidthLimitForm.download}
                  disabled={bandwidthLimitForm.blocked}
                  onChange={(event) => setBandwidthLimitForm((current) => ({ ...current, download: event.target.value }))}
                />
              </label>
              <label>
                <span>{texts.limiterUpload} <em>{texts.limiterOptional}</em></span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={bandwidthLimitForm.upload}
                  disabled={bandwidthLimitForm.blocked}
                  onChange={(event) => setBandwidthLimitForm((current) => ({ ...current, upload: event.target.value }))}
                />
              </label>
            </div>
            <div className="bandwidth-limit-unit">
              <span>{texts.limiterUnit}</span>
              <AppDropdown
                className="bandwidth-limit-unit-select"
                value={bandwidthLimitForm.unit}
                disabled={bandwidthLimitForm.blocked}
                onChange={handleBandwidthLimitUnitChange}
                options={bandwidthUnitOptions}
                ariaLabel={texts.limiterUnit}
              />
            </div>
            {!bandwidthLimiterState.engine?.ready && (
              <div className="bandwidth-limit-notice">{texts.limiterStagedHint}</div>
            )}
            {bandwidthLimitFeedback && (
              <div className="bandwidth-limit-error">{bandwidthLimitFeedback}</div>
            )}
            <div className="bandwidth-limit-actions">
              {bandwidthLimitModalProcess.existingRule && (
                <button
                  type="button"
                  className="danger"
                  disabled={bandwidthLimitSaving}
                  onClick={handleRemoveBandwidthLimit}
                >
                  {texts.limiterRemove}
                </button>
              )}
              <span></span>
              <button type="button" disabled={bandwidthLimitSaving} onClick={closeBandwidthLimitModal}>
                {texts.limiterCancel}
              </button>
              <button
                type="button"
                className="primary"
                disabled={bandwidthLimitSaving}
                onClick={handleSaveBandwidthLimit}
              >
                {texts.limiterApply}
              </button>
            </div>
          </div>
        </div>
      )}
      {closeModalOpen && (
        <div className="close-modal">
          <div className="close-modal-backdrop" onClick={() => setCloseModalOpen(false)}></div>
          <div className="close-modal-card">
            <div className="close-modal-title">{texts.closeModalTitle}</div>
            <label className="close-modal-remember">
              <span>{texts.closeModalRemember}</span>
              <input
                type="checkbox"
                checked={closeRememberChoice}
                onChange={(event) => setCloseRememberChoice(event.target.checked)}
              />
            </label>
            <div className="close-modal-actions">
              <button className="close-modal-button primary" onClick={() => handleCloseChoice('hide')}>
                {texts.closeActionHide}
              </button>
              <button className="close-modal-button ghost" onClick={() => handleCloseChoice('exit')}>
                {texts.closeActionExit}
              </button>
            </div>
          </div>
        </div>
      )}
      {adminModalOpen && (
        <div className="close-modal">
          <div className="close-modal-backdrop"></div>
          <div className="close-modal-card">
            <div className="close-modal-title">{texts.adminNoticeTitle}</div>
            <div className="close-modal-remember">{texts.adminNoticeBody}</div>
            <div className="close-modal-actions">
              <button className="close-modal-button primary" onClick={handleAdminNoticeClose}>
                {texts.adminNoticeOk}
              </button>
            </div>
          </div>
        </div>
      )}
      {firstRunOpen && !adminModalOpen && (
        <div className="close-modal">
          <div className="close-modal-backdrop"></div>
          <div className="close-modal-card setup-card">
            <div className="close-modal-title">{texts.firstRunTitle}</div>
            <div className="setup-grid">
              {['gaming', 'work', 'streaming', 'iran'].map((profileKey) => (
                <button
                  key={`setup-${profileKey}`}
                  className="setup-profile"
                  type="button"
                  onClick={() => handleFirstRunProfile(profileKey)}
                >
                  <strong>{texts[`profile${profileKey.charAt(0).toUpperCase()}${profileKey.slice(1)}`]}</strong>
                  <span>{texts[`profile${profileKey.charAt(0).toUpperCase()}${profileKey.slice(1)}Hint`]}</span>
                </button>
              ))}
            </div>
            <div className="close-modal-actions">
              <button
                className="close-modal-button ghost"
                onClick={() => {
                  localStorage.setItem('firstRunSetupDone', 'true');
                  setFirstRunOpen(false);
                }}
              >
                {texts.firstRunSkip}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
