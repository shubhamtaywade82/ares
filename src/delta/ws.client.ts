import WebSocket from "ws";
import { env } from "../config/env.js";
import { DELTA_CONFIG } from "../config/delta.js";
import { DeltaSigner } from "./signer.js";
import { KillSwitch } from "../risk/kill.switch.js";
import { KillReason } from "../risk/kill.reasons.js";

type WsHandler = (msg: any) => void;
type WsAuthHandler = (success: boolean, message: any) => void;

type WsClientOptions = {
  auth?: boolean;
  onAuth?: WsAuthHandler;
};

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;

export class DeltaWsClient {
  private ws?: WebSocket | undefined;
  private heartbeat?: NodeJS.Timeout;
  private authenticated = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private destroyed = false;

  constructor(
    private onMessage: WsHandler,
    private onFatal: () => void,
    private onOpen?: () => void,
    private options: WsClientOptions = {}
  ) {}

  connect() {
    if (this.destroyed) return;

    this.ws = new WebSocket(env.DELTA_WS_URL);

    this.ws.on("open", () => {
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      if (this.options.auth) {
        this.sendAuth();
      }
      this.onOpen?.();
    });

    this.ws.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message?.type === "key-auth") {
        this.authenticated = Boolean(message.success);
        this.options.onAuth?.(this.authenticated, message);
        return;
      }
      this.onMessage(message);
    });

    this.ws.on("close", () => {
      this.handleDisconnect("WS_DISCONNECT");
    });
    this.ws.on("error", (err) => {
      this.handleDisconnect(`WS_ERROR: ${err.message}`);
    });
  }

  send(payload: object) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  disconnect() {
    this.destroyed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  subscribe(channel: string, symbols?: string[]) {
    const payload = {
      type: "subscribe",
      payload: {
        channels: [
          symbols
            ? {
                name: channel,
                symbols,
              }
            : {
                name: channel,
              },
        ],
      },
    };
    this.send(payload);
  }

  private handleDisconnect(reason: string) {
    if (this.destroyed) return;

    // Cleanup existing WS before reconnecting
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = undefined;
    }

    clearInterval(this.heartbeat);
    delete this.heartbeat;
    this.authenticated = false;

    this.reconnectAttempts += 1;

    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(`[ARES.WS] Exhausted ${MAX_RECONNECT_ATTEMPTS} reconnect attempts. Triggering kill switch.`);
      KillSwitch.trigger(KillReason.WS_DISCONNECT, { reason });
      return; // unreachable, but satisfies TypeScript
    }

    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS
    );
    console.warn(
      `[ARES.WS] ${reason} — reconnect attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private sendAuth() {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = DeltaSigner.sign("GET", "/live", timestamp);
    this.send({
      type: "key-auth",
      payload: {
        "api-key": env.DELTA_API_KEY,
        signature,
        timestamp,
      },
    });
  }

  private startHeartbeat() {
    this.heartbeat = setInterval(() => {
      this.send({ type: "ping" });
    }, DELTA_CONFIG.wsHeartbeatMs);
  }
}
