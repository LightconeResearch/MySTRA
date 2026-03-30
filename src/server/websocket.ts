/**
 * WebSocket manager for live reload notifications.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HTTPServer } from 'node:http';

export class WebSocketManager {
  private wss: WebSocketServer;

  constructor(server: HTTPServer) {
    this.wss = new WebSocketServer({ server, path: '/socket' });
  }

  broadcast(data: { type: 'RELOAD' | 'LOG'; message?: string }): void {
    const message = JSON.stringify(data);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  getConnectionCount(): number {
    return this.wss.clients.size;
  }

  close(): void {
    for (const client of this.wss.clients) {
      client.close();
    }
    this.wss.close();
  }
}
