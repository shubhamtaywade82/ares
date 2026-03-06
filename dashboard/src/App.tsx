import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  TrendingDown,
  Layers,
  Zap,
  ShoppingBag,
  ShieldCheck,
  ArrowRight,
  Clock,
  ChevronRight,
  TrendingUp,
  Wallet,
  BarChart3,
  History,
  AlertCircle
} from 'lucide-react';

// Shared Types
type SystemState = "BOOTING" | "SYNCING_DATA" | "READY" | "RUNNING" | "PAUSED" | "DEGRADED" | "ERROR" | "SHUTDOWN";
type MarketRegime = "TRENDING_BULL" | "TRENDING_BEAR" | "RANGING" | "VOLATILE_EXPANSION" | "VOLATILE_COMPRESSION" | "NEWS_EVENT" | "UNKNOWN";
type StructureState = "BULLISH_STRUCTURE" | "BEARISH_STRUCTURE" | "TRANSITION" | "BOS_CONFIRMED" | "CHOCH_CONFIRMED" | "LIQUIDITY_SWEEP" | "EQUILIBRIUM_ROTATION" | "IMPULSE_PHASE" | "PULLBACK_PHASE" | "DISTRIBUTION" | "ACCUMULATION" | "NONE";
type SignalState = "IDLE" | "HTF_BIAS_CONFIRMED" | "STRUCTURE_ALIGNED" | "DISPLACEMENT_DETECTED" | "LIQUIDITY_SWEEP_DETECTED" | "PULLBACK_DETECTED" | "REJECTION_CONFIRMED" | "READY_TO_EXECUTE" | "ORDER_PLACED" | "ORDER_PARTIALLY_FILLED" | "ORDER_FILLED" | "ORDER_CANCELLED" | "INVALIDATED";
type PositionState = "NONE" | "OPEN" | "BREAKEVEN" | "TRAILING" | "PARTIAL_TP_HIT" | "FULL_TP_HIT" | "STOP_LOSS_HIT" | "FORCE_CLOSED";
type RiskState = "NORMAL" | "DAILY_DRAWDOWN_LIMIT_HIT" | "MAX_CONSECUTIVE_LOSSES" | "VOLATILITY_EXCEEDED" | "LIQUIDITY_LOW" | "API_LATENCY_HIGH" | "GLOBAL_KILL_SWITCH";

interface Snapshot {
  system: SystemState;
  regime: MarketRegime;
  structure: StructureState;
  signal: SignalState;
  position: PositionState;
  risk: RiskState;
  timestamp: string;
}

interface Position {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  markPrice: number;
  size: number;
  pnl: number;
  pnlPercent: number;
  tp: number;
  sl: number;
}

interface TradeHistoryItem {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  status: 'TP' | 'SL' | 'FORCE_CLOSED';
  time: string;
}

const MetricCard = ({ title, value, subValue, icon: Icon, color, trend }: { title: string, value: string, subValue?: string, icon: any, color: string, trend?: 'up' | 'down' }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="glass p-5 flex items-center gap-4 group hover:border-blue-500/30 transition-all"
  >
    <div className={`p-3 rounded-2xl bg-${color}-500/10 text-${color}-500 group-hover:scale-110 transition-transform`}>
      <Icon size={24} />
    </div>
    <div className="flex flex-col">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{title}</span>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-black tabular-nums tracking-tighter">{value}</span>
        {subValue && (
          <span className={`text-xs font-bold ${trend === 'up' ? 'text-emerald-500' : 'text-rose-500'}`}>
            {trend === 'up' ? '+' : ''}{subValue}
          </span>
        )}
      </div>
    </div>
  </motion.div>
);

const StateCard = ({ title, activeState, allStates, icon: Icon, color }: { title: string, activeState: string, allStates: string[], icon: any, color: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="glass p-6 flex flex-col gap-4 border-l-4 border-l-blue-500/50"
  >
    <div className="flex items-center gap-3">
      <div className={`p-2 rounded-lg bg-${color}-500/10 text-${color}-500`}>
        <Icon size={18} />
      </div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</h3>
    </div>
    <div className="flex flex-wrap gap-1.5">
      {allStates.map(state => (
        <span
          key={state}
          className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all duration-300 ${
            state === activeState
              ? `bg-${color}-500 text-white shadow-lg shadow-${color}-500/20 ring-1 ring-${color}-400/50`
              : 'bg-white/5 text-slate-600'
          }`}
        >
          {state}
        </span>
      ))}
    </div>
  </motion.div>
);

const PositionTable = ({ positions }: { positions: Position[] }) => (
  <div className="glass overflow-hidden">
    <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
      <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400">Active Positions</h3>
      <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-500 text-[10px] font-black uppercase tracking-tighter">
        {positions.length} Positions Open
      </span>
    </div>
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="border-b border-white/5 bg-white/[0.01]">
          {['Symbol', 'Side', 'Size', 'Entry', 'Mark', 'TP/SL', 'PnL'].map(h => (
            <th key={h} className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <AnimatePresence>
          {positions.map((p, i) => (
            <motion.tr
              key={p.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ delay: i * 0.05 }}
              className="border-b border-white/5 hover:bg-white/[0.03] transition-colors"
            >
              <td className="px-6 py-4 font-black text-sm">{p.symbol}</td>
              <td className="px-6 py-4">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${p.side === 'LONG' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                  {p.side}
                </span>
              </td>
              <td className="px-6 py-4 font-mono text-xs text-slate-400">{p.size}</td>
              <td className="px-6 py-4 font-mono text-xs text-slate-400">${p.entryPrice.toFixed(2)}</td>
              <td className="px-6 py-4 font-mono text-xs text-slate-300 font-bold">${p.markPrice.toFixed(2)}</td>
              <td className="px-6 py-4">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-emerald-500/70 font-mono">TP: ${p.tp.toFixed(2)}</span>
                  <span className="text-[10px] text-rose-500/70 font-mono">SL: ${p.sl.toFixed(2)}</span>
                </div>
              </td>
              <td className="px-6 py-4">
                <div className={`flex flex-col items-end gap-0.5 ${p.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  <span className="font-black text-sm tabular-nums tracking-tighter">${p.pnl.toFixed(2)}</span>
                  <span className="text-[10px] font-bold opacity-70">({p.pnlPercent.toFixed(2)}%)</span>
                </div>
              </td>
            </motion.tr>
          ))}
        </AnimatePresence>
      </tbody>
    </table>
  </div>
);

const TradeHistoryList = ({ history }: { history: TradeHistoryItem[] }) => (
  <div className="glass h-full flex flex-col">
    <div className="px-6 py-4 border-b border-white/5 flex items-center gap-2 bg-white/[0.02]">
      <History size={16} className="text-slate-400" />
      <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400">Trade History</h3>
    </div>
    <div className="overflow-y-auto max-h-[400px]">
      {history.map((t, i) => (
        <div key={t.id} className="px-6 py-4 border-b border-white/5 hover:bg-white/[0.02] flex justify-between items-center transition-colors">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black">{t.symbol}</span>
              <span className={`text-[10px] font-bold ${t.side === 'LONG' ? 'text-emerald-500' : 'text-rose-500'}`}>{t.side}</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">{t.time}</span>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`text-xs font-black ${t.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${
              t.status === 'TP' ? 'bg-emerald-500/10 text-emerald-500' :
              t.status === 'SL' ? 'bg-rose-500/10 text-rose-500' :
              'bg-blue-500/10 text-blue-500'
            }`}>
              {t.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const ExecutionFlow = ({ activeStep }: { activeStep: number }) => {
  const steps = [
    "RUNNING", "BEARISH", "PULLBACK", "REJECTION", "READY", "FILLED", "TRAILING", "TP_HIT"
  ];

  return (
    <div className="glass p-8 flex flex-wrap justify-between items-center gap-4 relative overflow-hidden">
      {steps.map((step, i) => (
        <React.Fragment key={step}>
          <motion.div
            animate={{
              backgroundColor: i <= activeStep ? 'rgba(59, 130, 246, 1)' : 'rgba(255, 255, 255, 0.05)',
              color: i <= activeStep ? '#fff' : 'rgba(148, 163, 184, 0.5)',
              scale: i === activeStep ? 1.05 : 1,
              boxShadow: i === activeStep ? '0 0 20px rgba(59, 130, 246, 0.3)' : 'none'
            }}
            className="px-5 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all duration-500"
          >
            {step}
          </motion.div>
          {i < steps.length - 1 && (
            <ChevronRight size={14} className={i < activeStep ? 'text-blue-500' : 'text-slate-800'} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

interface State {
  snapshot: Snapshot;
  portfolio: {
    balance: number;
    available: number;
    totalPnl: number;
    dailyPnl: number;
    winRate: number;
  };
  activePositions: Position[];
  history: TradeHistoryItem[];
}

function App() {
  const [state, setState] = useState<State>({
    snapshot: {
      system: "BOOTING",
      regime: "UNKNOWN",
      structure: "NONE",
      signal: "IDLE",
      position: "NONE",
      risk: "NORMAL",
      timestamp: new Date().toLocaleTimeString()
    },
    portfolio: {
      balance: 0,
      available: 0,
      totalPnl: 0,
      dailyPnl: 0,
      winRate: 0
    },
    activePositions: [],
    history: []
  });

  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const apiHost = import.meta.env.VITE_ARES_API_URL ?? 'http://localhost:3001';
    const wsUrl = apiHost.replace(/^http/, 'ws');
    let ws: WebSocket;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      if (cancelledRef.current) return;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (cancelledRef.current) {
          ws.close();
          return;
        }
        setError(null);
      };
      ws.onmessage = (event) => {
        if (cancelledRef.current) return;
        try {
          const data = JSON.parse(event.data);
          setState({
            snapshot: {
              system: data.system,
              regime: data.regime,
              structure: data.structure,
              signal: data.signal,
              position: data.position,
              risk: data.risk,
              timestamp: new Date(data.timestamp).toLocaleTimeString()
            },
            portfolio: data.portfolio,
            activePositions: data.activePositions,
            history: data.history
          });
        } catch {
          // ignore invalid JSON
        }
      };
      ws.onerror = () => {
        if (!cancelledRef.current) setError('ARES Engine Offline');
      };
      ws.onclose = () => {
        if (cancelledRef.current) return;
        setError('ARES Engine Offline');
        reconnectTimeout = setTimeout(connect, 3000);
      };
    }

    connect();
    return () => {
      cancelledRef.current = true;
      clearTimeout(reconnectTimeout);
      if (ws?.readyState === WebSocket.OPEN) ws.close();
    };
  }, []);

  const { snapshot, portfolio, activePositions, history } = state;
  const totalBalance = portfolio.balance;
  const totalPnl = portfolio.totalPnl;
  const dailyPnl = portfolio.dailyPnl;

  return (
    <div className="dashboard-root min-h-screen text-slate-100 flex flex-col">
      <header className="px-8 py-4 flex justify-between items-center backdrop-blur-3xl sticky top-0 z-50 border-b border-white/5 bg-black/40">
        <div className="flex items-center gap-8">
          <div className="flex flex-col group cursor-pointer">
            <h1 className="text-2xl font-black tracking-tighter bg-gradient-to-r from-white via-blue-200 to-blue-500 bg-clip-text text-transparent group-hover:scale-105 transition-transform">ARES</h1>
            <span className="text-[8px] uppercase tracking-[0.4em] font-black text-slate-500">Trader Terminal</span>
          </div>

          <nav className="hidden lg:flex items-center gap-6">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-500 ring-1 ring-blue-500/20">
              <Zap size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Dashboard</span>
            </div>
            {['Engine', 'Risk', 'Scanner', 'Reports'].map(item => (
              <span key={item} className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-white cursor-pointer transition-colors px-2">{item}</span>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 group">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]" />
            <span className="text-[10px] font-black text-emerald-500 tracking-wider">SYSTEM.{snapshot.system}</span>
          </div>
          <div className="flex items-center gap-2 opacity-50">
            <Clock size={12} />
            <span className="font-mono text-[10px] tabular-nums tracking-tighter">{snapshot.timestamp} UTC</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1800px] mx-auto w-full px-8 py-8 flex flex-col gap-8">
        {error && (
          <div className="glass p-4 border-l-4 border-l-rose-500 bg-rose-500/10 flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <AlertCircle className="text-rose-500 shrink-0" size={20} />
              <span className="text-sm font-bold text-rose-500 uppercase tracking-widest">{error}</span>
            </div>
            <p className="text-xs text-slate-400 pl-8">
              Start the ARES bot in another terminal: <code className="bg-black/30 px-1.5 py-0.5 rounded">npm run start:paper</code> or <code className="bg-black/30 px-1.5 py-0.5 rounded">npm run dev</code>. Reconnecting every 3s…
            </p>
          </div>
        )}

        {/* Portfolio Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard title="Equity Balance" value={`$${totalBalance.toLocaleString()}`} icon={Wallet} color="blue" />
          <MetricCard title="Total PnL" value={`$${totalPnl.toFixed(2)}`} subValue={`${portfolio.winRate.toFixed(2)} WR`} icon={BarChart3} color="emerald" trend="up" />
          <MetricCard title="Daily PnL" value={`$${dailyPnl.toFixed(2)}`} icon={TrendingUp} color="emerald" trend="up" />
          <MetricCard title="Active Signals" value={String(activePositions.length)} subValue="ScanActive" icon={Activity} color="purple" trend="up" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Main Content: Positions and Flow */}
          <div className="xl:col-span-2 flex flex-col gap-8">
            <section>
              <ExecutionFlow activeStep={3} />
            </section>

            <section>
              <PositionTable positions={activePositions} />
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <StateCard title="Regime Machine" activeState={snapshot.regime} allStates={["BULL", "BEAR", "RANGE", "VOL"]} icon={TrendingDown} color="purple" />
              <StateCard title="Structure Engine" activeState={snapshot.structure} allStates={["BOS", "CHoCH", "SWEEP", "PULLBACK"]} icon={Layers} color="indigo" />
              <StateCard title="Signal Engine" activeState={snapshot.signal} allStates={["IDLE", "ALIGNED", "DISPLACE", "READY"]} icon={Zap} color="amber" />
            </section>
          </div>

          {/* Sidebar: History and Risk */}
          <div className="flex flex-col gap-8">
            <TradeHistoryList history={history} />

            <div className="glass p-6 border-l-4 border-l-rose-500/50">
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck size={18} className="text-rose-500" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Security & Risk</h3>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center p-2 rounded bg-rose-500/5 border border-rose-500/10">
                  <span className="text-[10px] font-bold text-rose-500/80 uppercase">Daily Drawdown Limit</span>
                  <span className="text-[10px] font-black text-rose-500">2.0%</span>
                </div>
                <div className="flex justify-between items-center p-2 rounded bg-emerald-500/5 border border-emerald-500/10">
                  <span className="text-[10px] font-bold text-emerald-500/80 uppercase">Max Consec Losses</span>
                  <span className="text-[10px] font-black text-emerald-500">3/5</span>
                </div>
                <div className="flex justify-between items-center p-2 rounded bg-blue-500/5 border border-blue-500/10">
                  <span className="text-[10px] font-bold text-blue-500/80 uppercase">API Latency</span>
                  <span className="text-[10px] font-black text-blue-500">24ms</span>
                </div>
              </div>
            </div>

            <div className="glass p-6 bg-gradient-to-br from-blue-600/10 to-purple-600/10 border-blue-500/20">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={16} className="text-blue-400" />
                <h4 className="text-xs font-black uppercase text-blue-400">Institutional Feed</h4>
              </div>
              <p className="text-[10px] text-slate-500 italic">High-frequency market data active. All transitions are deterministic and cryptographically logged.</p>
            </div>
          </div>
        </div>
      </main>

      <footer className="px-8 py-6 border-t border-white/5 bg-black/20 text-slate-600">
        <div className="max-w-[1800px] mx-auto w-full flex justify-between items-center">
          <div className="flex items-center gap-4">
            <span className="text-[9px] font-black tracking-widest uppercase">ARES Trading Engine v0.1.0</span>
            <div className="w-1 h-1 rounded-full bg-slate-800" />
            <span className="text-[9px] font-medium">DELTA EXCHANGE ALPHA</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 rounded bg-white/5 text-[9px] font-mono">
            SECURE_HASH: 0x8a9b2...f3c
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
