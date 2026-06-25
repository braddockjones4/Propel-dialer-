/**
 * Socket.io singleton — import `io` anywhere in the backend to emit events
 * Usage: import { io } from '../socket'; io.emit('new-sms', payload);
 */
import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: Server;

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] client connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`[Socket] client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export { io };
