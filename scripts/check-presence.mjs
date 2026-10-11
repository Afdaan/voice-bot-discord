import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { Client, ClientPresence, GatewayIntentBits } from 'discord.js';

let client;
let processUptimeSeconds = 100;
let voiceJoins = 0;
let voiceInitializations = 0;
const timers = [];
const logs = [];
const originalParse = ClientPresence.prototype._parse;
const context = createContext({
  process: { pid: 1234, uptime: () => processUptimeSeconds, on() {} },
  setTimeout: (callback) => timers.push(callback)
});
const dependencies = {
  'node:dns': { default: { setDefaultResultOrder() {} } },
  'discord.js': {
    Client: class extends Client {
      login() {
        client = this;
        return Promise.resolve();
      }
    },
    ClientPresence,
    GatewayIntentBits
  },
  './config.js': { config: { activityName: 'Test activity', activityType: 0, guildId: '123' } },
  './logger.js': { logger: Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (...args) => logs.push(args)])) },
  './voice-manager.js': { voiceManager: {
    init: () => voiceInitializations++,
    join: () => voiceJoins++
  } }
};
const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
const entrypoint = new SourceTextModule(source, { context });
await entrypoint.link(specifier => {
  const exports = dependencies[specifier];
  assert.ok(exports, `Unexpected dependency: ${specifier}`);
  return new SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { context });
});
await entrypoint.evaluate();

assert.equal(ClientPresence.prototype._parse, originalParse);
const initialPresence = JSON.stringify(client.options.presence);
assert.equal(client.options.presence.activities[0].name, 'Test activity');
assert.equal(client.options.presence.activities[0].type, 0);
assert.equal(client.options.presence.status, 'online');
assert.equal('timestamps' in client.options.presence.activities[0], false);
const packet = client.presence._parse(client.options.presence);
assert.equal(packet.activities[0].name, 'Test activity');
assert.equal(packet.activities[0].type, 0);
assert.equal('timestamps' in packet.activities[0], false);
client.user = { tag: 'offline', setPresence() { assert.fail('Redundant presence update'); } };
client.emit('shardReady', 0);
client.emit('clientReady');
assert.equal(timers.length, 1);
timers[0]();
client.emit('shardDisconnect', { code: 1006, reason: 'offline test' }, 0);
client.emit('shardReconnecting', 0);
processUptimeSeconds = 200;
client.emit('shardResume', 0, 2);
client.emit('shardResume', 0, 0);
client.emit('shardReady', 0);
assert.equal(JSON.stringify(client.options.presence), initialPresence);
assert.equal(voiceInitializations, 1);
assert.equal(voiceJoins, 3);
assert.equal(logs.at(-1)[1].processUptimeSeconds, 200);
console.log('PASS: static presence, repeated resume, new session, voice recovery, process uptime logs');
