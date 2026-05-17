import { sleep } from './utils.js';
import { logger } from './logger.js';

export class BackoffManager {
  constructor(options = {}) {
    this.minDelay = options.minDelay ?? 1000;
    this.maxDelay = options.maxDelay ?? 60000;
    this.factor = options.factor ?? 2;
    this.attempts = 0;
  }

  reset() {
    if (this.attempts > 0) {
      logger.debug('Resetting backoff counter');
    }
    this.attempts = 0;
  }

  async wait() {
    this.attempts++;
    const delay = Math.min(this.maxDelay, this.minDelay * Math.pow(this.factor, this.attempts - 1));
    const jitter = Math.random() * 500;
    const totalDelay = Math.round(delay + jitter);

    logger.debug(`Waiting ${totalDelay}ms before retry attempt ${this.attempts}`);
    await sleep(totalDelay);
  }
}
