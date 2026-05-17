# Discord AFK Voice Bot

A highly stable, single-purpose Discord daemon process designed to stay continuously connected to a specific voice channel 24/7. Built with minimal architecture, strict error recovery, and robust connection persistence.

---

## Features

- **Continuous Voice Presence**: Automatically connects and maintains active presence in a specified voice channel.
- **Self-Muted & Self-Deafened**: Operates silently with minimal bandwidth and processing overhead.
- **Robust Auto-Recovery**: Handles websocket disconnects, Discord gateway reconnects, and stale voice sessions.
- **Exponential Backoff**: Prevents spamming Discord APIs during network interruptions or outages.
- **Single-Flight Reconnection**: Protects against concurrent rejoin loops.
- **Graceful Shutdown**: Properly destroys connections and leaves voice channels cleanly on container stop.

---

## Requirements

- Node.js 22 LTS (or Docker / Docker Compose)
- A Discord Bot Token

---

## Discord Developer Portal Setup

1. **Create Application**: Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. **Create Bot**: Navigate to the **Bot** tab on the left menu and click **Reset Token** to obtain your `DISCORD_TOKEN`. Keep this secret.
3. **Bot Permissions**: No special privileged gateway intents (like Message Content) are required.
4. **Invite Bot**:
   - Go to the **OAuth2** -> **URL Generator** tab.
   - Under **Scopes**, check `bot`.
   - Under **Bot Permissions**, check:
     - `View Channels`
     - `Connect`
     - `Speak`
     - `Use Voice Activity`
   - Copy the generated URL at the bottom and paste it into your browser to invite the bot to your Discord server.

---

## Finding IDs

To configure the bot, you will need your Discord Server (Guild) ID and Target Voice Channel ID.

1. In Discord, open **User Settings** -> **Advanced** -> Enable **Developer Mode**.
2. **Guild ID**: Right-click your server's icon in the left server list and click **Copy Server ID**.
3. **Voice Channel ID**: Right-click the target voice channel and click **Copy Channel ID**.

---

## Environment Configuration

Copy the example configuration file:

```bash
cp .env.example .env
```

Edit `.env` with your precise configuration:

```ini
DISCORD_TOKEN=your_bot_token_here
GUILD_ID=your_guild_id_here
VOICE_CHANNEL_ID=your_voice_channel_id_here
LOG_LEVEL=info # debug, info, warn, error
```

---

## Deployment (Docker Compose)

Deploying with Docker Compose is highly recommended for automatic background restarts and isolated execution.

### Build and Start

```bash
docker compose up -d --build
```

### View Logs

```bash
docker compose logs -f
```

### Stop Daemon

```bash
docker compose down
```

---

## Manual Deployment (Bare Metal / VPS)

If running without Docker on a VPS running Linux:

```bash
# Install dependencies
npm ci

# Run in production
NODE_ENV=production npm start
```

For long-term daemon management on bare metal, use `systemd` or `pm2`.

---

## Troubleshooting

- **Bot connects but disconnects immediately**: Verify that the bot has both `Connect` and `View Channels` permissions in the specific voice channel permissions settings.
- **Missing required environment variables**: Ensure your `.env` file is named exactly `.env` and resides in the root directory. Check for trailing whitespaces.
- **Stuck in reconnect loop**: Check `docker compose logs` to see if Discord is actively rejecting connection tokens or if rate limits have been triggered. The exponential backoff will automatically space out retry attempts up to 60 seconds.

---

## License

MIT
