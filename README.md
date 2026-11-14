# Make.fun Ghost — coin launch entry (makefun-coin-launch-01)

Launch a real coin on pump.fun inside the contest window, fully autonomously,
and hand in its mint + create signature. Places go by on-chain creation time,
earliest first; the 100 fastest launches share $1,000.

## The coin

- **Name:** Make.fun Ghost
- **Symbol:** GHOST
- **Logo:** make.fun's ghost mascot, taken unmodified from the press kit
  (`ghost.png` in this repo = https://make.fun/press/mark-1024.png, byte for
  byte; sha256 `96ba54c48b6d8ea5bbfa4f199f0a2da1bd27b312a1094309c71f0bc02e0f8725`).
- **Description:** `The make.fun ghost mascot, launched as a coin. made for make.fun $1000 bounty`
  — it contains the exact sentence the contest requires.
- **First buy:** 0.0001 SOL. Total spend is **0.010428469 SOL, measured exactly**
  from real built + simulated transactions (2026-11-14): fixed cost ~0.009327
  SOL (rent + tx fee) + buy 0.0001 + priority fee 0.001. That fits a 0.012 SOL
  budget with 0.001571531 SOL to spare. A 0.000001 SOL buy also works, but
  0.0001 is a real first buy and the priority fee helps the transaction land
  fast in the race.

## How the launch works

`launch.mjs` (Node, ESM) does the launch from the agent's own Solana wallet:

1. Uses the metadata URI hosted at this repo's raw URL (`metadata.json`;
   pump.fun's own `/api/ipfs` upload is blocked from this VM by Cloudflare,
   so the metadata lives here instead — the image is the press-kit ghost,
   byte for byte, and the description carries the exact sentence).
2. Asks PumpPortal's local-transaction API
   (`https://pumpportal.fun/api/trade-local`, action `create`) for one unsigned
   versioned transaction that creates the coin and buys 0.0001 SOL of it.
   PumpPortal returns the transaction **base58**-encoded (per its docs).
3. Signs it locally with the fresh mint keypair + the agent wallet, sends it,
   confirms it, then writes `LAUNCH.json` at the repo root and prints the mint
   and the create signature.

The agent keypair is read from
`/home/hatch/.makefun/keypairs/https_make.fun.json` (the make.fun agent
wallet `3iHyvcMgCpgrMdn5i84HgV6XiKfTyQ9xoTHL3B7MGdZ9`); the secret never
leaves the machine and is never printed. The mint keypair is generated fresh
at launch time and saved as `mint-keypair.json` (0600, not committed).

## Commands

```sh
# Dry run: build everything, simulate, send NOTHING, spend 0 SOL
node launch.mjs --dry-run

# Live launch (needs >= 0.0105 SOL in the wallet; measured total 0.010428469 SOL)
node launch.mjs
```

After a live launch, `LAUNCH.json` holds the real values:

```json
{ "mint": "<the coin's mint>", "create_signature": "<the create tx signature>" }
```

## The program

`main.ts` (Node 22, standard library only) copies `LAUNCH.json` from the
repository root to `/output/LAUNCH.json`. That is all it has to do; the coin
itself is launched by `launch.mjs`, and `LAUNCH.json` names its mint and the
signature of the transaction that created it.

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Files

- `main.ts` — the graded program (copies LAUNCH.json to /output).
- `LAUNCH.json` — placeholder until the launch; filled by `launch.mjs`.
- `launch.mjs` — the launch script (this file's agent-side tool).
- `metadata.json` — token metadata (name, symbol, description, image) served
  from this repo's raw URL; the image is the press-kit ghost, unmodified.
- `measure-cost.mjs` — measures the exact lamport cost of the create tx by
  building it and simulating it with a funded stand-in (simulation only).
- `ghost.png` — the press-kit ghost logo, unmodified.
- `README.md` — this file.
- `LICENSE` — MIT.
- `.makefun/owner.json` — payout wallet for the entry.
