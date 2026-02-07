import dotenv from 'dotenv';
import { ScalpingBot } from './scalpingBot';
import { logger } from './utils/logger';
import { DeltaConfig, TradingConfig, StrategyConfig } from './types';

// Load environment variables
dotenv.config();

// Validate required environment variables
function validateEnv(): void {
  const required = ['API_KEY', 'API_SECRET', 'PRODUCT_ID', 'PRODUCT_SYMBOL'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// Parse configuration from environment
function loadConfig(): {
  deltaConfig: DeltaConfig;
  tradingConfig: TradingConfig;
  strategyConfig: StrategyConfig;
} {
  validateEnv();

  const deltaConfig: DeltaConfig = {
    apiKey: process.env.API_KEY!,
    apiSecret: process.env.API_SECRET!,
    baseUrl: process.env.BASE_URL || 'https://api.india.delta.exchange',
    wsUrl: process.env.WS_URL || 'wss://socket.india.delta.exchange'
  };

  const tradingConfig: TradingConfig = {
    productId: parseInt(process.env.PRODUCT_ID!),
    productSymbol: process.env.PRODUCT_SYMBOL!,
    positionSize: parseInt(process.env.POSITION_SIZE || '10'),
    profitTargetPercent: parseFloat(process.env.PROFIT_TARGET_PERCENT || '0.1'),
    stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT || '0.05'),
    maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '3'),
    leverage: parseInt(process.env.LEVERAGE || '10'),
    maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || '1000'),
    maxPositionSize: parseInt(process.env.MAX_POSITION_SIZE || '100')
  };

  const strategyConfig: StrategyConfig = {
    rsiPeriod: parseInt(process.env.RSI_PERIOD || '14'),
    rsiOverbought: parseInt(process.env.RSI_OVERBOUGHT || '70'),
    rsiOversold: parseInt(process.env.RSI_OVERSOLD || '30')
  };

  return { deltaConfig, tradingConfig, strategyConfig };
}

// Main function
async function main(): Promise<void> {
  try {
    logger.info('='.repeat(60));
    logger.info('Delta Exchange Scalping Bot');
    logger.info('='.repeat(60));

    // Load configuration
    const { deltaConfig, tradingConfig, strategyConfig } = loadConfig();

    logger.info('Configuration loaded:', {
      product: tradingConfig.productSymbol,
      productId: tradingConfig.productId,
      leverage: tradingConfig.leverage,
      positionSize: tradingConfig.positionSize,
      profitTarget: tradingConfig.profitTargetPercent + '%',
      stopLoss: tradingConfig.stopLossPercent + '%'
    });

    // Create bot instance
    const bot = new ScalpingBot(deltaConfig, tradingConfig, strategyConfig);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('\nReceived SIGINT, shutting down gracefully...');
      await bot.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('\nReceived SIGTERM, shutting down gracefully...');
      await bot.stop();
      process.exit(0);
    });

    // Handle uncaught errors
    process.on('uncaughtException', async (error) => {
      logger.error('Uncaught exception:', error);
      await bot.stop();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      await bot.stop();
      process.exit(1);
    });

    // Start the bot
    await bot.start();

    // Log status periodically
    setInterval(() => {
      const status = bot.getStatus();
      logger.info('Bot Status:', {
        running: status.isRunning,
        position: status.position ? {
          size: status.position.size,
          entryPrice: status.position.entry_price,
          unrealizedPnL: status.position.unrealized_pnl
        } : 'No position',
        openOrders: status.openOrders,
        riskStats: status.riskStats
      });
    }, 60000); // Log every minute

  } catch (error) {
    logger.error('Fatal error in main:', error);
    process.exit(1);
  }
}

// Run the bot
if (require.main === module) {
  main().catch(error => {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  });
}

export { main };
