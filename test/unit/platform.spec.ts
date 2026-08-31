import { describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES, INCOME_CATEGORY, isAllowedCategory, isCanonicalCategory } from '../../src/lib/categories';
import { generateInviteCode, normalizeInviteCode } from '../../src/lib/invite';
import { hashPassword, verifyPassword } from '../../src/lib/password';

describe('categories', () => {
  it('Ausgaben-Kategorien gelten nur für Ausgaben', () => {
    expect(isAllowedCategory('Essen & Trinken', 'expense')).toBe(true);
    expect(isAllowedCategory('Essen & Trinken', 'income')).toBe(false);
    expect(isAllowedCategory(INCOME_CATEGORY, 'income')).toBe(true);
    expect(isAllowedCategory(INCOME_CATEGORY, 'expense')).toBe(false);
  });

  it('Überweisungen erfordern die Kategorie "Überweisung"', () => {
    expect(isAllowedCategory('Überweisung', 'transfer')).toBe(true);
    expect(isAllowedCategory('Wohnen', 'transfer')).toBe(false);
  });

  it('isCanonicalCategory akzeptiert jede kanonische Kategorie', () => {
    expect(isCanonicalCategory('Mobilität')).toBe(true);
    expect(isCanonicalCategory(INCOME_CATEGORY)).toBe(true);
    expect(isCanonicalCategory('Egal')).toBe(false);
  });

  it('Ausgaben-Liste hat genau 5 Kategorien', () => {
    expect(EXPENSE_CATEGORIES).toHaveLength(5);
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
