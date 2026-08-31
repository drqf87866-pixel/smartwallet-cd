import { env } from 'cloudflare:test';
import schemaSql from '../schema.sql?raw';

// Tests starten mit leerer Test-D1 – einmalig das vollständige Schema anlegen.
// (Die Dateien in migrations/ sind inkrementell für Bestandsdatenbanken.)
//
// D1s exec() zerlegt SQL zeilenweise und kann weder mit Kommentarzeilen noch
// mit mehrzeiligem CREATE TABLE umgehen. Daher: Statements selbst trennen
// (Anführungszeichen-bewusst) und per batch() ausführen.

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let inLineComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (!inString && ch === '-' && sql[i + 1] === '-') {
      inLineComment = true;
      continue;
    }
    if (ch === "'") inString = !inString;
    if (ch === ';' && !inString) {
      const stmt = current.trim();
      if (stmt !== '') statements.push(stmt);
      current = '';
    } else {
      current += ch;
    }
  }
  const tail = current.trim();
  if (tail !== '') statements.push(tail);
  return statements;
}

const statements = splitSqlStatements(schemaSql);
if (statements.length === 0) throw new Error('schema.sql enthält keine Statements');
await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
