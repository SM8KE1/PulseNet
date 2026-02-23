import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Lenis from 'lenis';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/api/shell';
import 'flag-icons/css/flag-icons.min.css';
import ThemeToggle from './ThemeToggle';
import GitHubIcon from './GitHubIcon';
import iconIco from '../../assets/icon.ico';
import iranFlag from '../../assets/iran.svg';
import earthA from '../../assets/earth-a.svg';
import earthB from '../../assets/earth-b.svg';
import dnsIcon from '../../assets/dns.svg';
import pingIcon from '../../assets/ping.svg';
import playIcon from '../../assets/play.svg';
import pauseIcon from '../../assets/pause.svg';
import speedIcon from '../../assets/speed.svg';
import logIcon from '../../assets/log.svg';
import settingIcon from '../../assets/setting.svg';
import aboutIcon from '../../assets/about.svg';
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
        // Fallback to default hosts if parsing fails
        setAllHosts([
          { type: 'default', label: 'Google DNS', host: '8.8.8.8' },
          { type: 'default', label: 'Cloudflare DNS', host: '1.1.1.1' },
          { type: 'default', label: 'Time.ir', host: 'time.ir' },
          { type: 'default', label: 'YouTube', host: 'youtube.com' },
        ]);
      }
    } else {
      // Initialize with default hosts
      const defaultHosts = [
        { type: 'default', label: 'Google DNS', host: '8.8.8.8' },
        { type: 'default', label: 'Cloudflare DNS', host: '1.1.1.1' },
        { type: 'default', label: 'Time.ir', host: 'time.ir' },
        { type: 'default', label: 'YouTube', host: 'youtube.com' },
      ];
      setAllHosts(defaultHosts);
      localStorage.setItem('allHosts', JSON.stringify(defaultHosts));
    }
  }, []);

  const addHost = (host) => {
    const newHost = { type: 'custom', id: Date.now(), pinned: false, paused: false, ...host };
    const newHosts = [newHost, ...allHosts];
    setAllHosts(newHosts);
    localStorage.setItem('allHosts', JSON.stringify(newHosts));
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
          setPingData({
            status: statusTexts.noResponse,
            hasError: true,
            timeMs: null,
            errorKind: 'no-response',
          });
        } else {
          pushHistory(result.time);
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
  const { status, hasError, timeMs, errorKind, history, isPending } = usePing(
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
  }, [onLog, isEditMode, hasError, errorKind, timeMs, pingAlertThresholdMs, label, host, status, texts]);

  const handleSave = () => {
    if (editLabel.trim() && editHost.trim()) {
      onSave(editLabel.trim(), editHost.trim());
    }
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
      className={`app-dropdown ${open ? 'open' : ''} ${disabled ? 'disabled' : ''} ${className}`.trim()}
    >
      <button
        type="button"
        className="app-dropdown-trigger"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
      >
        <span className="app-dropdown-text">{selected?.label || placeholder}</span>
        <span className="app-dropdown-chevron" aria-hidden="true"></span>
      </button>
      <div className="app-dropdown-menu">
        {options.map((item) => (
          <button
            key={`drop-${item.value}`}
            type="button"
            className={`app-dropdown-item ${item.value === value ? 'active' : ''}`}
            onClick={() => {
              if (item.value !== value) onChange(item.value);
              setOpen(false);
            }}
          >
            {item.label}
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
  const [appVersion, setAppVersion] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [currentPage, setCurrentPage] = useState('ping');
  const [pingIntervalMs, setPingIntervalMs] = useState(() => {
    const saved = localStorage.getItem('pingIntervalMs');
    return saved ? Number(saved) : 2000;
  });
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
  const [betaUpdates, setBetaUpdates] = useState(() => {
    const saved = localStorage.getItem('betaUpdates');
    return saved === 'true';
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
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closeRememberChoice, setCloseRememberChoice] = useState(false);
  const [adminModalOpen, setAdminModalOpen] = useState(false);
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
  const logAlertCooldownRef = useRef({});
  const copyTimerRef = useRef(0);
  const [copyFeedbackKey, setCopyFeedbackKey] = useState('');
  const [activeDragId, setActiveDragId] = useState(null);
  const lastOverIdRef = useRef(null);
  const lenisRef = useRef(null);

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
    localStorage.setItem('speedProvider', speedProvider);
  }, [speedProvider]);

  useEffect(() => {
    localStorage.setItem('betaUpdates', String(betaUpdates));
  }, [betaUpdates]);

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
        const exists = normalized.some((item) => item.name === current);
        const selectedName = exists ? current : normalized[0].name;
        const selected = normalized.find((item) => item.name === selectedName);
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
          detail: `${dnsSelectedAdapter} • ${dnsPrimaryInput.trim()}${dnsSecondaryInput.trim() ? `, ${dnsSecondaryInput.trim()}` : ''}`,
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

  const handleResetSystemDns = async () => {
    if (!dnsSelectedAdapter) return;
    setDnsManagerLoading(true);
    setDnsManagerStatus('');
    try {
      const result = await invoke('reset_adapter_dns', { adapterName: dnsSelectedAdapter });
      if (result && result.success) {
        setDnsManagerStatus(texts.dnsManagerResetDone);
        addLogEntry({
          type: 'dns',
          title: texts.logDnsResult,
          detail: `${dnsSelectedAdapter} • DHCP`,
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
            detail: `${result.downloadMbps} Mbps ↓ • ${result.uploadMbps} Mbps ↑ • ${result.latencyMs} ms${countryPart}`,
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
    localStorage.setItem('autoLaunch', String(next));
    try {
      const updated = await invoke('set_auto_launch', { enabled: next });
      setAutoLaunch(Boolean(updated));
    } catch (error) {
      console.error('Failed to update auto-launch:', error);
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

  const handleCheckUpdates = async () => {
    setUpdateStatus(texts.updateChecking);
    try {
      const result = await invoke('check_for_updates', { includePrerelease: betaUpdates });
      if (result && result.error) {
        setUpdateStatus(texts.updateFailed);
        return;
      }
      if (result && result.updateAvailable) {
        setUpdateInfo(result);
        setUpdateModalOpen(true);
        setUpdateStatus('');
        return;
      }
      setUpdateStatus(texts.updateUpToDate);
    } catch (error) {
      console.error('Failed to check updates:', error);
      setUpdateStatus(texts.updateFailed);
    }
  };

  const handleUpdateDownload = async () => {
    if (!updateInfo || !updateInfo.url) {
      setUpdateModalOpen(false);
      return;
    }
    try {
      await open(updateInfo.url);
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

  useEffect(() => {
    const minimizeBtn = document.getElementById('minimize-button');
    const closeBtn = document.getElementById('close-button');
    const githubBtn = document.getElementById('github-button');
    const handleMinimize = () => invoke('perform_close_action', { action: 'minimize' });
    const handleClose = () => requestCloseFlow();
    const handleGithub = () => open('https://github.com/SM8KE1/PulseNet');

    minimizeBtn.addEventListener('click', handleMinimize);
    closeBtn.addEventListener('click', handleClose);
    githubBtn.addEventListener('click', handleGithub);

    return () => {
      minimizeBtn.removeEventListener('click', handleMinimize);
      closeBtn.removeEventListener('click', handleClose);
      githubBtn.removeEventListener('click', handleGithub);
    };
  }, [requestCloseFlow]);

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
      alerts: 'Log',
      settings: 'Settings',
      logAll: 'All',
      logSpeed: 'Speed Test',
      logAlerts: 'Alerts',
      logDns: 'DNS',
      logExportJson: 'Export JSON',
      logExportCsv: 'Export CSV',
      logEmpty: 'No logs yet.',
      logClear: 'Clear logs',
      logSpeedComplete: 'Speed test completed',
      logDnsResult: 'DNS test result',
      logDnsFailed: 'DNS test failed',
      logDnsBenchmark: 'DNS benchmark',
      logDomainBatch: 'Domain batch check',
      logPingAlert: 'Ping alert',
      logPingHighLatency: 'High latency',
      settingsGeneral: 'General',
      settingsAutoLaunch: 'Auto launch',
      settingsAutoLaunchHint: 'Start app when Windows boots',
      settingsPingInterval: 'Ping interval (ms)',
      settingsPingIntervalHint: 'How often pings refresh',
      settingsOptimization: 'Optimization',
      settingsOptimizationHint: 'Disable sparkline to reduce CPU usage',
      settingsUpdateTitle: 'Check Update Now',
      settingsUpdateHint: 'Compare your version with GitHub',
      settingsUpdateButton: 'Check',
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
      monitoring: 'Monitoring',
      add: 'Add',
      edit: 'Edit',
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
      speedNote: 'Note: If you use IP-changing tools, enable the Tunnel option in the tool settings to show updates.',
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
      dnsToolTest: '\u062a\u0633\u062a DNS',
      dnsToolManager: '\u0645\u062f\u06cc\u0631 DNS',
      speedTest: '\u062a\u0633\u062a \u0633\u0631\u0639\u062a',
      alerts: '\u0644\u0627\u06af',
      settings: '\u062a\u0646\u0638\u06cc\u0645\u0627\u062a',
      logAll: '\u0647\u0645\u0647',
      logSpeed: '\u062a\u0633\u062a \u0633\u0631\u0639\u062a',
      logAlerts: '\u0647\u0634\u062f\u0627\u0631\u0647\u0627',
      logDns: 'DNS',
      logExportJson: '\u062e\u0631\u0648\u062c\u06cc JSON',
      logExportCsv: '\u062e\u0631\u0648\u062c\u06cc CSV',
      logEmpty: '\u0647\u0646\u0648\u0632 \u0644\u0627\u06af\u06cc \u062b\u0628\u062a \u0646\u0634\u062f\u0647 \u0627\u0633\u062a.',
      logClear: '\u067e\u0627\u06a9 \u06a9\u0631\u062f\u0646 \u0644\u0627\u06af\u200c\u0647\u0627',
      logSpeedComplete: '\u067e\u0627\u06cc\u0627\u0646 \u062a\u0633\u062a \u0633\u0631\u0639\u062a',
      logDnsResult: '\u0646\u062a\u06cc\u062c\u0647 \u062a\u0633\u062a DNS',
      logDnsFailed: '\u062e\u0637\u0627 \u062f\u0631 \u062a\u0633\u062a DNS',
      logDnsBenchmark: '\u0628\u0646\u0686\u0645\u0627\u0631\u06a9 DNS',
      logDomainBatch: '\u0628\u0631\u0631\u0633\u06cc \u062f\u0633\u062a\u0647\u200c\u0627\u06cc \u062f\u0627\u0645\u0646\u0647',
      logPingAlert: '\u0647\u0634\u062f\u0627\u0631 \u067e\u06cc\u0646\u06af',
      logPingHighLatency: '\u062a\u0627\u062e\u06cc\u0631 \u0628\u0627\u0644\u0627',
      settingsGeneral: '\u0639\u0645\u0648\u0645\u06cc',
      settingsAutoLaunch: '\u0627\u062c\u0631\u0627\u06cc \u062e\u0648\u062f\u06a9\u0627\u0631',
      settingsAutoLaunchHint: '\u0628\u0627 \u0631\u0648\u0634\u0646 \u0634\u062f\u0646 \u0648\u06cc\u0646\u062f\u0648\u0632 \u0627\u062c\u0631\u0627 \u0634\u0648\u062f',
      settingsPingInterval: '\u0628\u0627\u0632\u0647 \u067e\u06cc\u0646\u06af (\u0645\u06cc\u0644\u06cc \u062b\u0627\u0646\u06cc\u0647)',
      settingsPingIntervalHint: '\u0641\u0627\u0635\u0644\u0647 \u0628\u0647 \u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06cc \u067e\u06cc\u0646\u06af',
      settingsOptimization: 'بهینه سازی',
      settingsOptimizationHint: '\u0628\u0631\u0627\u06cc \u06a9\u0627\u0647\u0634 \u0645\u0635\u0631\u0641 CPU \u0646\u0645\u0648\u062f\u0627\u0631 \u062e\u0637\u06cc \u062e\u0627\u0645\u0648\u0634 \u0645\u06cc\u200c\u0634\u0648\u062f',
      settingsUpdateTitle: '\u0628\u0631\u0631\u0633\u06cc \u0622\u067e\u062f\u06cc\u062a',
      settingsUpdateHint: '\u0645\u0642\u0627\u06cc\u0633\u0647 \u0648\u0631\u0698\u0646 \u0628\u0627 \u06af\u06cc\u062a \u0647\u0627\u0628',
      settingsUpdateButton: '\u0628\u0631\u0631\u0633\u06cc',
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
      monitoring: 'Monitoring',
      add: '\u0627\u0641\u0632\u0648\u062f\u0646',
      edit: '\u0648\u06cc\u0631\u0627\u06cc\u0634',
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
      speedNote: '\u0646\u06a9\u062a\u0647 : \u0627\u06af\u0631 \u0627\u0632 \u0627\u0628\u0632\u0627\u0631 \u0647\u0627\u06cc \u062a\u063a\u06cc\u06cc\u0631 \u0622\u06cc\u067e\u06cc \u0627\u0633\u062a\u0641\u0627\u062f\u0647 \u0645\u06cc\u06a9\u0646\u06cc\u062f \u0628\u0631\u0627\u06cc \u0646\u0645\u0627\u06cc\u0634 \u062a\u063a\u06cc\u06cc\u0631\u0627\u062a \u06af\u0632\u06cc\u0646\u0647 \u062a\u0648\u0646\u0644 \u0631\u0648 \u062f\u0631 \u062a\u0646\u0638\u06cc\u0645\u0627\u062a \u0627\u0628\u0632\u0627\u0631 \u0631\u0648\u0634\u0646 \u06a9\u0646\u06cc\u062f',
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

  const speedPhaseLabel = useMemo(() => {
    if (speedPhase === 'download') return texts.speedPhaseDownload;
    if (speedPhase === 'upload') return texts.speedPhaseUpload;
    if (speedPhase === 'final') return texts.speedPhaseFinal;
    return texts.speedPhaseIdle;
  }, [speedPhase, texts]);

  const pageTitle = useMemo(() => {
    if (currentPage === 'dns') return 'DNS Checker';
    if (currentPage === 'speed') return 'Speed Test';
    if (currentPage === 'log') return 'Log';
    if (currentPage === 'about') return 'About';
    if (currentPage === 'settings') return 'Settings';
    return 'PulseNet';
  }, [currentPage]);

  const filteredLogs = useMemo(() => {
    if (logFilter === 'all') return logEntries;
    return logEntries.filter((entry) => entry.type === logFilter);
  }, [logEntries, logFilter]);

  useEffect(() => {
    if (logEntries.some((entry) => entry.type === 'action')) {
      setLogEntries((prev) => {
        const next = prev.filter((entry) => entry.type !== 'action');
        localStorage.setItem('logEntries', JSON.stringify(next));
        return next;
      });
    }
  }, [logEntries]);

  const formatLogTime = useCallback((timestamp) => {
    try {
      return new Date(timestamp).toLocaleString(isPersian ? 'fa-IR' : 'en-US');
    } catch {
      return '';
    }
  }, [isPersian]);

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

  const handleOpenDeveloperGithub = useCallback((event) => {
    event.preventDefault();
    open('https://github.com/SM8KE1');
  }, []);







  return (
    <div className={`app-shell ${isSortingHosts ? 'sorting-active' : ''}`}>
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
                    ? 'Checking DNS'
                    : currentPage === 'speed'
                      ? 'Speed Test'
                      : currentPage === 'log'
                        ? 'Log'
                        : currentPage === 'about'
                          ? 'About'
                          : 'Settings'}
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
          </div>
        </div>
      </aside>
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left" data-tauri-drag-region>
          <img src={iconIco} alt="PulseNet" className="app-icon" />
          <div className="titlebar-title">PulseNet</div>
        </div>
        <div className="titlebar-controls">
          <div className="titlebar-button minimize" id="minimize-button">&#x2212;</div>
          <div className="titlebar-button close" id="close-button">&#x2715;</div>
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
              <>
                <div className="dns-input-row">
                  <input
                    className="dns-input"
                    placeholder={texts.dnsPlaceholder}
                    value={dnsDomain}
                    onChange={(e) => setDnsDomain(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleDnsTest()}
                    disabled={dnsLoading || dnsBenchmarkLoading || batchLoading}
                  />
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
                {topFastestDns.length > 0 && (
                  <div className="dns-benchmark">
                    <div className="dns-benchmark-title">{texts.dnsTopFastest}</div>
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
                  <div className="dns-table-wrap">
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
                <div className="dns-batch">
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
              </>
            ) : (
              <div className="dns-manager">
                <div className="dns-manager-title">{texts.dnsManagerTitle}</div>
                <div className="dns-manager-row">
                  <label>{texts.dnsManagerAdapter}</label>
                  <div className="dns-manager-controls">
                    <AppDropdown
                      className="dns-manager-select"
                      value={dnsSelectedAdapter}
                      onChange={(selected) => {
                        setDnsSelectedAdapter(selected);
                        const adapter = dnsAdapters.find((item) => item.name === selected);
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
                            value: adapter.name,
                            label: adapter.name,
                          }))
                      }
                      placeholder={texts.dnsManagerNoAdapters}
                    />
                    <button
                      className="dns-button secondary dns-manager-refresh"
                      onClick={() => loadDnsAdapters(true)}
                      disabled={dnsManagerLoading}
                    >
                      {texts.dnsManagerRefresh}
                    </button>
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
            )}
          </div>
        ) : currentPage === 'speed' ? (
          <div className="speed-page">
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
            <div className={`speed-phase ${speedPhase}`}>{speedPhaseLabel}</div>
            {(!speedStarted || speedLoading) ? (
              <div className="speed-start">
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
            ) : (
              <div className={`speed-results ${speedLoading ? 'loading' : 'done'}`}>
                <div className="speed-gauge">
                  <div className="speed-ring"></div>
                  <div className="speed-ring-fill"></div>
                  <button
                    className="speed-control speed-control-button"
                    type="button"
                    onClick={handleStartSpeed}
                    aria-label="Start speed test"
                  >
                    <div className="speed-control-icon">
                      {speedLoading ? <img src={pauseIcon} alt="" className="speed-control-icon-img" /> : <img src={playIcon} alt="" className="speed-control-icon-img" />}
                    </div>
                    <div className="speed-control-label">
                      {speedLoading ? (texts.speedStop || 'Stop') : texts.speedStart}
                    </div>
                  </button>
                </div>
                <div className="speed-info">
                  <div className="speed-info-item single">
                    <span>IP</span>
                    <strong>
                      {speedMetrics && isIran(speedMetrics.country) ? (
                        <img src={iranFlag} alt="" className="speed-ip-flag-img" />
                      ) : (
                        <span
                          className={`speed-ip-flag ${speedMetrics ? getFlagClass(speedMetrics.country) : ''}`}
                          aria-hidden="true"
                        ></span>
                      )}
                      {speedMetrics ? speedMetrics.ip : 'N/A'}
                    </strong>
                  </div>
                </div>
                <div className="speed-cards">
                  <div className="speed-card">
                    <div className="speed-card-title">{texts.speedUpload}</div>
                    <div className="speed-card-value">{speedMetrics ? speedMetrics.uploadMbps : 'N/A'} <span>Mbps</span></div>
                  </div>
                  <div className="speed-card">
                    <div className="speed-card-title">{texts.speedDownload}</div>
                    <div className="speed-card-value">{speedMetrics ? speedMetrics.downloadMbps : 'N/A'} <span>Mbps</span></div>
                  </div>
                  <div className="speed-card">
                    <div className="speed-card-title">{texts.speedJitter}</div>
                    <div className="speed-card-value">{speedMetrics ? speedMetrics.jitterMs : 'N/A'} <span>Ms</span></div>
                  </div>
                  <div className="speed-card">
                    <div className="speed-card-title">{texts.speedLatency}</div>
                    <div className="speed-card-value">{speedMetrics ? speedMetrics.latencyMs : 'N/A'} <span>Ms</span></div>
                  </div>
                </div>
              </div>
            )}
            <div className="speed-note">
              <div className="speed-note-title">
                {speedProvider === 'hetzner' ? texts.speedProviderHetzner : texts.speedProviderCloudflare}
              </div>
              <div className="speed-note-body">{texts.speedNote}</div>
            </div>
          </div>
        ) : currentPage === 'log' ? (
          <div className="log-page">
            <div className="log-header">
              <div className="log-filters">
              <button
                className={`log-filter ${logFilter === 'all' ? 'active' : ''}`}
                onClick={() => setLogFilter('all')}
              >
                {texts.logAll}
              </button>
              <button
                className={`log-filter ${logFilter === 'speed' ? 'active' : ''}`}
                onClick={() => setLogFilter('speed')}
              >
                {texts.logSpeed}
              </button>
              <button
                className={`log-filter ${logFilter === 'alert' ? 'active' : ''}`}
                onClick={() => setLogFilter('alert')}
              >
                {texts.logAlerts}
              </button>
              <button
                className={`log-filter ${logFilter === 'dns' ? 'active' : ''}`}
                onClick={() => setLogFilter('dns')}
              >
                {texts.logDns}
              </button>
              </div>
              <div className="log-actions">
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
                      <span className={`log-badge ${entry.type}`}>
                        {entry.type === 'speed'
                          ? texts.logSpeed
                          : entry.type === 'alert'
                            ? texts.logAlerts
                            : texts.logDns}
                      </span>
                      <span className="log-time">{formatLogTime(entry.time)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : currentPage === 'about' ? (
          <div className="about-page">
            <div className={`developer-content ${isPersian ? 'rtl' : 'ltr'}`}>
              <h4>{texts.aboutDevTitle}</h4>
              <p>{texts.aboutDevLine1} <strong>Arash Bayat</strong>.</p>
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
        ) : (
          <div className="settings-page">
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
      {closeModalOpen && (
        <div className="close-modal">
          <div className="close-modal-backdrop" onClick={() => setCloseModalOpen(false)}></div>
          <div className="close-modal-card">
            <div className="close-modal-title">?Hide or Exit the application</div>
            <label className="close-modal-remember">
              <span>Remember my choice</span>
              <input
                type="checkbox"
                checked={closeRememberChoice}
                onChange={(event) => setCloseRememberChoice(event.target.checked)}
              />
            </label>
            <div className="close-modal-actions">
              <button className="close-modal-button primary" onClick={() => handleCloseChoice('hide')}>
                Hide
              </button>
              <button className="close-modal-button ghost" onClick={() => handleCloseChoice('exit')}>
                Exit
              </button>
            </div>
          </div>
        </div>
      )}
      {adminModalOpen && (
        <div className="close-modal">
          <div className="close-modal-backdrop"></div>
          <div className="close-modal-card">
            <div className="close-modal-title">
              This application uses the ICMP protocol to receive ping responses from servers; therefore, it needs to be run with administrator privileges.
            </div>
            <div className="close-modal-actions">
              <button className="close-modal-button primary" onClick={handleAdminNoticeClose}>
                Okey
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

