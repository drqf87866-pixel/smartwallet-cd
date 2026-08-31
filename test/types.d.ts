/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Minimale Laufzeit-Typen für cloudflare:test env – gespiegelt aus
// vitest.wrangler.toml (dort stehen die eigentlichen Test-Bindings).
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
  }
}

declare module '*.sql?raw' {
  const content: string;
  export default content;
}
