const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');

const rl = readline.createInterface({ input: stdin, output: stdout });

async function main() {
  const apiId = Number(await rl.question('Telegram API ID: '));
  const apiHash = (await rl.question('Telegram API hash: ')).trim();
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
    throw new Error('Enter the API ID and API hash from my.telegram.org/apps.');
  }

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.start({
      phoneNumber: () => rl.question('Telegram phone number (with country code): '),
      phoneCode: () => rl.question('Login code from Telegram: '),
      password: () => rl.question('Two-step verification password (if enabled): '),
      onError: error => console.error(`Telegram login error: ${error.message}`),
    });

    const channelName = (await rl.question('Private channel name (exactly): ')).trim();
    const dialogs = await client.getDialogs({ limit: 200 });
    const matches = dialogs.filter(dialog =>
      dialog.title?.trim() === channelName && dialog.entity?.className === 'Channel',
    );
    if (matches.length !== 1) {
      throw new Error(`Expected one channel named "${channelName}" in your account; found ${matches.length}.`);
    }

    const channelId = await client.getPeerId(matches[0].entity);
    const outputPath = path.join(__dirname, '..', '.telegram-setup.local.json');
    fs.writeFileSync(outputPath, JSON.stringify({
      session: client.session.save(),
      channelId,
    }, null, 2), { mode: 0o600 });
    console.log(`Setup details saved locally to ${outputPath}`);
    console.log(`Channel ID: ${channelId}`);
    console.log('Keep this file private. Do not commit it or send it in chat.');
  } finally {
    await client.disconnect().catch(() => {});
  }
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
