// ARES Dashboard Logic
const systemStates = ["BOOTING", "SYNCING_DATA", "READY", "RUNNING", "PAUSED", "DEGRADED", "ERROR", "SHUTDOWN"];
const marketRegimes = ["TRENDING_BULL", "TRENDING_BEAR", "RANGING", "VOLATILE_EXPANSION", "VOLATILE_COMPRESSION", "NEWS_EVENT", "UNKNOWN"];
const structureStates = ["BULLISH_STRUCTURE", "BEARISH_STRUCTURE", "TRANSITION", "BOS_CONFIRMED", "CHOCH_CONFIRMED", "LIQUIDITY_SWEEP", "EQUILIBRIUM_ROTATION", "IMPULSE_PHASE", "PULLBACK_PHASE", "DISTRIBUTION", "ACCUMULATION"];
const signalStates = ["IDLE", "HTF_BIAS_CONFIRMED", "STRUCTURE_ALIGNED", "DISPLACEMENT_DETECTED", "LIQUIDITY_SWEEP_DETECTED", "PULLBACK_DETECTED", "REJECTION_CONFIRMED", "READY_TO_EXECUTE", "ORDER_PLACED", "ORDER_FILLED", "INVALIDATED"];
const positionStates = ["NONE", "OPEN", "BREAKEVEN", "TRAILING", "PARTIAL_TP_HIT", "FULL_TP_HIT", "STOP_LOSS_HIT", "FORCE_CLOSED"];
const riskStates = ["NORMAL", "DAILY_DRAWDOWN_LIMIT_HIT", "MAX_CONSECUTIVE_LOSSES", "VOLATILITY_EXCEEDED", "LIQUIDITY_LOW", "API_LATENCY_HIGH", "GLOBAL_KILL_SWITCH"];

const signalTaxonomy = [
    { type: "HTF_CONTINUATION", desc: "Trend-following pullback to HTF supply/demand." },
    { type: "HTF_REVERSAL", desc: "Counter-trend reversal after liquidity sweep + CHoCH." },
    { type: "LIQUIDITY_SWEEP_REVERSAL", desc: "Fast scalp on sweep of known liquidity pools." },
    { type: "BREAKOUT_EXPANSION", desc: "Volatility expansion from long-term compression." },
    { type: "RANGE_ROTATION", desc: "Trading range boundaries with mean reversion." },
    { type: "FAILED_BREAK", desc: "Trapping breakout traders back inside the range." },
    { type: "MOMENTUM_SCALP", desc: "High-probability scalp on consecutive volume spikes." },
    { type: "VOLATILITY_COMPRESSION", desc: "Preparing for explosive move during tight range." }
];

const highLevelFlow = [
    "SYSTEM.RUNNING",
    "MarketRegime.TRENDING_BEAR",
    "Structure.BEARISH_STRUCTURE",
    "Signal.HTF_BIAS_CONFIRMED",
    "Signal.DISPLACEMENT_DETECTED",
    "Signal.PULLBACK_DETECTED",
    "Signal.REJECTION_CONFIRMED",
    "Signal.READY_TO_EXECUTE",
    "ORDER_FILLED",
    "Position.OPEN",
    "Position.TRAILING",
    "Position.FULL_TP_HIT",
    "Signal.IDLE"
];

function populateList(id, states, activeIndex) {
    const list = document.getElementById(id);
    states.forEach((state, index) => {
        const item = document.createElement('div');
        item.className = `state-item ${index === activeIndex ? 'active' : ''}`;
        item.textContent = state;
        list.appendChild(item);
    });
}

function renderFlow() {
    const container = document.getElementById('flow-diagram');
    highLevelFlow.forEach((step, index) => {
        const div = document.createElement('div');
        div.className = `flow-step ${index === 3 ? 'active' : ''}`; // Mock active state
        div.textContent = step;
        container.appendChild(div);

        if (index < highLevelFlow.length - 1) {
            const arrow = document.createElement('div');
            arrow.className = 'flow-arrow';
            arrow.textContent = '↓';
            container.appendChild(arrow);
        }
    });
}

function renderTaxonomy() {
    const grid = document.getElementById('taxonomy-grid');
    signalTaxonomy.forEach(signal => {
        const card = document.createElement('div');
        card.className = 'signal-card';
        card.innerHTML = `
            <span class="type">${signal.type}</span>
            <span class="desc">${signal.desc}</span>
        `;
        grid.appendChild(card);
    });
}

function updateTime() {
    const footerTime = document.getElementById('footer-time');
    footerTime.textContent = new Date().toISOString();
}

window.onload = () => {
    populateList('list-system', systemStates, 3);
    populateList('list-regime', marketRegimes, 1);
    populateList('list-structure', structureStates, 8);
    populateList('list-signal', signalStates, 5);
    populateList('list-position', positionStates, 0);
    populateList('list-risk', riskStates, 0);

    renderFlow();
    renderTaxonomy();
    updateTime();
    setInterval(updateTime, 1000);

    // Mock "live" feel: rotate active states in regime or structure occasionally
    setInterval(() => {
        const status = document.getElementById('global-status');
        status.style.opacity = status.style.opacity === "0.5" ? "1" : "0.5";
    }, 1000);
};
