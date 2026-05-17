import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} from '@discordjs/voice';
import { config } from './config.js';
import { logger } from './logger.js';
import { BackoffManager } from './reconnect.js';

class VoiceManager {
  constructor() {
    this.client = null;
    this.backoff = new BackoffManager({ minDelay: 2000, maxDelay: 60000 });
    this.isConnecting = false;
    this.isRejoining = false;
    this.isShuttingDown = false;
    this.healthCheckTimer = null;
  }

  init(client) {
    this.client = client;
    this.startHealthCheck();
  }

  startHealthCheck() {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    this.healthCheckTimer = setInterval(() => this.verifyHealth(), 30000);
  }

  async disconnectCleanly() {
    const existing = getVoiceConnection(config.guildId);
    if (existing && existing.state.status !== VoiceConnectionStatus.Destroyed) {
      try {
        existing.destroy();
        await new Promise(res => setTimeout(res, 1500));
      } catch (err) {
        logger.debug('Error destroying existing connection', err);
      }
    } else {
      const guild = this.client?.guilds.cache.get(config.guildId);
      if (guild?.shard) {
        guild.shard.send({
          op: 4,
          d: {
            guild_id: config.guildId,
            channel_id: null,
            self_mute: true,
            self_deaf: true
          }
        });
        await new Promise(res => setTimeout(res, 1500));
      }
    }
  }

  async verifyHealth() {
    if (this.isShuttingDown || this.isConnecting || this.isRejoining || !this.client?.isReady()) return;

    try {
      const guild = this.client.guilds.cache.get(config.guildId);
      if (!guild) return;

      const connection = getVoiceConnection(config.guildId);
      const voiceState = guild.members.me?.voice;

      const isConnected = connection && connection.state.status === VoiceConnectionStatus.Ready;
      const isInCorrectChannel = voiceState?.channelId === config.voiceChannelId;
      const isMutedAndDeafened = voiceState?.selfMute && voiceState?.selfDeaf;

      if (!isConnected || !isInCorrectChannel || !isMutedAndDeafened) {
        logger.warn('Health check detected unhealthy voice state. Initiating recovery...', {
          connectionStatus: connection?.state.status,
          channelId: voiceState?.channelId,
          selfMute: voiceState?.selfMute,
          selfDeaf: voiceState?.selfDeaf
        });

        await this.disconnectCleanly();
        await this.join();
      }
    } catch (error) {
      logger.error('Error during voice health verification', error);
    }
  }

  async join() {
    if (this.isShuttingDown || this.isConnecting || !this.client?.isReady()) return;

    this.isConnecting = true;
    logger.info(`Attempting connection to voice channel ${config.voiceChannelId}`);

    try {
      const guild = this.client.guilds.cache.get(config.guildId);
      if (!guild) {
        throw new Error(`Guild ${config.guildId} could not be found in client cache.`);
      }

      await this.disconnectCleanly();

      const connection = joinVoiceChannel({
        channelId: config.voiceChannelId,
        guildId: config.guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true,
        group: 'default'
      });

      this.setupConnectionListeners(connection);

      await entersState(connection, VoiceConnectionStatus.Ready, 20000);
      
      logger.info('Successfully connected to voice channel.');
      this.backoff.reset();
    } catch (error) {
      logger.error('Failed to join voice channel', error);
      this.scheduleRejoin();
    } finally {
      this.isConnecting = false;
    }
  }

  setupConnectionListeners(connection) {
    connection.on('stateChange', (oldState, newState) => {
      logger.info(`Voice connection state changed from ${oldState.status} to ${newState.status}`);
    });

    connection.on('debug', (message) => {
      logger.debug('Voice Debug:', { message });
    });

    connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
      if (this.isShuttingDown) return;

      logger.warn('Voice connection disconnected.', { reason: newState.reason, closeCode: newState.closeCode });

      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
        logger.debug('Connection recovering automatically.');
      } catch {
        logger.warn('Connection failed to recover automatically. Initiating manual rejoin.');
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
          try {
            connection.destroy();
          } catch (err) {
            logger.debug('Error destroying connection on disconnect', err);
          }
        }
        this.scheduleRejoin();
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (!this.isShuttingDown && !this.isConnecting && !this.isRejoining) {
        logger.debug('Connection destroyed unexpectedly. Scheduling rejoin.');
        this.scheduleRejoin();
      }
    });

    connection.on('error', (error) => {
      logger.error('Voice connection encountered an error', error);
    });
  }

  async scheduleRejoin() {
    if (this.isShuttingDown || this.isConnecting || this.isRejoining) return;
    
    this.isRejoining = true;
    try {
      await this.backoff.wait();
      await this.join();
    } finally {
      this.isRejoining = false;
    }
  }

  shutdown() {
    this.isShuttingDown = true;
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    const connection = getVoiceConnection(config.guildId);
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
      try {
        connection.destroy();
        logger.info('Voice connection successfully closed.');
      } catch (err) {
        logger.error('Error closing voice connection during shutdown', err);
      }
    }
  }
}

export const voiceManager = new VoiceManager();
