import WebSocket from "ws";
import { env } from "../config/env.js";
import { DELTA_CONFIG } from "../config/delta.js";
import { KillSwitch } from "../risk/kill.switch.js";
import { KillReason } from "../risk/kill.reasons.js";

type WsHandler = (msg: any) => void;

export class DeltaWsClient {
  private ws?: WebSocket;
  private heartbeat?: NodeJS.Timeout;

  constructor(
    private onMessage: WsHandler,
    private onFatal: () => void,
    private onOpen?: () => void
  ) {}

  connect() {
    this.ws = new WebSocket(env.DELTA_WS_URL);

    this.ws.on("open", () => {
      this.startHeartbeat();
      this.onOpen?.();
    });

    this.ws.on("message", (data) => {
      this.onMessage(JSON.parse(data.toString()));
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
