const { ipcRenderer } = require('electron');
const ping = require('ping');

function logPing(host, result) {
    const msg = `Ping to ${host}: ${result}`;
    ipcRenderer.send('log-ping', msg);
}


document.getElementById('minimize-button').addEventListener('click', () => {
    ipcRenderer.send('minimize-window');
});

document.getElementById('close-button').addEventListener('click', () => {
    ipcRenderer.send('close-window');
});


const hosts = {
    'google-ping': '8.8.8.8',
    'cloudflare-ping': '1.1.1.1',
    'timeir-ping': 'time.ir',
    'youtube-ping': '104.155.178.105'
};

function updatePingDisplay(elementId, pingTime, error = null) {
    const element = document.getElementById(elementId);
    if (error) {
        element.textContent = error;
        element.classList.add('error');
    } else if (pingTime === null || pingTime === 'unknown') {
        element.textContent = 'No Response';
        element.classList.add('error');
    } else {
        element.textContent = `${Math.round(pingTime)}ms`;
        element.classList.remove('error');
    }
}

async function pingHost(host, elementId) {
    try {
        const res = await ping.promise.probe(host, {
            timeout: 10,
            extra: ['-c', '1']
        });
        if (res.alive) {
            updatePingDisplay(elementId, res.time);
            logPing(host, `Success (${res.time} ms)`);
        } else {
            updatePingDisplay(elementId, null);
            logPing(host, 'No Response');
        }
    } catch (error) {
        if (error.message.includes('permission')) {
            updatePingDisplay(elementId, null, 'Need Admin Rights');
            logPing(host, 'Need Admin Rights');
        } else {
            updatePingDisplay(elementId, null, 'No Response');
            logPing(host, `Error: ${error.message}`);
        }
    }
}


setInterval(() => {
    Object.entries(hosts).forEach(([elementId, host]) => {
        pingHost(host, elementId);
    });
}, 1000);


Object.entries(hosts).forEach(([elementId, host]) => {
    pingHost(host, elementId);
});
