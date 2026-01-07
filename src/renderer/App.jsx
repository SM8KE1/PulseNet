import React, { useState, useEffect, useMemo } from 'react';
import ThemeToggle from './ThemeToggle';
import GitHubIcon from './GitHubIcon';
import iconIco from '../../assets/icon.ico';
import earthA from '../../assets/earth-a.svg';
import earthB from '../../assets/earth-b.svg';
import Lenis from 'lenis';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
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
          { type: 'default', label: 'YouTube', host: '104.155.178.105' },
        ]);
      }
    } else {
      // Initialize with default hosts
      const defaultHosts = [
        { type: 'default', label: 'Google DNS', host: '8.8.8.8' },
        { type: 'default', label: 'Cloudflare DNS', host: '1.1.1.1' },
        { type: 'default', label: 'Time.ir', host: 'time.ir' },
        { type: 'default', label: 'YouTube', host: '104.155.178.105' },
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

const usePing = (host, statusTexts) => {
  const [pingData, setPingData] = useState({ status: '--', hasError: false });

  useEffect(() => {
    const ping = async () => {
      try {
        const result = await window.pingApi.ping(host);
        if (result.error) {
          if (result.error.includes('permission')) {
            setPingData({ status: statusTexts.needAdmin, hasError: true });
          } else {
            setPingData({ status: statusTexts.error, hasError: true });
          }
        } else if (!result.alive) {
          setPingData({ status: statusTexts.noResponse, hasError: true });
        } else {
          setPingData({ status: `${Math.round(result.time)}ms`, hasError: false });
        }
      } catch (e) {
        console.error('Ping IPC failed:', e);
        setPingData({ status: statusTexts.ipcError, hasError: true });
      }
    };

    ping();
    const intervalId = setInterval(ping, 2000);

    return () => clearInterval(intervalId);
  }, [host, statusTexts]);

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
  statusTexts
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const { status, hasError } = usePing(host, statusTexts);
  const [editLabel, setEditLabel] = useState(label || '');
  const [editHost, setEditHost] = useState(host || '');

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

const AddHostForm = ({ onAddHost, texts }) => {
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const validateIP = (ip) => {
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    return ipRegex.test(ip);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !ip.trim()) {
      alert(texts.alertMissing);
      return;
    }
    if (!validateIP(ip.trim())) {
      alert(texts.alertInvalid);
      return;
    }
    onAddHost({ label: name.trim(), host: ip.trim() });
    setName('');
    setIp('');
    setIsExpanded(false);
  };

  return (
    <div className="add-host-container">
      {!isExpanded ? (
        <button className="add-host-button" onClick={() => setIsExpanded(true)}>
          <PencilIcon />
          {texts.add}
        </button>
      ) : (
        <form className="add-host-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <input
              type="text"
              placeholder={texts.hostNamePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="form-input"
            />
          </div>
          <div className="form-group">
            <input
              type="text"
              placeholder={texts.hostIpPlaceholder}
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              className="form-input"
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="submit-button">{texts.add}</button>
            <button type="button" className="cancel-button" onClick={() => setIsExpanded(false)}>{texts.cancel}</button>
          </div>
        </form>
      )}
    </div>
  );
};

const App = () => {
  const [isDarkMode, setDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme ? savedTheme === 'dark' : true; // Default to dark if no preference saved
  });
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [appVersion, setAppVersion] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [isPersian, setIsPersian] = useState(() => {
    const savedLocale = localStorage.getItem('locale');
    return savedLocale ? savedLocale === 'fa' : false;
  });
  const { allHosts, setAllHosts, addHost } = useHosts();
  const [editingHost, setEditingHost] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);

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
        const version = await window.ipcApi.getAppVersion();
        setAppVersion(version);
      } catch (error) {
        console.error('Failed to load app version:', error);
      }
    };
    loadVersion();
  }, []);

  useEffect(() => {
    const savedName = localStorage.getItem('displayName');
    if (savedName) {
      setDisplayName(savedName);
      setNameInput(savedName);
      return;
    }
    const loadUsername = async () => {
      try {
        const username = await window.ipcApi.getUsername();
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

  const getInitials = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return 'U';
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  };

  useEffect(() => {
    const minimizeBtn = document.getElementById('minimize-button');
    const closeBtn = document.getElementById('close-button');
    const githubBtn = document.getElementById('github-button');

    const handleMinimize = () => window.ipcApi.send('minimize-window');
    const handleClose = () => window.ipcApi.send('close-window');
    const handleGithub = () => window.ipcApi.send('open-github-link');

    minimizeBtn.addEventListener('click', handleMinimize);
    closeBtn.addEventListener('click', handleClose);
    githubBtn.addEventListener('click', handleGithub);

    return () => {
      minimizeBtn.removeEventListener('click', handleMinimize);
      closeBtn.removeEventListener('click', handleClose);
      githubBtn.removeEventListener('click', handleGithub);
    };
  }, []);

  // Lenis
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      direction: 'vertical',
      gestureDirection: 'vertical',
      smooth: true,
      mouseMultiplier: 1,
      smoothTouch: false,
      touchMultiplier: 2,
      infinite: false,
    });

    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);

    return () => {
      lenis.destroy();
    };
  }, []);

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
      menuTitle: 'Menu',
      fakeButton: 'Fake Button',
      openMenuTitle: 'Open menu',
      closeMenuTitle: 'Close menu',
      add: 'Add',
      edit: 'Edit',
      save: 'Save',
      cancel: 'Cancel',
      hostNamePlaceholder: 'Host name (e.g., My Server)',
      hostIpPlaceholder: 'IP address or domain (e.g., 192.168.1.1)',
      hostNameShortPlaceholder: 'Host name',
      hostIpShortPlaceholder: 'IP address or domain',
      alertMissing: 'Please enter both name and IP address',
      alertInvalid: 'Invalid IP address or domain format',
      dragToReorder: 'Drag to reorder',
      deleteTitle: (label) => `Delete ${label}`,
    };
    const fa = {
      menuTitle: 'منو',
      fakeButton: 'دکمه فیک',
      openMenuTitle: 'باز کردن منو',
      closeMenuTitle: 'بستن منو',
      add: 'افزودن',
      edit: 'ویرایش',
      save: 'ذخیره',
      cancel: 'لغو',
      hostNamePlaceholder: 'نام میزبان (مثلاً سرور من)',
      hostIpPlaceholder: 'آدرس IP یا دامنه (مثلاً 192.168.1.1)',
      hostNameShortPlaceholder: 'نام میزبان',
      hostIpShortPlaceholder: 'آدرس IP یا دامنه',
      alertMissing: 'لطفاً نام و آدرس IP را وارد کنید',
      alertInvalid: 'فرمت IP یا دامنه نامعتبر است',
      dragToReorder: 'جابجایی برای تغییر ترتیب',
      deleteTitle: (label) => `حذف ${label}`,
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
      needAdmin: 'نیاز به دسترسی ادمین',
      error: 'خطا',
      noResponse: 'بدون پاسخ',
      ipcError: 'خطای IPC',
    };
    return isPersian ? fa : en;
  }, [isPersian]);



  return (
    <>
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-team">
            <div className="sidebar-team-logo">
              <img src={iconIco} alt="PulseNet" className="sidebar-team-icon" />
            </div>
            <div className="sidebar-team-info">
              <div className="sidebar-team-name">PulseNet</div>
              <div className="sidebar-team-plan">Monitoring</div>
            </div>
          </div>
          <button className="sidebar-collapse" onClick={toggleSidebarCollapse} aria-label="Toggle sidebar">
            <span className="collapse-line"></span>
            <span className="collapse-line"></span>
          </button>
        </div>
        <div className="sidebar-content">
          <div className="sidebar-group">
            <div className="sidebar-group-label">Platform</div>
            <div className="sidebar-menu">
              <button className="sidebar-item active">
                <span className="sidebar-item-icon" aria-hidden="true">O</span>
                <span className="sidebar-item-text">Overview</span>
              </button>
              <button className="sidebar-item">
                <span className="sidebar-item-icon" aria-hidden="true">H</span>
                <span className="sidebar-item-text">Hosts</span>
              </button>
              <button className="sidebar-item">
                <span className="sidebar-item-icon" aria-hidden="true">A</span>
                <span className="sidebar-item-text">Alerts</span>
              </button>
              <button className="sidebar-item">
                <span className="sidebar-item-icon" aria-hidden="true">S</span>
                <span className="sidebar-item-text">Settings</span>
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
      <div className="titlebar">
        <div className="titlebar-left">
          <img src={iconIco} alt="PulseNet" className="app-icon" />
          <div className="titlebar-title">PulseNet</div>
        </div>
        <div className="titlebar-controls">
          <div className="titlebar-button minimize" id="minimize-button">&#x2212;</div>
          <div className="titlebar-button close" id="close-button">&#x2715;</div>
        </div>
      </div>
      <div className={`container ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="top-left-controls">
          <div id="github-button" className="icon-button">
            <GitHubIcon />
          </div>
          <ThemeToggle isDarkMode={isDarkMode} toggleTheme={toggleTheme} />
          <div className="icon-button">
            <TranslateToggle isActive={isPersian} onToggle={toggleLocale} />
          </div>
        </div>
        <h1>PulseNet</h1>

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
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </>
  );
};

export default App;
