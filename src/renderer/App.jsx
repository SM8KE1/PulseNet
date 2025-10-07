import React, { useState, useEffect } from 'react';
import ThemeToggle from './ThemeToggle';
import GitHubIcon from './GitHubIcon';
import iconIco from '../../assets/icon.ico';
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

const usePing = (host) => {
  const [pingData, setPingData] = useState({ status: '--', hasError: false });

  useEffect(() => {
    const ping = async () => {
      try {
        const result = await window.pingApi.ping(host);
        if (result.error) {
          if (result.error.includes('permission')) {
            setPingData({ status: 'Need Admin', hasError: true });
          } else {
            setPingData({ status: 'Error', hasError: true });
          }
        } else if (!result.alive) {
          setPingData({ status: 'No Response', hasError: true });
        } else {
          setPingData({ status: `${Math.round(result.time)}ms`, hasError: false });
        }
      } catch (e) {
        console.error('Ping IPC failed:', e);
        setPingData({ status: 'IPC Error', hasError: true });
      }
    };

    ping();
    const intervalId = setInterval(ping, 2000);

    return () => clearInterval(intervalId);
  }, [host]);

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
  isEditMode = false
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const { status, hasError } = usePing(host);
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
            placeholder="Host name"
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            onKeyDown={handleKeyPress}
            className="edit-input"
            autoFocus
          />
          <input
            type="text"
            placeholder="IP address or domain"
            value={editHost}
            onChange={(e) => setEditHost(e.target.value)}
            onKeyDown={handleKeyPress}
            className="edit-input"
          />
        </div>
        <div className="ping-actions">
          <button className="save-button" onClick={handleSave}>
            Save
          </button>
          <button className="cancel-button" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`ping-card ${isDragging ? 'dragging' : ''}`}
      {...attributes}
    >
      {isEditMode && (
        <div
          className="drag-handle active"
          {...listeners}
          title="کشیدن برای مرتب‌سازی"
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
          <button className="delete-button" onClick={handleDelete} title={`حذف ${label}`}>
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

const AddHostForm = ({ onAddHost }) => {
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
      alert('Please enter both name and IP address');
      return;
    }
    if (!validateIP(ip.trim())) {
      alert('Invalid IP address or domain format');
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
          Add
        </button>
      ) : (
        <form className="add-host-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <input
              type="text"
              placeholder="Host name (e.g., My Server)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="form-input"
            />
          </div>
          <div className="form-group">
            <input
              type="text"
              placeholder="IP address or domain (e.g., 192.168.1.1)"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              className="form-input"
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="submit-button">Add</button>
            <button type="button" className="cancel-button" onClick={() => setIsExpanded(false)}>Cancel</button>
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

  // dnd-kit drag end handler
  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = allHosts.findIndex(host => getHostKey(host) === active.id);
    const newIndex = allHosts.findIndex(host => getHostKey(host) === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // Reorder the array
    const newOrder = arrayMove(allHosts, oldIndex, newIndex);
    setAllHosts(newOrder);
    localStorage.setItem('allHosts', JSON.stringify(newOrder));
  };



  return (
    <>
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
      <div className="container">
        <div className="top-left-controls">
          <div id="github-button" className="icon-button">
            <GitHubIcon />
          </div>
          <ThemeToggle isDarkMode={isDarkMode} toggleTheme={toggleTheme} />
        </div>
        <h1>PulseNet</h1>

        <div id="ping-results">
          <div className="add-host-container">
            <button className="add-host-button" onClick={handleAddNewHost}>
              <PencilIcon />
              Add
            </button>
            <button
              className={`edit-host-button ${isEditMode ? 'active' : ''}`}
              onClick={() => setIsEditMode(!isEditMode)}
            >
              <EditIcon />
              Edit
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
