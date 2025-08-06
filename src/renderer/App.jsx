import React, { useState, useEffect } from 'react';
import ThemeToggle from './ThemeToggle';
import GitHubIcon from './GitHubIcon';
import iconIco from '../../assets/icon.ico';

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

const PingCard = ({ label, host }) => {
  const { status, hasError } = usePing(host);
  return (
    <div className="ping-card">
      <div className="ping-info">
        <div className="ping-label">{label}</div>
        <div className="ping-ip">{host}</div>
      </div>
      <div className={`ping-value ${hasError ? 'error' : ''}`}>{status}</div>
    </div>
  );
};

const App = () => {
  const [isDarkMode, setDarkMode] = useState(true);

  const toggleTheme = () => {
    setDarkMode(prevMode => !prevMode);
  };

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove('light-theme');
    } else {
      document.body.classList.add('light-theme');
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

  const hosts = [
    { label: 'Google DNS', host: '8.8.8.8' },
    { label: 'Cloudflare DNS', host: '1.1.1.1' },
    { label: 'Time.ir', host: 'time.ir' },
    { label: 'YouTube', host: '104.155.178.105' },
  ];

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
          {hosts.map(({ label, host }) => (
            <PingCard key={host} label={label} host={host} />
          ))}
        </div>
      </div>
    </>
  );
};

export default App;
