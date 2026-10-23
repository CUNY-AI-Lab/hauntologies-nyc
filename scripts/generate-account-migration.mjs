import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { writeFile } from 'node:fs/promises';
import { accountOptions } from '../deployment/map-accounts.mjs';

const db = new DatabaseSync(':memory:');
const options = accountOptions({ DB: db, MAP_AUTH_SECRET: 'schema-generation-only-not-a-production-secret', ACCOUNT_MAIL: { send() { throw new Error('schema_only'); } } });
const migration = await getMigrations(options);
const sql = await migration.compileMigrations();
if (migration.toBeAdded.length || migration.unsafeChanges.length || migration.toBeCreated.some(table => !table.table.startsWith('hny_auth_'))) throw new Error('unexpected_auth_migration');
await writeFile(new URL('../drizzle/0006_map_accounts.sql', import.meta.url), '-- Generated from Better Auth 1.7.12; reviewed additive account tables.\n' + sql + '\n-- Credential creation stays single-writer across simultaneous verification requests.\nCREATE UNIQUE INDEX hny_auth_account_user_provider_unique ON hny_auth_account (userId, providerId);\nCREATE TABLE hny_auth_limits (bucket TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (bucket, window));\nCREATE INDEX hny_auth_limits_expiry ON hny_auth_limits (expires_at);\n');
db.close();
