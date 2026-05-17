import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} from '@discordjs/voice';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
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
    this.voiceStateDebounce = null;
    this.lastRejoinTime = 0;
    this.unhealthyCount = 0;
  }

  init(client) {
    this.client = client;
    this.startHealthCheck();
  }

  startHealthCheck() {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    this.healthCheckTimer = setInterval(() => this.verifyHealth(), 30000);
  }

  cleanupConnection(connection) {
    if (!connection) return;
    try {
      connection.removeAllListeners();
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
      }
    } catch (err) {
      logger.debug('Error destroying voice connection during cleanup', err);
    }
  }

  async disconnectCleanly() {
    const existing = getVoiceConnection(config.guildId);
    if (existing) {
      this.cleanupConnection(existing);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  async validateTargetChannel(guild) {
    const channel = await guild.channels.fetch(config.voiceChannelId);
    if (!channel) {
      throw new Error(`Voice channel ${config.voiceChannelId} was not found in guild ${config.guildId}.`);
    }

    if (!channel.isVoiceBased?.()) {
      throw new Error(`Configured channel ${config.voiceChannelId} is not a voice-based channel. Current type: ${channel.type}.`);
    }

    const botMember = guild.members.me ?? await guild.members.fetch(this.client.user.id);
    const permissions = channel.permissionsFor(botMember);
    const missingPermissions = [];

    if (!permissions?.has(PermissionFlagsBits.ViewChannel)) missingPermissions.push('View Channel');
    if (!permissions?.has(PermissionFlagsBits.Connect)) missingPermissions.push('Connect');

    if (missingPermissions.length > 0) {
      throw new Error(`Bot is missing required voice channel permissions: ${missingPermissions.join(', ')}.`);
    }

    if (channel.type !== ChannelType.GuildStageVoice && !permissions?.has(PermissionFlagsBits.Speak)) {
      logger.warn('Bot is missing Speak permission in the target voice channel. Joining may work, but audio transmission would fail.');
    }

    if (channel.userLimit > 0 && channel.members.size >= channel.userLimit && !permissions?.has(PermissionFlagsBits.MoveMembers)) {
      throw new Error(`Target voice channel is full (${channel.members.size}/${channel.userLimit}) and the bot cannot bypass the user limit.`);
    }

    logger.info(`Validated target voice channel "${channel.name}" (${channel.id})`, {
      type: channel.type,
      userLimit: channel.userLimit,
      members: channel.members.size,
      rtcRegion: channel.rtcRegion
    });

    return channel;
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
        this.unhealthyCount++;
        if (this.unhealthyCount >= 2) {
          logger.warn('Health check confirmed unhealthy voice state across consecutive cycles. Initiating recovery...', {
            connectionStatus: connection?.state.status,
            channelId: voiceState?.channelId,
            selfMute: voiceState?.selfMute,
            selfDeaf: voiceState?.selfDeaf
          });
          this.unhealthyCount = 0;
          await this.disconnectCleanly();
          await this.join();
        } else {
          logger.debug('Health check detected potential abnormal voice state. Observing next cycle...');
        }
      } else {
        this.unhealthyCount = 0;
      }
    } catch (error) {
      logger.error('Error during voice health verification', error);
    }
  }

  async join() {
    if (this.isShuttingDown || this.isConnecting || !this.client?.isReady()) return;

    const existing = getVoiceConnection(config.guildId);
    const voiceState = this.client.guilds.cache.get(config.guildId)?.members.me?.voice;
    if (existing?.state.status === VoiceConnectionStatus.Ready && voiceState?.channelId === config.voiceChannelId) {
      logger.debug('Active ready connection already exists in target channel. Skipping join.');
      return;
    }

    this.isConnecting = true;
    logger.info(`Attempting connection to voice channel ${config.voiceChannelId}`);

    try {
      const guild = this.client.guilds.cache.get(config.guildId);
      if (!guild) {
        throw new Error(`Guild ${config.guildId} not found in client cache.`);
      }

      await this.validateTargetChannel(guild);

      if (existing) {
        this.cleanupConnection(existing);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const connection = joinVoiceChannel({
        channelId: config.voiceChannelId,
        guildId: config.guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true
      });

      connection.on('stateChange', (oldState, newState) => {
        logger.info(`Voice connection state changed: ${oldState.status} -> ${newState.status}`);
      });

      connection.on('debug', (message) => {
        logger.info(`[VOICE_DEBUG] ${message}`);
      });

      const initialErrorHandler = (error) => {
        logger.error('Voice connection emitted an error during initialization', error);
      };
      connection.on('error', initialErrorHandler);

      logger.debug('Waiting for connection to enter Connecting state...');
      await entersState(connection, VoiceConnectionStatus.Connecting, 15000);

      logger.debug('Waiting for connection to enter Ready state...');
      await entersState(connection, VoiceConnectionStatus.Ready, 30000);

      connection.off('error', initialErrorHandler);
      this.setupConnectionListeners(connection);
      
      logger.info('Successfully connected and stabilized voice connection.');
      this.backoff.reset();
      this.unhealthyCount = 0;
    } catch (error) {
      if (error.name === 'AbortError') {
        logger.error('Failed to initialize voice connection before timeout. If permissions validated successfully, this usually points to blocked/unstable UDP connectivity to Discord voice servers.', error);
      } else {
        logger.error('Failed to initialize voice connection', error);
      }
      const failedConn = getVoiceConnection(config.guildId);
      if (failedConn) this.cleanupConnection(failedConn);
      this.isConnecting = false;
      this.scheduleRejoin({ reason: 'Initial join failure' });
    } finally {
      this.isConnecting = false;
    }
  }

  setupConnectionListeners(connection) {
    connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
      if (this.isShuttingDown) return;

      logger.warn('Voice connection disconnected', { reason: newState.reason, closeCode: newState.closeCode });

      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
        logger.debug('Connection recovering automatically');
      } catch {
        logger.warn('Connection failed to recover automatically. Scheduling clean manual rejoin');
        this.cleanupConnection(connection);
        this.scheduleRejoin({ reason: 'Disconnected from voice server' });
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (!this.isShuttingDown && !this.isConnecting && !this.isRejoining) {
        logger.debug('Connection destroyed unexpectedly. Scheduling rejoin');
        this.scheduleRejoin({ reason: 'Connection destroyed unexpectedly' });
      }
    });

    connection.on('error', (error) => {
      logger.error('Voice connection encountered an error', error);
      this.cleanupConnection(connection);
      this.scheduleRejoin({ reason: 'Connection error' });
    });
  }

  handleVoiceStateUpdate(oldState, newState) {
    if (newState.member?.user.id !== this.client?.user?.id) return;
    if (this.isConnecting || this.isRejoining || this.isShuttingDown) return;

    if (this.voiceStateDebounce) clearTimeout(this.voiceStateDebounce);
    
    this.voiceStateDebounce = setTimeout(() => {
      const currentVoice = newState.guild.members.me?.voice;
      if (!currentVoice?.channelId || currentVoice.channelId !== config.voiceChannelId) {
        logger.warn('Bot voice state desync confirmed after debounce. Initiating rejoin...');
        this.scheduleRejoin({ reason: 'Voice state desync' });
      }
    }, 3000);
  }

  async scheduleRejoin({ reason = 'Unknown' } = {}) {
    if (this.isShuttingDown || this.isConnecting || this.isRejoining) return;
    
    const now = Date.now();
    if (now - this.lastRejoinTime < 5000) {
      logger.debug('Rejoin debounced due to rapid scheduling');
      return;
    }
    this.lastRejoinTime = now;

    this.isRejoining = true;
    logger.info(`Scheduling voice rejoin. Reason: ${reason}`);

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
    if (this.voiceStateDebounce) {
      clearTimeout(this.voiceStateDebounce);
      this.voiceStateDebounce = null;
    }

    const connection = getVoiceConnection(config.guildId);
    if (connection) {
      this.cleanupConnection(connection);
      logger.info('Voice connection successfully closed during shutdown');
    }
  }
}

export const voiceManager = new VoiceManager();
