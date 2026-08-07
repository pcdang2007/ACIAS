'use strict';

const { EventEmitter } = require('events');

const hub = new EventEmitter();
hub.setMaxListeners(100);

function broadcast(event, payload) {
  hub.emit('event', { event, payload });
}

function subscribe(fn) {
  hub.on('event', fn);
  return () => hub.off('event', fn);
}

// Live connections keyed by session token hash (for single-session kick notifications)
const clients = new Map();

function registerClient(tokenHash, ws) {
  if (!tokenHash || !ws) return;
  let set = clients.get(tokenHash);
  if (!set) {
    set = new Set();
    clients.set(tokenHash, set);
  }
  set.add(ws);
  ws.on('close', () => {
    set.delete(ws);
    if (set.size === 0) clients.delete(tokenHash);
  });
}

function kickSession(tokenHash, payload) {
  const set = clients.get(tokenHash);
  if (!set || set.size === 0) return;
  const msg = JSON.stringify({ event: 'session_kicked', payload });
  for (const ws of [...set]) {
    try { ws.send(msg); } catch { /* ignore */ }
    try { ws.close(4001, 'session_kicked'); } catch { /* ignore */ }
  }
  clients.delete(tokenHash);
}

module.exports = { hub, broadcast, subscribe, registerClient, kickSession };
