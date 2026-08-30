export type Env = {
  Bindings: {
    /** D1-Bindung aus wrangler.toml */
    DB: D1Database;
    /** Secret – Gemini API Key (https://aistudio.google.com/apikey) */
    GEMINI_API_KEY: string;
    /** Secret – HS256-Signaturschlüssel für die JWTs */
    JWT_SECRET: string;
    /** Optional überschreibbar, Default: gemini-3.5-flash-lite */
    GEMINI_MODEL?: string;
    /** Optional, nur für lokale Tests gegen einen Mock-Server */
    GEMINI_API_BASE?: string;
    /** Nur lokal in .dev.vars setzen – aktiviert den Demo-Seed-Endpunkt */
    ENABLE_DEV_SEED?: string;
  };
  Variables: {
    userId: number;
    userName: string;
    userEmail: string;
    householdId: number;
    isAdmin: boolean;
  };
};

export type TransactionType = 'income' | 'expense' | 'transfer' | 'settlement';
export type TransactionScope = 'personal' | 'shared';
/** Konto, über das abgewickelt wurde (bei income: Konto, auf dem es eingegangen ist) */
export type TransactionAccount = 'private' | 'joint';
