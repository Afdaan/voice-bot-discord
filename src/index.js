import dns from 'node:dns';
import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { voiceManager } from './voice-manager.js';

dns.setDefaultResultOrder('ipv4first');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.once('clientReady', () => {
  logger.info(`Bot logged in successfully as ${client.user?.tag}`);

  const activityObj = {
    name: config.activityName,
    type: config.activityType,
    details: config.rpcDetails,
    state: config.rpcState,
    timestamps: { start: new Date() }
  };
  if (config.rpcLargeImage) {
    activityObj.assets = {
      largeImage: config.rpcLargeImage,
      largeText: config.rpcLargeText
    };
  }

  client.user?.setPresence({
    activities: [activityObj],
    status: 'online'
  });
  logger.info(`Rich presence set to: [${config.activityType}] ${config.activityName}`);

  voiceManager.init(client);
  voiceManager.join();
});

client.on('voiceStateUpdate', (oldState, newState) => {
  if (newState.member?.user.id === client.user?.id) {
    if (!newState.channelId || newState.channelId !== config.voiceChannelId) {
      logger.warn('Bot voice state changed or disconnected externally. Instantly rejoining...');
      voiceManager.join();
    }
  }
});

client.on('shardReconnecting', (id) => {
  logger.info(`Websocket shard ${id} reconnecting...`);
});

client.on('shardResume', (id, replayedEvents) => {
  logger.info(`Websocket shard ${id} resumed connection. Replayed ${replayedEvents} events.`);
  voiceManager.join();
});

client.on('shardDisconnect', (event, id) => {
  logger.warn(`Websocket shard ${id} disconnected.`, { code: event.code, reason: event.reason });
});

client.on('error', (error) => {
  logger.error('Discord client encountered an error', error);
});

async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  voiceManager.shutdown();
  
  try {
    await client.destroy();
    logger.info('Discord client successfully destroyed.');
  } catch (error) {
    logger.error('Error destroying Discord client', error);
  }

  logger.info('Process exit.');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason instanceof Error ? reason : new Error(String(reason)));
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  gracefulShutdown('uncaughtException');
});

logger.info('Starting Discord AFK Voice Bot...');
client.login(config.token).catch((error) => {
  logger.error('Fatal error during initial login', error);
  process.exit(1);
});
