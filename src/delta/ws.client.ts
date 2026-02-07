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

export class DeltaWsClient {
  private ws?: WebSocket;
  private heartbeat?: NodeJS.Timeout;
  private authenticated = false;

  constructor(
    private onMessage: WsHandler,
    private onFatal: () => void,
    private onOpen?: () => void,
    private options: WsClientOptions = {}
  ) {}

  connect() {
    this.ws = new WebSocket(env.DELTA_WS_URL);

    this.ws.on("open", () => {
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
      this.shutdown("WS_DISCONNECT");
    });

    this.ws.on("error", () => {
      this.shutdown("WS_ERROR");
    });
  }

  send(payload: object) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
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

  private shutdown(reason: string) {
    console.error("WS FATAL:", reason);
    clearInterval(this.heartbeat);
    KillSwitch.trigger(KillReason.WS_DISCONNECT, { reason });
    this.onFatal(); // legacy hook (unreachable after KillSwitch)
  }
}
