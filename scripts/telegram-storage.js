const fs = require('node:fs');
const path = require('node:path');
const { TelegramClient, Api } = require('teleproto');
const { StringSession } = require('teleproto/sessions');

let clientPromise;

function readConfig() {
  const setupPath = path.join(__dirname, '..', '.telegram-setup.local.json');
  let local = {};
  try { local = JSON.parse(fs.readFileSync(setupPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return {
    apiId: Number(process.env.TELEGRAM_API_ID || local.apiId),
    apiHash: process.env.TELEGRAM_API_HASH || local.apiHash,
    session: process.env.TELEGRAM_SESSION || local.session,
    channelId: process.env.TELEGRAM_CHANNEL_ID || local.channelId,
    channelRawId: process.env.TELEGRAM_CHANNEL_RAW_ID || local.channelRawId,
    channelAccessHash: process.env.TELEGRAM_CHANNEL_ACCESS_HASH || local.channelAccessHash,
  };
}

async function getTelegram() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const config = readConfig();
      if (!Number.isInteger(config.apiId) || config.apiId <= 0 || !config.apiHash || !config.session || !config.channelRawId || !config.channelAccessHash) {
        throw new Error('Telegram storage is not configured. Run npm run telegram:setup and keep its setup file private.');
      }
      const client = new TelegramClient(new StringSession(config.session), config.apiId, config.apiHash, { connectionRetries: 3 });
      await client.connect();
      try {
        await client.getMe();
        const channel = new Api.InputPeerChannel({
          channelId: BigInt(config.channelRawId),
          accessHash: BigInt(config.channelAccessHash),
        });
        return { client, channel };
      } catch (error) {
        await client.disconnect().catch(() => {});
        throw new Error(`Telegram could not authenticate or open the configured channel: ${error.message}`);
      }
    })().catch(error => { clientPromise = undefined; throw error; });
  }
  return clientPromise;
}

module.exports = { getTelegram };
