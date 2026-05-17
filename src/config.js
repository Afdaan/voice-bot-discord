import dotenv from 'dotenv';

dotenv.config();

function validateConfig() {
  const { DISCORD_TOKEN, GUILD_ID, VOICE_CHANNEL_ID, LOG_LEVEL } = process.env;

  const missing = [];
  if (!DISCORD_TOKEN) missing.push('DISCORD_TOKEN');
  if (!GUILD_ID) missing.push('GUILD_ID');
  if (!VOICE_CHANNEL_ID) missing.push('VOICE_CHANNEL_ID');

  if (missing.length > 0) {
    console.error(`[FATAL ERROR] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  return {
    token: DISCORD_TOKEN.trim(),
    guildId: GUILD_ID.trim(),
    voiceChannelId: VOICE_CHANNEL_ID.trim(),
    logLevel: (LOG_LEVEL || 'info').toLowerCase()
  };
}

export const config = validateConfig();
