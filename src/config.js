import dotenv from 'dotenv';
import { ActivityType } from 'discord.js';

dotenv.config();

function validateConfig() {
  const { DISCORD_TOKEN, GUILD_ID, VOICE_CHANNEL_ID, LOG_LEVEL, BOT_ACTIVITY, BOT_ACTIVITY_TYPE } = process.env;

  const missing = [];
  if (!DISCORD_TOKEN) missing.push('DISCORD_TOKEN');
  if (!GUILD_ID) missing.push('GUILD_ID');
  if (!VOICE_CHANNEL_ID) missing.push('VOICE_CHANNEL_ID');

  if (missing.length > 0) {
    console.error(`[FATAL ERROR] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  const activityTypeInput = (BOT_ACTIVITY_TYPE || 'playing').toLowerCase();
  let activityType = ActivityType.Playing;
  if (activityTypeInput === 'listening') activityType = ActivityType.Listening;
  else if (activityTypeInput === 'watching') activityType = ActivityType.Watching;
  else if (activityTypeInput === 'streaming') activityType = ActivityType.Streaming;
  else if (activityTypeInput === 'competing') activityType = ActivityType.Competing;
  else if (activityTypeInput === 'custom') activityType = ActivityType.Custom;

  return {
    token: DISCORD_TOKEN.trim(),
    guildId: GUILD_ID.trim(),
    voiceChannelId: VOICE_CHANNEL_ID.trim(),
    logLevel: (LOG_LEVEL || 'info').toLowerCase(),
    activityName: BOT_ACTIVITY || 'with Dnz 💖',
    activityType
  };
}

export const config = validateConfig();
