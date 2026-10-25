import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  // Fallback lets `prisma generate` run on a fresh clone before .env exists.
  datasource: { url: process.env.DATABASE_URL ?? "file:./dev.db" },
});
