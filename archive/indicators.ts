/**
 * Technical indicators for trading strategy
 */

export class TechnicalIndicators {
  /**
   * Calculate RSI (Relative Strength Index)
   */
  static calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) {
      throw new Error('Not enough price data for RSI calculation');
    }

    const changes: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    let avgGain = 0;
    let avgLoss = 0;

    // Calculate initial average gain and loss
    for (let i = 0; i < period; i++) {
      if (changes[i] > 0) {
        avgGain += changes[i];
      } else {
        avgLoss += Math.abs(changes[i]);
      }
    }

    avgGain /= period;
    avgLoss /= period;

    // Calculate smoothed averages
    for (let i = period; i < changes.length; i++) {
      if (changes[i] > 0) {
        avgGain = (avgGain * (period - 1) + changes[i]) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(changes[i])) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return rsi;
  }

  /**
   * Calculate SMA (Simple Moving Average)
   */
  static calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) {
      throw new Error('Not enough price data for SMA calculation');
    }

    const slice = prices.slice(-period);
    const sum = slice.reduce((acc, price) => acc + price, 0);
    return sum / period;
  }

  /**
   * Calculate EMA (Exponential Moving Average)
   */
  static calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) {
      throw new Error('Not enough price data for EMA calculation');
    }

    const multiplier = 2 / (period + 1);
    let ema = this.calculateSMA(prices.slice(0, period), period);

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   */
  static calculateMACD(
    prices: number[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
  ): { macd: number; signal: number; histogram: number } {
    const fastEMA = this.calculateEMA(prices, fastPeriod);
    const slowEMA = this.calculateEMA(prices, slowPeriod);
    const macd = fastEMA - slowEMA;

    // For signal line, we need to calculate EMA of MACD values
    // This is simplified - in production, maintain a history of MACD values
    const signal = macd; // Simplified
    const histogram = macd - signal;

    return { macd, signal, histogram };
  }

  /**
   * Calculate Bollinger Bands
   */
  static calculateBollingerBands(
    prices: number[],
    period: number = 20,
    stdDev: number = 2
  ): { upper: number; middle: number; lower: number } {
    const sma = this.calculateSMA(prices, period);
    const slice = prices.slice(-period);

    // Calculate standard deviation
    const squaredDiffs = slice.map(price => Math.pow(price - sma, 2));
    const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / period;
    const standardDeviation = Math.sqrt(variance);

    return {
      upper: sma + (standardDeviation * stdDev),
      middle: sma,
      lower: sma - (standardDeviation * stdDev)
    };
  }

  /**
   * Calculate Average True Range (ATR)
   */
  static calculateATR(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14
  ): number {
    if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) {
      throw new Error('Not enough price data for ATR calculation');
    }

    const trueRanges: number[] = [];

    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trueRanges.push(tr);
    }

    return this.calculateSMA(trueRanges, period);
  }

  /**
   * Detect support and resistance levels
   */
  static findSupportResistance(
    prices: number[],
    tolerance: number = 0.001
  ): { support: number[]; resistance: number[] } {
    const support: number[] = [];
    const resistance: number[] = [];

    for (let i = 2; i < prices.length - 2; i++) {
      // Check for local minimum (support)
      if (
        prices[i] < prices[i - 1] &&
        prices[i] < prices[i - 2] &&
        prices[i] < prices[i + 1] &&
        prices[i] < prices[i + 2]
      ) {
        support.push(prices[i]);
      }

      // Check for local maximum (resistance)
      if (
        prices[i] > prices[i - 1] &&
        prices[i] > prices[i - 2] &&
        prices[i] > prices[i + 1] &&
        prices[i] > prices[i + 2]
      ) {
        resistance.push(prices[i]);
      }
    }

    return { support, resistance };
  }

  /**
   * Calculate price momentum
   */
  static calculateMomentum(prices: number[], period: number = 10): number {
    if (prices.length < period) {
      throw new Error('Not enough price data for momentum calculation');
    }

    return prices[prices.length - 1] - prices[prices.length - period];
  }

  /**
   * Detect trend direction
   */
  static detectTrend(prices: number[], shortPeriod: number = 10, longPeriod: number = 50): 'up' | 'down' | 'sideways' {
    if (prices.length < longPeriod) {
      return 'sideways';
    }

    const shortSMA = this.calculateSMA(prices, shortPeriod);
    const longSMA = this.calculateSMA(prices, longPeriod);

    const threshold = longSMA * 0.001; // 0.1% threshold

    if (shortSMA > longSMA + threshold) {
      return 'up';
    } else if (shortSMA < longSMA - threshold) {
      return 'down';
    } else {
      return 'sideways';
    }
  }
}
