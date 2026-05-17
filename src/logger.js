const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const currentLevel = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function formatLog(level, message, meta) {
  const timestamp = new Date().toISOString();
  let log = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    if (meta instanceof Error) {
      log += `\n${meta.stack || meta.message}`;
    } else {
      log += ` ${JSON.stringify(meta)}`;
    }
  }
  return log;
}

export const logger = {
  debug(message, meta = {}) {
    if (currentLevel <= LEVELS.debug) {
      console.debug(formatLog('debug', message, meta));
    }
  },
  info(message, meta = {}) {
    if (currentLevel <= LEVELS.info) {
      console.log(formatLog('info', message, meta));
    }
  },
  warn(message, meta = {}) {
    if (currentLevel <= LEVELS.warn) {
      console.warn(formatLog('warn', message, meta));
    }
  },
  error(message, meta = {}) {
    if (currentLevel <= LEVELS.error) {
      console.error(formatLog('error', message, meta));
    }
  }
};
