const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O/1/I

/** Erzeugt einen 8-stelligen Einladungscode aus einer unauffälligen Alphabet-Auswahl. */
export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** Eingaben normalisieren: Leerzeichen/Bindestriche raus, groß geschrieben. */
export function normalizeInviteCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]/g, '') : '';
}
