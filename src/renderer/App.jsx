Warning: truncated output (original token count: 56807)
Total output lines: 5229

import React, { memo, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Lenis from 'lenis';
import Lottie from 'lottie-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getCurrentWindow } from '@tauri-apps/api/window';
import 'flag-icons/css/flag-icons.min.css';
import ThemeToggle from './ThemeToggle';
import GitHubIcon from './GitHubIcon';
import {
  compareNetworkProcesses,
  hasActiveBandwidthLimit,
  normalizeLimiterPath,
} from './networkUsage.mjs';
import {
  BANDWIDTH_UNIT_FACTORS,
  DONATE_NUDGE_DELAY_MS,
  DRAG_OVERLAY_DROP_ANIMATION,
  HOST_PROFILES,
  NETWORK_DOWNLOAD_CHART_COLORS,
  buildNetworkDownloadSegments,
  NETWORK_PROCESS_PREVIEW_LIMIT,
  SPEED_PHASE_DOWNLOAD_DELAY_MS,
  buildSparklinePath,
  formatBandwidthLimit,
  formatByteRate,
  formatBytes,
  getDefaultHosts,
  getDnsAdapterKey,
  getLatencyTone,
  getNetworkProcessCategory,
  getNetworkProcessStatus,
  maskIpAddress,
  shouldGroupNetworkProcess,
} from './appCore.mjs';
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

const IS_LINUX_RUNTIME = typeof navigator !== 'undefined' && /Linux/i.test(navigator.userAgent);

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

const AnimatedRate = memo(({ value }) => {
  const initialRate = Math.max(0, Number(value) || 0);
  const [displayRate, setDisplayRate] = useState(initialRate);
  const displayRateRef = useRef(initialRate);

  useEffect(() => {
    const targetRate = Math.max(0, Number(value) || 0);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      displayRateRef.current = targetRate;
      setDisplayRate(targetRate);
      return undefined;
    }

    const startRate = displayRateRef.current;
    const startTime = performance.now();
    const durationMs = 850;
    let frameId = 0;
    const animate = (now) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      const easedProgress = 1 - ((1 - progress) ** 3);
      const nextRate = startRate + ((targetRate - startRate) * easedProgress);
      displayRateRef.current = nextRate;
      setDisplayRate(nextRate);
      if (progress < 1) frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frameId);
  }, [value]);

  return <strong aria-live="off">{formatByteRate(displayRate)}</strong>;
});

const App = () => {
  const [isDarkMode, setDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme ? savedTheme === 'dark' : true; // Default to dark if no preference saved
  });
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved ? saved === 'true' : true;
  });
  const [isWindowMaximize…44807 tokens truncated…  type="button"
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
                  <p>
                    {texts.aboutDevLine1} <strong>Arash Bayat</strong>
                    {isPersian ? ' \u0637\u0631\u0627\u062d\u06cc \u0648 \u062a\u0648\u0633\u0639\u0647 \u062f\u0627\u062f\u0647 \u0627\u0633\u062a.' : '.'}
                  </p>
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
                    {IS_LINUX_RUNTIME ? texts.updateLinuxBody : texts.updateModalBody}
                    {updateInfo && updateInfo.latestVersion ? ` (${updateInfo.latestVersion})` : ''}
                    {updateInfo && updateInfo.isPrerelease ? (
                      <div className="update-modal-warning">{texts.updateModalPrereleaseWarning}</div>
                    ) : null}
                  </div>
                  <div className="update-modal-actions">
                    {IS_LINUX_RUNTIME ? (
                      <>
                        <button
                          className="update-modal-button primary"
                          onClick={() => handleCopyText('sudo apt update && sudo apt install --only-upgrade pulse-net', 'update-apt-command')}
                        >
                          {copyFeedbackKey === 'update-apt-command' ? texts.copied : texts.updateLinuxCopyCommand}
                        </button>
                        <button className="update-modal-button" onClick={handleUpdateDownload}>
                          {texts.updateLinuxAction}
                        </button>
                      </>
                    ) : (
                      <button className="update-modal-button primary" onClick={handleUpdateDownload}>
                        {texts.updateModalYes}
                      </button>
                    )}
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
