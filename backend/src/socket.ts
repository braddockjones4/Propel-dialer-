/**
 * Socket.io singleton — import `io` anywhere in the backend to emit events
 * Usage: import { io } from '../socket'; io.emit('new-sms', payload);
 */
import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: Server;

function buildSocketOrigins(env: string | undefined): string | string[] {
  if (!env || env === '*') return '*';
  const origins = new Set<string>();
  for (const raw of env.split(',')) {
    const o = raw.trim();
    origins.add(o);
    try {
      const u = new URL(o);
      if (u.hostname.startsWith('www.')) origins.add(`${u.protocol}//${u.hostname.slice(4)}`);
      else origins.add(`${u.protocol}//www.${u.hostname}`);
    } catch {}
  }
  return [...origins];
}

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: buildSocketOrigins(process.env.FRONTEND_URL), methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] client connected: ${socket.id}`);
    // H10: clear any stale bridge state the client may have from before server restart
    socket.emit('server-ready', { ts: Date.now() });
    socket.on('disconnect', () => {
      console.log(`[Socket] client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export { io };
