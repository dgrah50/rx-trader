import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './packages/market-structure/src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.SQLITE_PATH ?? 'rxtrader.sqlite'
  }
});
