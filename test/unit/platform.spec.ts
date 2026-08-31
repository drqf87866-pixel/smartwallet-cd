import { describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, isAllowedCategory, isCanonicalCategory } from '../../src/lib/categories';
import { generateInviteCode, normalizeInviteCode } from '../../src/lib/invite';
import { hashPassword, verifyPassword } from '../../src/lib/password';

describe('categories', () => {
  it('Ausgaben-Kategorien gelten nur für Ausgaben', () => {
    expect(isAllowedCategory('Lebensmittel', 'expense')).toBe(true);
    expect(isAllowedCategory('Lebensmittel', 'income')).toBe(false);
    expect(isAllowedCategory('Gehalt', 'income')).toBe(true);
    expect(isAllowedCategory('Gehalt', 'expense')).toBe(false);
  });

  it('Überweisungen erfordern die Kategorie "Überweisung"', () => {
    expect(isAllowedCategory('Überweisung', 'transfer')).toBe(true);
    expect(isAllowedCategory('Miete', 'transfer')).toBe(false);
  });

  it('isCanonicalCategory akzeptiert jede kanonische Kategorie', () => {
    expect(isCanonicalCategory('Tanken')).toBe(true);
    expect(isCanonicalCategory('Erstattung')).toBe(true);
    expect(isCanonicalCategory('Egal')).toBe(false);
  });

  it('Kategorien-Listen überschneiden sich nur bei "Sonstiges"', () => {
    const overlap = EXPENSE_CATEGORIES.filter((c) => (INCOME_CATEGORIES as readonly string[]).includes(c));
    expect(overlap).toEqual(['Sonstiges']);
  });
});

describe('invite', () => {
  it('erzeugt 8-stellige Codes aus dem starken Alphabet', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateInviteCode();
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });

  it('normalisiert Eingaben (Leerzeichen/Bindestriche raus, groß)', () => {
    expect(normalizeInviteCode(' ab-cd ef ')).toBe('ABCDEF');
    expect(normalizeInviteCode(42)).toBe('');
  });
});

describe('password', () => {
  it('Hash/Verify-Roundtrip mit korrektem Passwort', async () => {
    const hash = await hashPassword('Sicheres-Passwort-1');
    expect(hash).toMatch(/^pbkdf2\$\d+\$/);
    expect(await verifyPassword('Sicheres-Passwort-1', hash)).toBe(true);
  });

  it('falsches Passwort und kaputtes Format werden abgelehnt', async () => {
    const hash = await hashPassword('Sicheres-Passwort-1');
    expect(await verifyPassword('falsch', hash)).toBe(false);
    expect(await verifyPassword('Sicheres-Passwort-1', 'pbkdf2$100000$x$y')).toBe(false);
    expect(await verifyPassword('Sicheres-Passwort-1', 'unsinn')).toBe(false);
  });

  it('zwei Hashes desselben Passworts nutzen unterschiedliche Salts', async () => {
    const a = await hashPassword('gleiches-passwort');
    const b = await hashPassword('gleiches-passwort');
    expect(a).not.toBe(b);
    expect(await verifyPassword('gleiches-passwort', b)).toBe(true);
  });
});
