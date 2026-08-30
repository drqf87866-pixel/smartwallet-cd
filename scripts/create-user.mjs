/**
 * Legt einen SmartWallet-Nutzer an (oder setzt Name/Passwort zurück) und
 * gibt fertiges SQL auf stdout aus – zur Einspielung mit:
 *
 *   # Neuen Haushalt + Nutzer anlegen (gibt den Einladungscode auf stderr aus):
 *   node scripts/create-user.mjs "Anna" "anna@example.de" "sicheres-passwort" --household-name "Familie Muster" > user.sql
 *
 *   # Nutzer in bestehenden Haushalt aufnehmen:
 *   node scripts/create-user.mjs "Ben" "ben@example.de" "sicheres-passwort" --join K7M4QX2T > user.sql
 *
 *   npx wrangler d1 execute smartwallet-cd-db --remote --file=./user.sql
 *
 * Für reine Passwort-Resets: gleiche E-Mail nochmal mit neuem Passwort ausführen
 * (bestehende Haushalts-Zuordnung bleibt unverändert).
 *
 * Der Hash entspricht 1:1 der Worker-Logik in src/lib/password.ts
 * (PBKDF2, SHA-256, 100.000 Iterationen, 16-Byte-Salt).
 */
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    keyMaterial,
    KEY_BITS,
  );
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--household-name') flags.householdName = args[++i];
  else if (args[i] === '--join') flags.join = args[++i];
  else positional.push(args[i]);
}

const [name, email, password] = positional;
if (!name || !email || !password || (!flags.householdName && !flags.join)) {
  console.error(
    'Usage:\n' +
      '  node scripts/create-user.mjs "<Name>" "<email>" "<passwort>" --household-name "<Haushalt>"\n' +
      '  node scripts/create-user.mjs "<Name>" "<email>" "<passwort>" --join <EINLADUNGSCODE>',
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error('Passwort sollte mindestens 8 Zeichen haben.');
  process.exit(1);
}

const emailNorm = email.trim().toLowerCase();
const esc = (value) => value.replace(/'/g, "''");
const hash = await hashPassword(password);

let sql = '';
if (flags.householdName) {
  const code = generateInviteCode();
  console.error(`Einladungscode des neuen Haushalts: ${code}`);
  sql += `INSERT INTO households (name, invite_code) VALUES ('${esc(flags.householdName)}', '${code}');\n`;
}
if (flags.join) {
  const code = flags.join.trim().toUpperCase().replace(/[\s-]/g, '');
  sql += `INSERT INTO users (household_id, name, email, password_hash, is_admin) VALUES ((SELECT id FROM households WHERE invite_code = '${code}'), '${esc(name.trim())}', '${esc(emailNorm)}', '${hash}', 0) ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash;\n`;
} else {
  const code = /invite_code = '([A-Z0-9]+)'/.exec(sql)?.[1];
  sql += `INSERT INTO users (household_id, name, email, password_hash, is_admin) VALUES ((SELECT id FROM households WHERE invite_code = '${code}'), '${esc(name.trim())}', '${esc(emailNorm)}', '${hash}', 1) ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash;\n`;
}

console.log(sql);
