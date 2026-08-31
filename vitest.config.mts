import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Test-Variante der wrangler.toml: nur D1, keine Assets/Rate-Limits
      wrangler: { configPath: './vitest.wrangler.toml' },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
});
