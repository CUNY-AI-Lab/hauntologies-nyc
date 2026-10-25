import fs from 'node:fs/promises';
import './prepare-worker-release.mjs';

const file = new URL('../dist/server/wrangler.live.json', import.meta.url);
const config = JSON.parse(await fs.readFile(file, 'utf8'));
config.vars.MAP_ACCOUNTS_ENABLED = 'true';
config.vars.REGISTRATION_ELIGIBILITY_ENABLED = 'true';
config.vars.CONTRIBUTIONS_OPEN_REVIEW = 'true';
config.services = [{ binding: 'ACCOUNT_MAIL', service: 'cail-tools-admission', entrypoint: 'AdmissionHauntologiesAccountMail', props: { app: 'hauntologies-nyc', origin: 'https://hauntologies-nyc.ailab-452.workers.dev' } }];
await fs.writeFile(file, JSON.stringify(config, null, 2) + '\n');
console.log('Prepared production Hauntologies account release with the restricted account-mail binding.');
