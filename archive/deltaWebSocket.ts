import WebSocket from 'ws';
import { logger } from '../utils/logger';
import { createAuthHeaders, getTimestamp } from '../utils/auth';
import { DeltaConfig, WebSocketMessage } from '../types';

export class DeltaWebSocketClient {
  private ws: WebSocket | null = null;
  private config: DeltaConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;
  private isAuthenticated = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private subscriptions: Set<string> = new Set();
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  constructor(config: DeltaConfig) {
    this.config = config;
  }

  /**
   * Connect to Delta Exchange WebSocket
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        logger.info('Connecting to WebSocket:', this.config.wsUrl);
        this.ws = new WebSocket(this.config.wsUrl);

        this.ws.on('open', () => {
          logger.info('WebSocket connected');
          this.reconnectAttempts = 0;
          this.authenticate()
            .then(() => {
              this.startHeartbeat();
              resolve();
            })
            .catch(reject);
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('error', (error) => {
          logger.error('WebSocket error:', error);
          reject(error);
        });

        this.ws.on('close', () => {
          logger.warn('WebSocket connection closed');
          this.isAuthenticated = false;
          this.stopHeartbeat();
          this.attemptReconnect();
        });

        this.ws.on('ping', () => {
          this.ws?.pong();
        });

      } catch (error) {
        logger.error('Failed to connect WebSocket:', error);
        reject(error);
      }
    });
  }

  /**
   * Authenticate WebSocket connection
   */
  private async authenticate(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timestamp = getTimestamp();
      const method = 'GET';
      const path = '/live';
      
      const headers = createAuthHeaders(
        this.config.apiKey,
        this.config.apiSecret,
        method,
        path
      );

      const authMessage = {
        type: 'auth',
        payload: {
          'api-key': headers['api-key'],
          'signature': headers['signature'],
          'timestamp': headers['timestamp']
        }
      };

      const timeout = setTimeout(() => {
        reject(new Error('Authentication timeout'));
      }, 10000);

      const authHandler = (data: any) => {
        if (data.type === 'auth_response') {
          clearTimeout(timeout);
          if (data.success) {
            this.isAuthenticated = true;
            logger.info('WebSocket authenticated successfully');
            resolve();
          } else {
            reject(new Error(`Authentication failed: ${data.error}`));
          }
        }
      };

      this.messageHandlers.set('auth_response', authHandler);
      this.send(authMessage);
    });
  }

  /**
   * Subscribe to a channel
   */
  subscribe(channel: string, symbols?: string[]): void {
    if (!this.isAuthenticated && !channel.startsWith('public.')) {
      logger.warn('Cannot subscribe to private channel without authentication');
      return;
    }

    const subscribeMessage: any = {
      type: 'subscribe',
      payload: {
        channels: [
          {
            name: channel,
            symbols: symbols || []
          }
        ]
      }
    };

    this.send(subscribeMessage);
    this.subscriptions.add(channel);
    logger.info('Subscribed to channel:', { channel, symbols });
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channel: string, symbols?: string[]): void {
    const unsubscribeMessage = {
      type: 'unsubscribe',
      payload: {
        channels: [
          {
            name: channel,
            symbols: symbols || []
          }
        ]
      }
    };

    this.send(unsubscribeMessage);
    this.subscriptions.delete(channel);
    logger.info('Unsubscribed from channel:', { channel, symbols });
  }

  /**
   * Register a message handler for a specific channel
   */
  onMessage(channel: string, handler: (data: any) => void): void {
    this.messageHandlers.set(channel, handler);
  }

  /**
   * Send a message through WebSocket
   */
  private send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      logger.warn('WebSocket not ready, message not sent');
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message: WebSocketMessage = JSON.parse(data);
      
      // Handle specific message types
      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        handler(message);
      }

      // Log unhandled messages at debug level
      if (!handler && message.type !== 'heartbeat') {
        logger.debug('Unhandled message type:', message.type);
      }

    } catch (error) {
      logger.error('Error parsing WebSocket message:', error);
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: 'heartbeat' });
      }
    }, 30000); // Send heartbeat every 30 seconds
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Attempt to reconnect WebSocket
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached, giving up');
      return;
    }

    this.reconnectAttempts++;
    logger.info(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect()
        .then(() => {
          // Resubscribe to previous channels
          this.subscriptions.forEach(channel => {
            this.subscribe(channel);
          });
        })
        .catch(error => {
          logger.error('Reconnection failed:', error);
        });
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isAuthenticated = false;
    this.subscriptions.clear();
    this.messageHandlers.clear();
    logger.info('WebSocket disconnected');
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
