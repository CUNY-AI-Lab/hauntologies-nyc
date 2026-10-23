-- Generated from Better Auth 1.7.12; reviewed additive account tables.
create table "hny_auth_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "hny_auth_session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "hny_auth_user" ("id") on delete cascade);

create table "hny_auth_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "hny_auth_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "hny_auth_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create index "hny_auth_session_userId_idx" on "hny_auth_session" ("userId");

create index "hny_auth_account_userId_idx" on "hny_auth_account" ("userId");

create index "hny_auth_verification_identifier_idx" on "hny_auth_verification" ("identifier");
-- Credential creation stays single-writer across simultaneous verification requests.
CREATE UNIQUE INDEX hny_auth_account_user_provider_unique ON hny_auth_account (userId, providerId);
CREATE TABLE hny_auth_limits (bucket TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (bucket, window));
CREATE INDEX hny_auth_limits_expiry ON hny_auth_limits (expires_at);
