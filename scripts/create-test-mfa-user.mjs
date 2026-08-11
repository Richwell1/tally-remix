#!/usr/bin/env node
/**
 * DEV-ONLY: create a confirmed test user, enroll a TOTP factor and verify it,
 * so the full 2FA smoke test (sign in -> /mfa -> aal2 -> /app) can be run.
 *
 * Usage:
 *   node scripts/create-test-mfa-user.mjs --confirm [--email=smoke@example.test] [--password=...]
 *
 * Safety:
 *   - refuses to run when NODE_ENV=production or DEPLOY_ENV/VITE_APP_ENV=production
 *   - refuses to run without the explicit --confirm flag
 *   - requires SUPABASE_SERVICE_ROLE_KEY in the local environment (never bundled)
 *   - prints the TOTP secret so you can add it to an authenticator app
 *
 * Cleanup:
 *   node scripts/create-test-mfa-user.mjs --confirm --delete --email=smoke@example.test
 */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFile } from "./lib/env.mjs";

loadEnvFile(".env");
loadEnvFile(".env.local", { override: true });

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, "").split("=");
    return [k, rest.length ? rest.join("=") : true];
  }),
);

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

const envName = process.env.NODE_ENV || process.env.DEPLOY_ENV || process.env.VITE_APP_ENV || "";
if (/^prod/i.test(envName)) fail(`Refusing to run in a production environment (${envName}).`);
if (!args.get("confirm")) fail("Pass --confirm to acknowledge this creates a real auth user.");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !PUBLISHABLE_KEY) {
  fail(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY in the local environment.",
  );
}

const email = String(args.get("email") || "smoke.test@tally-remix.test");
const password = String(args.get("password") || "SmokeTest!2FA-" + crypto.randomUUID().slice(0, 8));

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ---------------------------- TOTP (RFC 6238) ---------------------------- */
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

function totp(secret, timeStepOffset = 0) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30) + timeStepOffset;
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

/* ------------------------------- helpers -------------------------------- */
async function findUserByEmail(target) {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === target.toLowerCase());
    if (found) return found;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function main() {
  const existing = await findUserByEmail(email);

  if (args.get("delete")) {
    if (!existing) {
      console.log(`Nothing to delete — no user with email ${email}.`);
      return;
    }
    const { error } = await admin.auth.admin.deleteUser(existing.id);
    if (error) throw error;
    console.log(`✔ Deleted test user ${email} (${existing.id}).`);
    return;
  }

  let userId;
  if (existing) {
    userId = existing.id;
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (error) throw error;
    // Drop any previous factors so enrollment is deterministic.
    const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId });
    for (const factor of factors?.factors ?? []) {
      await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
    }
    console.log(`• Reused existing user ${email} (password reset, MFA factors cleared).`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Smoke Test User", is_test_user: true },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`✔ Created user ${email} (${userId}).`);
  }

  // Sign in as the user to enroll + verify a TOTP factor (admin API cannot enroll).
  const user = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await user.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  const enroll = await user.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Smoke Test ${Date.now()}`,
  });
  if (enroll.error) throw enroll.error;
  const secret = enroll.data.totp.secret;
  const factorId = enroll.data.id;

  const challenge = await user.auth.mfa.challenge({ factorId });
  if (challenge.error) throw challenge.error;

  let verified = false;
  let lastError = null;
  for (const offset of [0, -1, 1]) {
    const res = await user.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code: totp(secret, offset),
    });
    if (!res.error) {
      verified = true;
      break;
    }
    lastError = res.error;
  }
  if (!verified) throw lastError ?? new Error("Could not verify TOTP factor");

  const aal = await user.auth.mfa.getAuthenticatorAssuranceLevel();

  // Make sure profile + role rows exist for the CRM UI.
  const bootstrap = await user.rpc("ensure_user_bootstrap");
  if (bootstrap.error) console.warn(`  (bootstrap warning: ${bootstrap.error.message})`);

  console.log(`
✔ Test user ready for the 2FA smoke test

  Email            ${email}
  Password         ${password}
  User ID          ${userId}
  TOTP secret      ${secret}
  otpauth URI      ${enroll.data.totp.uri}
  Factor status    verified (current AAL: ${aal.data?.currentLevel})

  Current code     ${totp(secret)}   (regenerate: node -e "…" or your authenticator app)

Smoke test:
  1. Sign in at /auth with the credentials above → you should land on /mfa.
  2. Try /app before entering a code → still blocked (UI gate + aal2 RLS).
  3. Enter the 6-digit code from the secret → /app loads and CRM reads succeed.

Cleanup:
  node scripts/create-test-mfa-user.mjs --confirm --delete --email=${email}
`);
}

main().catch((err) => fail(err?.message || String(err)));
