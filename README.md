# Tamgora

A full-stack platform connecting non-technical tech professionals (designers, writers, marketers, PMs) with bounties, clients, and collaborators — powered by Stellar/Soroban smart contracts.

## Live Contracts — Stellar Testnet

| Contract | Address |
|---|---|
| Escrow | `CDDVR4DXPPYYH43OVBVUVK2V7A4NPNN6DAJJ7QFPRB53LMK3XK4U4D76` |
| Vault | `CA23KXIQGCGMBITUT7IZCTQWMMO3A2PDIZXCL4FS7KZHS6FEMGUY4Y6U` |
| AMM | `CD2733NB3EKZQFS7BDFWVS4W7QOQ4IX5EVY5PTPCHLPMRBW7UBSPWFHD` |
| Analytics | `CAZNWED5SCKMPIOSU274DCHLFRGGFZLQNMCWXWNAO3HF5RY2PMPIODWA` |

View on [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet).

Network passphrase: `Test SDF Network ; September 2015`

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui |
| Auth | NextAuth.js |
| Database | PostgreSQL via Prisma ORM (Supabase recommended) |
| Smart Contracts | Rust + Soroban SDK 21.7.7 |
| Rust API | Actix-web |
| Mobile | React Native (Expo) |
| Payments | Stripe |
| Storage | AWS S3 |
| Monitoring | Sentry, OpenTelemetry |

## Project Structure

```
├── app/              # Next.js 15 App Router pages & API routes
├── components/       # React UI components
├── lib/              # Utilities, clients, services
├── prisma/           # Database schema & migrations
├── contracts/
│   ├── escrow/       # Payment escrow with milestone releases
│   ├── vault/        # Multi-vault batch withdrawal
│   ├── amm/          # Constant-product AMM (x*y=k)
│   ├── analytics/    # On-chain event analytics
│   └── core/         # Dispute arbitration, storage TTL, simulation
├── backend/          # Rust API services
│   └── contracts/    # Canonical Soroban contracts (see note below)
├── mobile/           # React Native app (Expo)
└── .husky/           # Git hooks (TS check, secret scan, size limit)
```

> **Note on the two `contracts/` directories:** this repo has Soroban contract
> code in both the top-level `contracts/` and `backend/contracts/`, including
> overlapping names (`core`, `escrow`). **`backend/contracts/` is canonical.**
> It's the workspace declared in `backend/Cargo.toml`, it's what CI actually
> builds and tests (`cd backend && cargo test --all-features`), and its
> implementations are substantially more complete — e.g. `backend/contracts/escrow`
> is ~1,800 lines vs. ~430 in the top-level equivalent, and `backend/contracts/core`
> is a full contract vs. a 5-line stub at the top level. The top-level `contracts/`
> tree is not referenced by any workspace member list or CI job; treat it as
> legacy/scaffold code pending removal or migration, not as a second deployment
> target.
>
> Additionally, three top-level contracts have **no equivalent in `backend/contracts/` at all**:
> `contracts/amm` (constant-product AMM), `contracts/vault` (multi-vault batch withdrawal),
> and `contracts/analytics` (on-chain event analytics). These exist only at the top level
> and are likewise not built or tested by CI.

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Rust + `wasm32v1-none` target (`rustup target add wasm32v1-none`)
- Stellar CLI 27+ (`cargo install --locked stellar-cli`)
- PostgreSQL (or a Supabase project)

### Frontend

```bash
pnpm install
cp .env.example .env.local   # fill in required values
pnpm dev                      # http://localhost:3000
pnpm build                    # production build
```

### Environment Setup

The app supports three environments: **development** (local), **staging** (testnet), and **production** (mainnet). Key differences:

| Variable | Development | Staging | Production |
|---|---|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` | `testnet` | `mainnet` |
| `NEXTAUTH_URL` | `http://localhost:3000` | `https://staging.example.com` | `https://tamgora.com` |
| `DATABASE_URL` | `localhost:6432/stellar_portfolio` | Supabase staging | Supabase production |
| `STRIPE_SECRET_KEY` | `sk_test_...` | `sk_test_...` | `sk_live_...` |
| `SENTRY_ENVIRONMENT` | `development` | `staging` | `production` |
| `KMS_PROVIDER` | `env` | `env` or `aws` | `aws` |
| `NEXT_PUBLIC_STELLAR_NETWORK` contract | Testnet contract ID | Testnet contract ID | Mainnet contract ID |

#### Development Setup (Local)

```bash
# Copy the example and update for local development
cp .env.example .env.local

# Essential edits to .env.local:
# - NEXTAUTH_URL=http://localhost:3000
# - DATABASE_URL points to your local PostgreSQL (port 6432 with PgBouncer)
# - DIRECT_DATABASE_URL points to localhost:5432
# - NEXT_PUBLIC_STELLAR_NETWORK=testnet
# - Stripe/Google keys: leave as-is or populate with test credentials
# - All NEXT_PUBLIC_* vars are baked into the build, so rebuild after changes

pnpm install
pnpm dev  # http://localhost:3000
```

#### Staging Setup (Testnet Supabase)

```bash
# Create a staging-specific env file
cp .env.example .env.staging.local

# Update these values:
# NEXTAUTH_URL=https://staging.example.com
# NEXT_PUBLIC_SUPABASE_URL=<staging-project-url>
# NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging-anon-key>
# SUPABASE_SERVICE_ROLE_KEY=<staging-service-role-key>
# DATABASE_URL=<Supabase connection string with PgBouncer, port 6432>
# DIRECT_DATABASE_URL=<Supabase direct URL, port 5432>
# NEXT_PUBLIC_STELLAR_NETWORK=testnet
# CONTRACT_ID=<deployed testnet contract address>
# Stripe keys: sk_test_... / pk_test_...
# Google OAuth: populate with staging credentials
# KMS_PROVIDER=env (or aws with staging Secrets Manager prefix)
# SENTRY_ENVIRONMENT=staging

pnpm build
# Verify the build includes testnet RPC URLs:
grep -r "soroban-testnet" .next/standalone || echo "❌ Testnet RPC not baked in"
```

#### Production Setup (Mainnet Supabase)

```bash
# Production uses only environment variables set in your deployment platform
# (Vercel, Railway, etc.) — never create a local .env file with production secrets

# Equivalent production values (set via your deployment platform):
# NEXTAUTH_URL=https://tamgora.com (or your domain)
# NEXT_PUBLIC_SUPABASE_URL=<prod-project-url>
# NEXT_PUBLIC_SUPABASE_ANON_KEY=<prod-anon-key>
# SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key>
# DATABASE_URL=<Supabase production URL with PgBouncer>
# DIRECT_DATABASE_URL=<Supabase production direct URL>
# NEXT_PUBLIC_STELLAR_NETWORK=mainnet  # ← CRITICAL: switches RPC to mainnet
# CONTRACT_ID=<deployed mainnet contract address>
# Stripe keys: sk_live_... / pk_live_... ← LIVE keys, not test
# Google OAuth: production credentials
# KMS_PROVIDER=aws  # Fetch secrets from AWS Secrets Manager
# SENTRY_ENVIRONMENT=production

# Verify the build will use mainnet (check after Vercel/your platform builds):
# - Logs should show NEXT_PUBLIC_STELLAR_NETWORK=mainnet
# - Contract addresses should reference mainnet (start with C for Soroban mainnet)
```

**Critical**: All `NEXT_PUBLIC_*` variables are baked into the build at compile time. Changing these requires a fresh build. When deploying to a new environment, ensure your platform rebuilds the app after setting env vars.

See `.env.example` for the complete list of all variables.

### Database setup

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

### Smart Contracts

Build and deploy contracts to testnet:

```bash
cd contracts/escrow
stellar contract build           # produces wasm32v1-none WASM
stellar contract deploy \
  --wasm target/wasm32v1-none/release/escrow.wasm \
  --source <your-key-name> \
  --network testnet
```

Set the returned contract ID as `CONTRACT_ID` in your `.env.local`.

## Key Features

- **Creator Portfolios** — customizable profiles with projects, testimonials, and social links
- **Bounty Marketplace** — post and apply for short-term projects with on-chain escrow payments
- **Freelancer Directory** — search across 15+ non-technical tech disciplines
- **On-chain Escrow** — milestone-based fund releases via Soroban contracts
- **AMM** — constant-product swap pool for platform tokens
- **Mobile App** — React Native (Expo) companion with infinite scroll, haptics, and offline support
- **Dark/Light Mode** — system-aware theme with manual override

## Supported Disciplines

UI/UX Design · Brand Strategy · Writing · Content Creation · Marketing · Community Management · Product Management · Project Management · Business Development · Data Analysis · Sales · Customer Success · HR & Recruiting · Legal & Compliance

## Deployment

The app uses `output: 'standalone'` (Next.js) and can be deployed to:

- **Vercel** — import the repo, add env vars, deploy
- **Railway / Render / Fly.io** — use the standalone output
- **Docker** — `docker build` with the generated Dockerfile in `.next/standalone`

## Contributing

1. Fork → feature branch → PR against `main`
2. The pre-commit hook runs TypeScript check (warning), secret scan (gitleaks, if installed), and a 10 MB file-size guard
3. Soroban contracts require `overflow-checks = true` in `[profile.release]`
4. Looking for open work? [`IMPLEMENTATION_NOTES.md`](./IMPLEMENTATION_NOTES.md) tracks partially-scoped backlog items (e.g. STT integration, escrow slippage protection, OCR KYC) with implementation specs already written out

## License

MIT
