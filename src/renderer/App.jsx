import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import {
  DndContext,
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
    const newHost = { type: 'custom', id: Date.now(), ...host };
    const newHosts = [newHost, ...allHosts];
    setAllHosts(newHosts);
    localStorage.setItem('allHosts', JSON.stringify(newHosts));
  };

  return { allHosts, setAllHosts, addHost };
};

const usePing = (host, statusTexts, intervalMs) => {
  const [pingData, setPingData] = useState({
    status: '--',
    hasError: false,
    timeMs: null,
    errorKind: null,
  });

  useEffect(() => {
    const ping = async () => {
      try {
        const result = await invoke('ping_host', { host });
        if (result.error) {
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
          setPingData({
            status: statusTexts.noResponse,
            hasError: true,
            timeMs: null,
            errorKind: 'no-response',
          });
        } else {
          setPingData({
            status: `${Math.round(result.time)}ms`,
            hasError: false,
            timeMs: result.time,
            errorKind: null,
          });
        }
      } catch (e) {
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

    return () => clearInterval(intervalId);
  }, [host, statusTexts, intervalMs]);

  return pingData;
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
  texts,
  statusTexts,
  pingIntervalMs,
  onLog,
  pingAlertThresholdMs,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const { status, hasError, timeMs, errorKind } = usePing(host, statusTexts, pingIntervalMs);
  const [editLabel, setEditLabel] = useState(label || '');
  const [editHost, setEditHost] = useState(host || '');
  const lastAlertRef = useRef(0);

  useEffect(() => {
    if (!onLog) return;
    const now = Date.now();
    const cooldownMs = 60_000;
    if (now - lastAlertRef.current < cooldownMs) return;

    if (hasError && errorKind && errorKind !== 'permission') {
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
  }, [onLog, hasError, errorKind, timeMs, pingAlertThresholdMs, label, host, status, texts]);

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
    transition: isDragging ? undefined : (transition || 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)'),
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
      className={`ping-card ${isDragging ? 'dragging' : ''} ${isEditMode ? 'edit-mode' : ''}`}
      {...attributes}
    >
      {isEditMode && (
        <div
          className="drag-handle active"
          {...listeners}
          title={texts.dragToReorder}
          style={{ cursor: 'grab' }}
        >
          <div className="drag-line"></div>
          <div className="drag-line"></div>
          <div className="drag-line"></div>
        </div>
      )}
      <div className="ping-info">
        <div className="ping-label">{label}</div>
        <div className="ping-ip">{host}</div>
      </div>
      <div className="ping-actions">
        <div className={`ping-value ${hasError ? 'error' : ''}`}>{status}</div>
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
  const [autoLaunch, setAutoLaunch] = useState(true);
  const [closeAction, setCloseAction] = useState(() => {
    const saved = localStorage.getItem('closeAction');
    return saved || 'ask';
  });
  const [speedStarted, setSpeedStarted] = useState(false);
  const [speedMetrics, setSpeedMetrics] = useState(null);
  const [speedLoading, setSpeedLoading] = useState(false);
  const [speedProvider, setSpeedProvider] = useState(() => localStorage.getItem('speedProvider') || 'cloudflare');
  const [betaUpdates, setBetaUpdates] = useState(() => {
    const saved = localStorage.getItem('betaUpdates');
    return saved === 'true';
  });
  const speedRequestRef = useRef({ id: 0 });
  const [dnsDomain, setDnsDomain] = useState('');
  const [dnsResults, setDnsResults] = useState([]);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsError, setDnsError] = useState('');
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

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
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

  const loadDnsAdapters = useCallback(async () => {
    try {
      const adapters = await invoke('list_dns_adapters');
      const normalized = Array.isArray(adapters) ? adapters : [];
      setDnsAdapters(normalized);
      if (normalized.length > 0) {
        const exists = normalized.some((item) => item.name === dnsSelectedAdapter);
        const selectedName = exists ? dnsSelectedAdapter : normalized[0].name;
        setDnsSelectedAdapter(selectedName);
        const selected = normalized.find((item) => item.name === selectedName);
        if (selected) {
          setDnsPrimaryInput(selected.dns?.[0] || '');
          setDnsSecondaryInput(selected.dns?.[1] || '');
        }
      } else {
        setDnsSelectedAdapter('');
        setDnsPrimaryInput('');
        setDnsSecondaryInput('');
      }
    } catch (error) {
      console.error('Failed to load dns adapters:', error);
      setDnsAdapters([]);
    }
  }, [dnsSelectedAdapter]);

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
        await loadDnsAdapters();
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
        await loadDnsAdapters();
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
    speedRequestRef.current.id += 1;
    const requestId = speedRequestRef.current.id;
    setSpeedStarted(false);
    setSpeedMetrics(null);
    setSpeedLoading(true);
    const command = speedProvider === 'hetzner' ? 'speedtest_hetzner' : 'speedtest_cloudflare';
    invoke(command)
      .then((result) => {
        if (requestId !== speedRequestRef.current.id) return;
        if (result && !result.error) {
          setSpeedMetrics(result);
          setSpeedStarted(true);
          const countryName = getCountryName(result.country);
          const countryPart = countryName ? ` • ${countryName}` : '';
          addLogEntry({
            type: 'speed',
            title: texts.logSpeedComplete,
            detail: `${result.downloadMbps} Mbps ↓ • ${result.uploadMbps} Mbps ↑ • ${result.latencyMs} ms${countryPart}`,
          });
        }
      })
      .catch((error) => {
        console.error('Speed test failed:', error);
      })
      .finally(() => {
        if (requestId === speedRequestRef.current.id) {
          setSpeedLoading(false);
        }
      });
  };

  const handleStopSpeed = () => {
    speedRequestRef.current.id += 1;
    setSpeedLoading(false);
    setSpeedStarted(false);
    setSpeedMetrics(null);
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
      loadDnsAdapters();
    }
  }, [currentPage, dnsToolMode, loadDnsAdapters]);

  useEffect(() => {
    setDnsBenchmarkStats([]);
  }, [dnsDomain]);

  const usableDns = dnsResults.filter((item) => item.status);
  const blockedDns = dnsResults.filter((item) => !item.status);
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

    const wrapper = scrollRef.current;
    const content = wrapper.querySelector('.lenis-content');
    if (!content) return undefined;

    const lenis = new Lenis({
      wrapper,
      content,
      duration: 1.1,
      smoothWheel: true,
      smoothTouch: false,
      easing: (t) => 1 - Math.pow(1 - t, 3),
    });

    let rafId = 0;
    const raf = (time) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

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


  // Helper function to generate consistent keys
  const getHostKey = (host) => {
    return host.type === 'custom'
      ? `custom-${host.id}`
      : `default-${host.label}-${host.host}`;
  };

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

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = allHosts.findIndex(host => getHostKey(host) === active.id);
    const newIndex = allHosts.findIndex(host => getHostKey(host) === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove(allHosts, oldIndex, newIndex);
    setAllHosts(newOrder);
    localStorage.setItem('allHosts', JSON.stringify(newOrder));
  };

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
      speedProviderTitle: 'Provider',
      speedProviderCloudflare: 'Cloudflare',
      speedProviderHetzner: 'Hetzner',
      speedNote: 'Note: If you use IP-changing tools, enable the Tunnel option in the tool settings to show updates.',
        dragToReorder: 'Drag to reorder',
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
      speedProviderTitle: '\u0633\u0631\u0648\u06cc\u0633',
      speedProviderCloudflare: 'Cloudflare',
      speedProviderHetzner: 'Hetzner',
      speedNote: '\u0646\u06a9\u062a\u0647 : \u0627\u06af\u0631 \u0627\u0632 \u0627\u0628\u0632\u0627\u0631 \u0647\u0627\u06cc \u062a\u063a\u06cc\u06cc\u0631 \u0622\u06cc\u067e\u06cc \u0627\u0633\u062a\u0641\u0627\u062f\u0647 \u0645\u06cc\u06a9\u0646\u06cc\u062f \u0628\u0631\u0627\u06cc \u0646\u0645\u0627\u06cc\u0634 \u062a\u063a\u06cc\u06cc\u0631\u0627\u062a \u06af\u0632\u06cc\u0646\u0647 \u062a\u0648\u0646\u0644 \u0631\u0648 \u062f\u0631 \u062a\u0646\u0638\u06cc\u0645\u0627\u062a \u0627\u0628\u0632\u0627\u0631 \u0631\u0648\u0634\u0646 \u06a9\u0646\u06cc\u062f',
      dragToReorder: '\u062c\u0627\u0628\u062c\u0627\u06cc\u06cc \u0628\u0631\u0627\u06cc \u062a\u063a\u06cc\u06cc\u0631 \u062a\u0631\u062a\u06cc\u0628',
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
    };
    const fa = {
      needAdmin: '\u0646\u06cc\u0627\u0632 \u0628\u0647 \u062f\u0633\u062a\u0631\u0633\u06cc \u0627\u062f\u0645\u06cc\u0646',
      error: '\u062e\u0637\u0627',
      noResponse: '\u0628\u062f\u0648\u0646 \u067e\u0627\u0633\u062e',
      ipcError: '\u062e\u0637\u0627\u06cc IPC',
    };
    return isPersian ? fa : en;
  }, [isPersian]);

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







  return (
    <div className="app-shell">
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-team">
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
                      : 'Settings'}
            </div>
            </div>
          </div>
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
              >
                <span className="sidebar-item-icon" aria-hidden="true">
                  <img src={pingIcon} alt="" className="sidebar-item-icon-img" />
                </span>
                <span className="sidebar-item-text">{texts.ping}</span>
              </button>
              <button
                className={`sidebar-item ${currentPage === 'dns' ? 'active' : ''}`}
                onClick={() => setCurrentPage('dns')}
              >
                <span className="sidebar-item-icon" aria-hidden="true">
                  <img src={dnsIcon} alt="" className="sidebar-item-icon-img" />
                </span>
                <span className="sidebar-item-text">{texts.dnsChecker}</span>
              </button>
              <button
                className={`sidebar-item ${currentPage === 'speed' ? 'active' : ''}`}
                onClick={() => setCurrentPage('speed')}
              >
                <span className="sidebar-item-icon" aria-hidden="true">
                  <img src={speedIcon} alt="" className="sidebar-item-icon-img" />
                </span>
                <span className="sidebar-item-text">{texts.speedTest}</span>
              </button>
              <button
                className={`sidebar-item ${currentPage === 'log' ? 'active' : ''}`}
                onClick={() => setCurrentPage('log')}
              >
                <span className="sidebar-item-icon" aria-hidden="true">
                  <img src={logIcon} alt="" className="sidebar-item-icon-img" />
                </span>
                <span className="sidebar-item-text">{texts.alerts}</span>
              </button>
              <button
                className={`sidebar-item ${currentPage === 'settings' ? 'active' : ''}`}
                onClick={() => setCurrentPage('settings')}
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
          <h1>
            {currentPage === 'ping'
              ? 'PulseNet'
              : currentPage === 'dns'
                ? 'DNS Checker'
                : currentPage === 'speed'
                  ? 'Speed Test'
                  : currentPage === 'log'
                    ? 'Log'
                    : 'Settings'}
          </h1>

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
                onLog={addLogEntry}
                pingAlertThresholdMs={pingAlertThresholdMs}
              />
            )}

            {/* All Hosts with dnd-kit drag and drop */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={allHosts.map(getHostKey)}
                strategy={verticalListSortingStrategy}
              >
                {allHosts.map((host) => (
                <SortableItem
                  key={getHostKey(host)}
                  id={getHostKey(host)}
                  label={host.label}
                  host={host.host}
                  showDelete={isEditMode}
                  isEditMode={isEditMode}
                  onDelete={() => handleDeleteHost(host)}
                  texts={texts}
                  statusTexts={statusTexts}
                  pingIntervalMs={pingIntervalMs}
                  onLog={addLogEntry}
                  pingAlertThresholdMs={pingAlertThresholdMs}
                />
              ))}
              </SortableContext>
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
                  <>
                    <div className="dns-summary">
                      <span className="dns-summary-good">{texts.usable} ({usableDns.length})</span>
                      <span className="dns-summary-bad">{texts.blocked} ({blockedDns.length})</span>
                    </div>
                    <div className="dns-results">
                      <div className="dns-column">
                        <div className="dns-column-title good">{texts.usable}</div>
                        {usableDns.map((item) => (
                          <div key={`usable-${item.server}`} className="dns-card good">
                            <div className="dns-card-main">{item.server}</div>
                            <div className="dns-card-meta">{item.responseTimeMs}ms</div>
                          </div>
                        ))}
                      </div>
                      <div className="dns-column">
                        <div className="dns-column-title bad">{texts.blocked}</div>
                        {blockedDns.map((item) => (
                          <div key={`blocked-${item.server}`} className="dns-card bad">
                            <div className="dns-card-main">{item.server}</div>
                            <div className="dns-card-meta">
                              {item.error ? item.error.toString() : texts.failed}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
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
                    <select
                      className="dns-manager-select"
                      value={dnsSelectedAdapter}
                      onChange={(event) => {
                        const selected = event.target.value;
                        setDnsSelectedAdapter(selected);
                        const adapter = dnsAdapters.find((item) => item.name === selected);
                        if (adapter) {
                          setDnsPrimaryInput(adapter.dns?.[0] || '');
                          setDnsSecondaryInput(adapter.dns?.[1] || '');
                        }
                      }}
                      disabled={dnsManagerLoading || dnsAdapters.length === 0}
                    >
                      {dnsAdapters.length === 0 ? (
                        <option value="">{texts.dnsManagerNoAdapters}</option>
                      ) : (
                        dnsAdapters.map((adapter) => (
                          <option key={`adapter-${adapter.name}`} value={adapter.name}>
                            {adapter.name}
                          </option>
                        ))
                      )}
                    </select>
                    <button
                      className="dns-button secondary"
                      onClick={loadDnsAdapters}
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
                    className="dns-button secondary"
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
                <select
                  className="settings-select"
                  value={closeAction}
                  onChange={(event) => setCloseAction(event.target.value)}
                >
                  <option value="hide">{texts.closeActionHide}</option>
                  <option value="exit">{texts.closeActionExit}</option>
                  <option value="ask">{texts.closeActionAsk}</option>
                </select>
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
