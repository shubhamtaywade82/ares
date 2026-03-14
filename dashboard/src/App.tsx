import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  TrendingDown,
  Layers,
  Zap,
  ShieldCheck,
  Clock,
  ChevronRight,
  TrendingUp,
  Wallet,
  BarChart3,
  History,
  AlertCircle,
  Brain
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

interface MarketTicker {
  symbol: string;
  lastPrice: number;
}

interface AiAnalysisEntry {
  symbol: string;
  intent: string;
  decision: 'ALLOW' | 'BLOCK';
  reason: string;
  timestamp: number;
}

interface SmcSymbolData {
  bias: string;
  swings: Array<{ price: number; type: string; index: number }>;
  breaks: Array<{ type: string; price: number; timestamp: number }>;
  fvgs: Array<{ type: string; top: number; bottom: number; isFilled: boolean }>;
  orderBlocks: Array<{ type: string; top: number; bottom: number; isMitigated: boolean }>;
  sweeps: Array<{ type: string; reference: number; timestamp: number }>;
  activeSweep: { type: string; reference: number } | null;
  sweepMetrics: { ageBars: number; ageMinutes: number; volumeRatio: number } | null;
  displacement: { type: string; strength: number; pullbackZone?: { entry: number; stop: number } } | null;
}

/** Show real numeric value without fixed decimal rounding */
function formatRaw(n: number): string {
  return Number.isFinite(n) ? String(n) : '—';
}

/** Trader-friendly labels for market regime */
function regimeLabel(regime: string): string {
  const map: Record<string, string> = {
    TRENDING_BULL: 'Bull',
    TRENDING_BEAR: 'Bear',
    RANGING: 'Range',
    VOLATILE_EXPANSION: 'Vol expansion',
    VOLATILE_COMPRESSION: 'Vol compression',
    NEWS_EVENT: 'News',
    UNKNOWN: '—',
  };
  return map[regime] ?? regime;
}

/** Trader-friendly labels for structure */
function structureLabel(s: string): string {
  const map: Record<string, string> = {
    BULLISH_STRUCTURE: 'Bullish',
    BEARISH_STRUCTURE: 'Bearish',
    BOS_CONFIRMED: 'BOS',
    CHOCH_CONFIRMED: 'CHoCH',
    LIQUIDITY_SWEEP: 'Sweep',
    PULLBACK_PHASE: 'Pullback',
    IMPULSE_PHASE: 'Impulse',
    TRANSITION: 'Transition',
    NONE: '—',
  };
  return map[s] ?? s.replace(/_/g, ' ');
}

/** Trader-friendly labels for signal state */
function signalLabel(s: string): string {
  const map: Record<string, string> = {
    IDLE: 'Idle',
    HTF_BIAS_CONFIRMED: 'Bias OK',
    STRUCTURE_ALIGNED: 'Aligned',
    DISPLACEMENT_DETECTED: 'Displacement',
    LIQUIDITY_SWEEP_DETECTED: 'Sweep',
    PULLBACK_DETECTED: 'Pullback',
    REJECTION_CONFIRMED: 'Rejection',
    READY_TO_EXECUTE: 'Ready',
    ORDER_PLACED: 'Placed',
    ORDER_FILLED: 'Filled',
    INVALIDATED: 'Invalid',
  };
  return map[s] ?? s.replace(/_/g, ' ');
}

/** Brief flash on value change */
const FlashValue = ({ children, value }: { children: React.ReactNode, value: any }) => {
  return (
    <motion.div
      key={value}
      initial={{ opacity: 0.5, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="inline-block"
    >
      <motion.div
        animate={{
          backgroundColor: ["rgba(59, 130, 246, 0)", "rgba(59, 130, 246, 0.2)", "rgba(59, 130, 246, 0)"],
        }}
        transition={{ duration: 0.4 }}
        className="rounded px-1 -mx-1"
      >
        {children}
      </motion.div>
    </motion.div>
  );
};

const MetricCard = ({ title, value, subValue, icon: Icon, color, trend }: { title: string, value: string, subValue?: string, icon: any, color: string, trend?: 'up' | 'down' }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="glass p-5 flex items-center gap-4 group hover:border-blue-500/30 transition-all"
  >
    <div className={`p-3 rounded-2xl bg-${color}-500/10 text-${color}-500 group-hover:scale-110 transition-transform`}>
      <Icon size={24} />
    </div>
    <div className="flex flex-col overflow-hidden">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{title}</span>
      <div className="flex items-baseline gap-2">
        <FlashValue value={value}>
          <span className="text-2xl font-black tabular-nums tracking-tighter">{value}</span>
        </FlashValue>
        {subValue && (
          <span className={`text-xs font-bold ${trend === 'up' ? 'text-emerald-500' : 'text-rose-500'}`}>
            {trend === 'up' ? '+' : ''}{subValue}
          </span>
        )}
      </div>
    </div>
  </motion.div>
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

const StateCard = ({ title, activeState, allStates, formatLabel, icon: Icon, color }: { title: string, activeState: string, allStates: string[], formatLabel?: (s: string) => string, icon: any, color: string }) => (
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
      {allStates.map(state => {
        const label = formatLabel ? formatLabel(state) : state;
        return (
          <span
            key={state}
            className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all duration-300 ${
              state === activeState
                ? `bg-${color}-500 text-white shadow-lg shadow-${color}-500/20 ring-1 ring-${color}-400/50`
                : 'bg-white/5 text-slate-600'
            }`}
          >
            {label}
          </span>
        );
      })}
    </div>
  </motion.div>
);

/** At-a-glance strip: current trend, structure, signal, position, risk */
const CurrentTrendStrip = ({ snapshot }: { snapshot: Snapshot }) => {
  const trendColor = snapshot.regime === 'TRENDING_BULL' ? 'emerald' : snapshot.regime === 'TRENDING_BEAR' ? 'rose' : 'slate';
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass p-4 flex flex-wrap items-center gap-6 border-l-4 border-l-blue-500/60"
    >
      <div className="flex items-center gap-2">
        <TrendingUp size={18} className="text-slate-400" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Trend</span>
        <span className={`px-2.5 py-1 rounded font-black text-xs ${trendColor === 'emerald' ? 'bg-emerald-500/20 text-emerald-400' : trendColor === 'rose' ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-500/20 text-slate-400'}`}>
          {regimeLabel(snapshot.regime)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Layers size={18} className="text-slate-400" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Structure</span>
        <span className="px-2.5 py-1 rounded font-mono text-xs bg-indigo-500/20 text-indigo-300">
          {structureLabel(snapshot.structure)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Zap size={18} className="text-slate-400" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Signal</span>
        <span className="px-2.5 py-1 rounded font-mono text-xs bg-amber-500/20 text-amber-300">
          {signalLabel(snapshot.signal)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Activity size={18} className="text-slate-400" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Position</span>
        <span className="px-2.5 py-1 rounded text-xs bg-white/10 text-slate-300">
          {snapshot.position === 'NONE' ? '—' : snapshot.position.replace(/_/g, ' ')}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-slate-400" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Risk</span>
        <span className={`px-2.5 py-1 rounded text-xs font-bold ${snapshot.risk === 'NORMAL' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
          {snapshot.risk === 'NORMAL' ? 'OK' : snapshot.risk.replace(/_/g, ' ')}
        </span>
      </div>
    </motion.section>
  );
};

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
              <td className="px-6 py-4 font-mono text-xs text-slate-400">${formatRaw(p.entryPrice)}</td>
              <td className="px-6 py-4 font-mono text-xs text-slate-300 font-bold">
                <FlashValue value={p.markPrice}>
                  ${formatRaw(p.markPrice)}
                </FlashValue>
              </td>
              <td className="px-6 py-4">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-emerald-500/70 font-mono">TP: ${formatRaw(p.tp)}</span>
                  <span className="text-[10px] text-rose-500/70 font-mono">SL: ${formatRaw(p.sl)}</span>
                </div>
              </td>
              <td className="px-6 py-4 text-right">
                <FlashValue value={p.pnl}>
                  <div className={`flex flex-col items-end gap-0.5 ${p.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    <span className="font-black text-sm tabular-nums tracking-tighter">₹{formatRaw(p.pnl)}</span>
                    <span className="text-[10px] font-bold opacity-70">({formatRaw(p.pnlPercent)}%)</span>
                  </div>
                </FlashValue>
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
      {history.map((t) => (
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
              {t.pnl >= 0 ? '+' : ''}₹{formatRaw(t.pnl)}
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

const SmcPanel = ({ smcData }: { smcData: Record<string, SmcSymbolData> }) => {
  const symbols = Object.keys(smcData);
  if (symbols.length === 0) return null;

  return (
    <div className="glass overflow-hidden">
      <div className="px-6 py-4 border-b border-white/5 flex items-center gap-2 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-l-4 border-l-amber-500/60">
        <Layers size={18} className="text-amber-400" />
        <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">SMC Live</h3>
        <span className="text-[10px] text-slate-500">Smart Money Concepts</span>
      </div>
      <div className="divide-y divide-white/5">
        {symbols.map((symbol) => {
          const d = smcData[symbol];
          if (!d) return null;
          const biasColor = d.bias === 'BULLISH' ? 'text-emerald-400' : d.bias === 'BEARISH' ? 'text-rose-400' : 'text-slate-500';
          return (
            <div key={symbol} className="px-6 py-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm font-black">{symbol}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded font-black uppercase ${biasColor} ${d.bias === 'BULLISH' ? 'bg-emerald-500/10' : d.bias === 'BEARISH' ? 'bg-rose-500/10' : 'bg-slate-500/10'}`}>
                  {d.bias}
                </span>
                {d.activeSweep && (
                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${d.activeSweep.type === 'BULL_TRAP' ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                    {d.activeSweep.type}
                  </span>
                )}
                {d.displacement && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold">
                    DISP {d.displacement.strength?.toFixed(1)}x
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 text-[10px]">
                {/* FVGs */}
                <div>
                  <span className="text-slate-500 font-bold uppercase block mb-1">FVGs</span>
                  {d.fvgs.length === 0 ? (
                    <span className="text-slate-600">None</span>
                  ) : d.fvgs.map((f, i) => (
                    <div key={i} className={`flex items-center gap-1 ${f.type === 'BULLISH' ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>
                      <span className="font-mono">{f.bottom.toFixed(2)}-{f.top.toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                {/* Order Blocks */}
                <div>
                  <span className="text-slate-500 font-bold uppercase block mb-1">OBs</span>
                  {d.orderBlocks.length === 0 ? (
                    <span className="text-slate-600">None</span>
                  ) : d.orderBlocks.map((ob, i) => (
                    <div key={i} className={`flex items-center gap-1 ${ob.type === 'BULLISH' ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>
                      <span className="font-mono">{ob.bottom.toFixed(2)}-{ob.top.toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                {/* Sweeps + Metrics */}
                <div>
                  <span className="text-slate-500 font-bold uppercase block mb-1">Sweeps</span>
                  {d.sweeps.length === 0 ? (
                    <span className="text-slate-600">None</span>
                  ) : d.sweeps.map((s, i) => (
                    <div key={i} className={`${s.type === 'BEAR_TRAP' ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>
                      <span className="font-mono">{s.type} @{s.reference.toFixed(2)}</span>
                    </div>
                  ))}
                  {d.sweepMetrics && (
                    <div className="text-slate-500 mt-1 font-mono">
                      {d.sweepMetrics.ageBars}bars | vol:{d.sweepMetrics.volumeRatio.toFixed(1)}x
                    </div>
                  )}
                </div>
              </div>

              {/* Displacement pullback zone */}
              {d.displacement?.pullbackZone && (
                <div className="mt-2 px-3 py-2 rounded bg-amber-500/5 border border-amber-500/10 flex items-center gap-4 text-[10px]">
                  <span className="text-amber-500 font-bold uppercase">Pullback Zone</span>
                  <span className="text-slate-400 font-mono">Entry: {d.displacement.pullbackZone.entry.toFixed(2)}</span>
                  <span className="text-slate-400 font-mono">Stop: {d.displacement.pullbackZone.stop.toFixed(2)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
  marketTickers: MarketTicker[];
  aiAnalysis: AiAnalysisEntry[];
  smcData: Record<string, SmcSymbolData>;
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
    history: [],
    marketTickers: [],
    aiAnalysis: [],
    smcData: {},
  });

  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const apiHost = import.meta.env.VITE_ARES_API_URL ?? 'http://localhost:3001';
    const wsUrl = apiHost.replace(/^http/, 'ws');
    let ws: WebSocket;
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let showErrorTimeout: ReturnType<typeof setTimeout>;

    function scheduleOfflineMessage() {
      clearTimeout(showErrorTimeout);
      showErrorTimeout = setTimeout(() => {
        if (!cancelledRef.current) setError('ARES Engine Offline');
      }, 2000);
    }

    function clearOfflineMessage() {
      clearTimeout(showErrorTimeout);
      setError(null);
    }

    function connect() {
      if (cancelledRef.current) return;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (cancelledRef.current) {
          ws.close();
          return;
        }
        clearOfflineMessage();
      };
      ws.onmessage = (event) => {
        if (cancelledRef.current) return;
        try {
          const data = JSON.parse(event.data);
          const rawPositions = data.activePositions ?? [];
          const rawHistory = data.history ?? [];
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
            portfolio: data.portfolio ?? {
              balance: 0,
              available: 0,
              totalPnl: 0,
              dailyPnl: 0,
              winRate: 0,
            },
            activePositions: rawPositions.map((p: Record<string, unknown>) => ({
              id: String(p.entryOrderId ?? p.id ?? ''),
              symbol: String(p.symbol ?? ''),
              side: (p.side === 'buy' ? 'LONG' : 'SHORT') as 'LONG' | 'SHORT',
              entryPrice: Number(p.entryPrice ?? 0),
              markPrice: Number(p.markPrice ?? p.entryPrice ?? 0),
              size: Number(p.filledQty ?? p.entryQty ?? p.size ?? 0),
              pnl: Number(p.pnl ?? 0),
              pnlPercent: Number(p.pnlPercent ?? 0),
              tp: Number(p.tp1Price ?? p.tp ?? p.entryPrice ?? 0),
              sl: Number(p.slPrice ?? p.sl ?? p.entryPrice ?? 0),
            })),
            history: rawHistory.map((h: Record<string, unknown>) => ({
              id: String(h.id ?? ''),
              symbol: String(h.symbol ?? ''),
              side: (h.side === 'buy' ? 'LONG' : 'SHORT') as 'LONG' | 'SHORT',
              entryPrice: Number(h.entryPrice ?? 0),
              exitPrice: Number(h.slFilledPrice ?? h.tp1FilledPrice ?? h.entryPrice ?? 0),
              pnl: Number(h.realizedPnl ?? h.pnl ?? 0),
              status: (h.exitReason === 'TP1' || h.exitReason === 'TP2' || h.exitReason === 'PROFIT_TARGET' ? 'TP' : h.exitReason === 'SL' ? 'SL' : 'FORCE_CLOSED') as 'TP' | 'SL' | 'FORCE_CLOSED',
              time: new Date(Number(h.closedTime ?? h.entryTime ?? 0)).toLocaleTimeString(),
            })),
            marketTickers: Array.isArray(data.market?.tickers)
              ? data.market.tickers.map((t: Record<string, unknown>) => ({
                  symbol: String(t.symbol ?? ''),
                  lastPrice: Number(t.lastPrice ?? 0),
                }))
              : [],
            aiAnalysis: Array.isArray(data.aiAnalysis)
              ? data.aiAnalysis.map((a: Record<string, unknown>) => ({
                  symbol: String(a.symbol ?? ''),
                  intent: String(a.intent ?? ''),
                  decision: (a.decision === 'ALLOW' ? 'ALLOW' : 'BLOCK') as 'ALLOW' | 'BLOCK',
                  reason: String(a.reason ?? ''),
                  timestamp: Number(a.timestamp ?? 0),
                }))
              : [],
            smcData: (data.smcData && typeof data.smcData === 'object') ? data.smcData as Record<string, SmcSymbolData> : {},
          });
        } catch {
          // ignore invalid JSON
        }
      };
      ws.onerror = () => {
        if (!cancelledRef.current) scheduleOfflineMessage();
      };
      ws.onclose = () => {
        if (cancelledRef.current) return;
        scheduleOfflineMessage();
        reconnectTimeout = setTimeout(connect, 3000);
      };
    }

    connect();
    return () => {
      cancelledRef.current = true;
      clearTimeout(showErrorTimeout);
      clearTimeout(reconnectTimeout);
      if (ws?.readyState === WebSocket.OPEN) ws.close();
    };
  }, []);

  const { snapshot, portfolio, activePositions, history, marketTickers, aiAnalysis, smcData } = state;
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
          <MetricCard title="Equity Balance" value={`₹${formatRaw(totalBalance)}`} icon={Wallet} color="blue" />
          <MetricCard title="Total PnL" value={`₹${formatRaw(totalPnl)}`} subValue={`${formatRaw(portfolio.winRate)} WR`} icon={BarChart3} color="emerald" trend="up" />
          <MetricCard title="Daily PnL" value={`₹${formatRaw(dailyPnl)}`} icon={TrendingUp} color="emerald" trend="up" />
          <MetricCard title="Active Signals" value={String(activePositions.length)} subValue="ScanActive" icon={Activity} color="purple" trend="up" />
        </div>

        {/* Current trend & market context — at a glance for traders */}
        <CurrentTrendStrip snapshot={snapshot} />

        {/* Futures Watchlist — live last price from WebSocket ticker */}
        {marketTickers.length > 0 && (
          <section className="glass overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center gap-2 bg-white/[0.02]">
              <Activity size={16} className="text-slate-400" />
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Futures Watchlist</h2>
              <span className="text-[10px] text-slate-500">Live from Delta Exchange</span>
            </div>
            <div className="p-4 flex flex-wrap gap-4">
              {marketTickers.map((t) => (
                <div
                  key={t.symbol}
                  className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 flex items-baseline gap-3 min-w-[140px]"
                >
                  <span className="text-xs font-black text-slate-300">{t.symbol}</span>
                  <FlashValue value={t.lastPrice}>
                    <span className="font-mono text-sm font-bold tabular-nums text-white">
                      {t.lastPrice > 0 ? `$${formatRaw(t.lastPrice)}` : <span className="text-slate-500 font-normal">—</span>}
                    </span>
                  </FlashValue>
                </div>
              ))}
            </div>
            {marketTickers.length > 0 && marketTickers.every((t) => t.lastPrice <= 0) && (
              <p className="px-6 pb-4 text-[10px] text-slate-500">Waiting for market feed… Ensure the bot is running and Delta WebSocket is connected.</p>
            )}
          </section>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Main Content: Positions and Flow */}
          <div className="xl:col-span-2 flex flex-col gap-8">
            <section>
              <ExecutionFlow activeStep={3} />
            </section>

            <section>
              <PositionTable positions={activePositions} />
            </section>

            {/* SMC Live Data */}
            <section>
              <SmcPanel smcData={smcData} />
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <StateCard
                title="Regime"
                activeState={snapshot.regime}
                allStates={["TRENDING_BULL", "TRENDING_BEAR", "RANGING", "VOLATILE_EXPANSION", "VOLATILE_COMPRESSION", "UNKNOWN"]}
                formatLabel={regimeLabel}
                icon={TrendingDown}
                color="purple"
              />
              <StateCard
                title="Structure"
                activeState={snapshot.structure}
                allStates={["BULLISH_STRUCTURE", "BEARISH_STRUCTURE", "BOS_CONFIRMED", "CHOCH_CONFIRMED", "LIQUIDITY_SWEEP", "PULLBACK_PHASE", "NONE"]}
                formatLabel={structureLabel}
                icon={Layers}
                color="indigo"
              />
              <StateCard
                title="Signal"
                activeState={snapshot.signal}
                allStates={["IDLE", "HTF_BIAS_CONFIRMED", "STRUCTURE_ALIGNED", "READY_TO_EXECUTE", "ORDER_FILLED", "INVALIDATED"]}
                formatLabel={signalLabel}
                icon={Zap}
                color="amber"
              />
            </section>
          </div>

          {/* Sidebar: History and Risk */}
          <div className="flex flex-col gap-8">
            <TradeHistoryList history={history} />

            {/* AI Veto / Pulse — always visible, most recent first */}
            <section className="glass overflow-hidden flex flex-col flex-1 min-h-0">
              <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between gap-2 bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 border-l-4 border-l-violet-500/60">
                <div className="flex items-center gap-2">
                  <Brain size={20} className="text-violet-400" />
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">AI Analysis</h3>
                  <span className="text-[10px] text-slate-500">Veto / Pulse by symbol</span>
                </div>
                {aiAnalysis.length > 0 && (
                  <span className="text-[10px] font-mono text-slate-500">{aiAnalysis.length} recent</span>
                )}
              </div>
              <div className="overflow-y-auto flex-1 min-h-[200px] max-h-[380px]">
                {aiAnalysis.length === 0 ? (
                  <div className="px-6 py-8 text-center">
                    <Brain size={32} className="mx-auto text-slate-600 mb-2" />
                    <p className="text-xs text-slate-500">No AI analysis yet.</p>
                    <p className="text-[10px] text-slate-600 mt-1">Bot will populate as it scans symbols (ENTRY/PULSE).</p>
                  </div>
                ) : (
                  aiAnalysis.map((a, idx) => (
                    <motion.div
                      key={`${a.timestamp}-${a.symbol}-${idx}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="px-6 py-4 border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className="text-sm font-black text-slate-200">{a.symbol}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-500/20 text-slate-400 uppercase font-bold">
                          {a.intent}
                        </span>
                        <span className={`text-xs font-black px-2 py-0.5 rounded ${a.decision === 'ALLOW' ? 'bg-emerald-500/25 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-rose-500/25 text-rose-400 ring-1 ring-rose-500/30'}`}>
                          {a.decision}
                        </span>
                        <span className="text-[9px] text-slate-500 ml-auto font-mono">
                          {new Date(a.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">{a.reason}</p>
                    </motion.div>
                  ))
                )}
              </div>
            </section>

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
