/**
 * Erzeugt Test-SQL für einen Haushalt mit zwei Nutzern, ein paar Buchungen
 * über alle Kategorien sowie eine wiederkehrende Regel. Nur für lokale Dev-DB
 * gedacht (Passwörter sind bewusst simpel).
 *
 *   node scripts/seed-testdata.mjs > scripts/.seed.local.sql
 *   npx wrangler d1 execute smartwallet-cd-db --local --file=./scripts/.seed.local.sql
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

const esc = (value) => value.replace(/'/g, "''");
const inviteCode = generateInviteCode();
const hashAnna = await hashPassword('test1234');
const hashBen = await hashPassword('test1234');

const today = new Date();
const iso = (daysAgo) => {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
};

let sql = '';
sql += `INSERT INTO households (name, invite_code) VALUES ('Testhaushalt', '${inviteCode}');\n`;
sql += `INSERT INTO users (household_id, name, email, password_hash, is_admin, monthly_contribution) VALUES\n`;
sql += `  ((SELECT id FROM households WHERE invite_code = '${inviteCode}'), 'Anna Test', 'anna@test.local', '${hashAnna}', 1, 800),\n`;
sql += `  ((SELECT id FROM households WHERE invite_code = '${inviteCode}'), 'Ben Test', 'ben@test.local', '${hashBen}', 0, 700);\n`;

const tx = (userEmail, amount, type, category, description, daysAgo, scope, paidFrom) =>
  `INSERT INTO transactions (user_id, amount, type, category, description, date, scope, paid_from) VALUES ` +
  `((SELECT id FROM users WHERE email = '${userEmail}'), ${amount}, '${type}', '${esc(category)}', '${esc(description)}', '${iso(daysAgo)}', '${scope}', '${paidFrom}');\n`;

sql += tx('anna@test.local', 2600, 'income', 'Einnahme', 'Gehalt August', 20, 'personal', 'private');
sql += tx('ben@test.local', 2200, 'income', 'Einnahme', 'Gehalt August', 20, 'personal', 'private');
sql += tx('anna@test.local', 800, 'transfer', 'Überweisung', 'Monatsbeitrag', 19, 'shared', 'private');
sql += tx('ben@test.local', 700, 'transfer', 'Überweisung', 'Monatsbeitrag', 19, 'shared', 'private');
sql += tx('anna@test.local', 950, 'expense', 'Wohnen', 'Miete', 18, 'shared', 'joint');
sql += tx('ben@test.local', 42.5, 'expense', 'Essen & Trinken', 'Wocheneinkauf', 15, 'shared', 'joint');
sql += tx('anna@test.local', 19.9, 'expense', 'Mobilität', 'Tankfüllung', 12, 'personal', 'private');
sql += tx('ben@test.local', 35.0, 'expense', 'Gesundheit & Körper', 'Apotheke', 8, 'personal', 'private');
sql += tx('anna@test.local', 24.9, 'expense', 'Freizeit & Sonstiges', 'Kino', 5, 'personal', 'private');
sql += tx('ben@test.local', 60.0, 'expense', 'Freizeit & Sonstiges', 'Geschenk', 2, 'shared', 'joint');

sql += `INSERT INTO recurring_rules (household_id, user_id, amount, type, category, description, scope, paid_from, frequency, day, start_date, active) VALUES (` +
  `(SELECT id FROM households WHERE invite_code = '${inviteCode}'), ` +
  `(SELECT id FROM users WHERE email = 'anna@test.local'), 15.0, 'expense', 'Freizeit & Sonstiges', 'Streaming-Abo', 'personal', 'private', 'monthly', 1, '${iso(30)}', 1);\n`;

console.log(sql);
console.error(`Einladungscode: ${inviteCode}`);
console.error(`Login: anna@test.local / test1234 (Admin)`);
console.error(`Login: ben@test.local / test1234`);
