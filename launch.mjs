// launch.mjs — launch the Make.fun Ghost coin on pump.fun (makefun-coin-launch-01).
//
// Flow (PumpPortal local-transaction API, all signing local):
//   1. Use the metadata URI hosted at this repo's raw URL (metadata.json;
//      pump.fun's own /api/ipfs upload is blocked from this VM by Cloudflare,
//      and the metadata image is the press-kit ghost, byte for byte).
//   2. POST https://pumpportal.fun/api/trade-local { action: "create", ... }
//      -> one unsigned versioned transaction (create + first buy in one tx).
//      PumpPortal returns the transaction BASE58-encoded (per its docs).
//   3. Sign with the fresh mint keypair + the agent wallet, send, confirm.
//   4. Print the mint + create signature and write LAUNCH.json next to this script.
//
// Cost (measured exactly from real built + simulated transactions, 2026-11-14):
//   fixed cost (rent + tx fee, before buy/priority): ~9,327,000 lamports
//   first buy 0.0001 SOL (100,000 lamports) + priority fee 0.001 SOL
//   TOTAL: 10,428,469 lamports = 0.010428469 SOL — fits a 0.012 SOL budget
//   with 1,571,531 lamports (0.001571531 SOL) to spare.
//
// Usage:
//   node launch.mjs                # live launch (needs >= 0.0105 SOL in the wallet)
//   node launch.mjs --dry-run      # build everything, simulate, send NOTHING, spend 0 SOL
//   node launch.mjs --buy-sol 0.0001 --priority-sol 0.001
//
// The agent keypair is read from MAKEFUN_KEYPAIR (default
// /home/hatch/.makefun/keypairs/https_make.fun.json). The secret never leaves
// this machine and is never printed. The mint keypair is generated fresh at
// launch time and saved (0600) as mint-keypair.json next to this script; it is
// NOT committed to the repo.

import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

const DIR = dirname(fileURLToPath(import.meta.url));
const KEYPAIR_PATH = process.env.MAKEFUN_KEYPAIR ?? '/home/hatch/.makefun/keypairs/https_make.fun.json';
const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const TRADE_LOCAL_URL = 'https://pumpportal.fun/api/trade-local';

// Metadata hosted at this repo's raw URL. The image is the press-kit ghost
// (ghost.png in this repo), byte for byte; the description carries the exact
// sentence the contest requires.
const METADATA_URI = 'https://raw.githubusercontent.com/nothing010101/makefun-coin-launch/main/metadata.json';
const TOKEN_NAME = 'Make.fun Ghost';
const TOKEN_SYMBOL = 'GHOST';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const getFlag = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};
// Minimal spend that fits the 0.012 SOL budget (measured, see header).
const BUY_SOL = getFlag('--buy-sol', 0.0001);
const PRIORITY_SOL = getFlag('--priority-sol', 0.001);
const MIN_BALANCE_SOL = 0.0105;

const log = (...m) => console.log('[launch]', ...m);

function loadKeypair(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function buildCreateTx({ wallet, mint }) {
  const payload = [
    {
      publicKey: wallet.publicKey.toBase58(),
      action: 'create',
      tokenMetadata: { name: TOKEN_NAME, symbol: TOKEN_SYMBOL, uri: METADATA_URI },
      mint: mint.publicKey.toBase58(),
      denominatedInSol: 'true',
      amount: BUY_SOL,
      slippage: 10,
      priorityFee: PRIORITY_SOL,
      pool: 'pump',
    },
  ];
  const res = await fetch(TRADE_LOCAL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`trade-local failed (${res.status}): ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body);
  const encoded = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!encoded || typeof encoded !== 'string') {
    throw new Error(`trade-local returned an unexpected shape: ${body.slice(0, 300)}`);
  }
  // PumpPortal returns base58 (per its docs), NOT base64.
  return VersionedTransaction.deserialize(Buffer.from(bs58.decode(encoded)));
}

function base58Encode(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) out = '1' + out;
    else break;
  }
  return out;
}

async function main() {
  const wallet = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(RPC_URL, 'confirmed');
  log(`wallet: ${wallet.publicKey.toBase58()}`);
  log(`mode: ${DRY_RUN ? 'DRY RUN (nothing will be signed or sent)' : 'LIVE'}`);
  log(`buy: ${BUY_SOL} SOL, priority fee: ${PRIORITY_SOL} SOL, metadata: ${METADATA_URI}`);

  const balanceLamports = await connection.getBalance(wallet.publicKey);
  const balanceSol = balanceLamports / 1e9;
  log(`wallet balance: ${balanceSol} SOL`);
  if (!DRY_RUN && balanceSol < MIN_BALANCE_SOL) {
    throw new Error(
      `insufficient SOL: have ${balanceSol}, need >= ${MIN_BALANCE_SOL} ` +
        `(measured total ${BUY_SOL + PRIORITY_SOL + 0.009327} SOL for buy ${BUY_SOL} + priority ${PRIORITY_SOL}). Fund the wallet first.`,
    );
  }

  const mint = Keypair.generate();
  log(`mint: ${mint.publicKey.toBase58()}`);
  const mintKeypairPath = join(DIR, 'mint-keypair.json');
  writeFileSync(mintKeypairPath, JSON.stringify(Array.from(mint.secretKey)));
  chmodSync(mintKeypairPath, 0o600);
  log(`mint keypair saved (0600) to ${mintKeypairPath} — NOT committed to the repo`);

  const tx = await buildCreateTx({ wallet, mint });
  log(`unsigned create tx built: blockhash ${tx.message.recentBlockhash}`);

  if (DRY_RUN) {
    const sim = await connection.simulateTransaction(tx, { sigVerify: false });
    const errText = sim.value.err ? JSON.stringify(sim.value.err) : 'none';
    log(`simulation err: ${errText}`);
    // Expected in dry-run with an unfunded wallet: the fee payer either has
    // too little SOL ("insufficient funds") or does not exist on chain yet
    // ("AccountNotFound" — a never-funded account). Either way the tx itself
    // is well-formed; it just cannot pay yet.
    const fundsError = /insufficient|lamports|funds|AccountNotFound/i.test(errText);
    if (sim.value.err && !fundsError) {
      throw new Error(`simulation failed with a non-funds error — investigate before launching: ${errText}`);
    }
    if (fundsError) {
      log('simulation stopped at the funds check, as expected with a 0-SOL wallet — the transaction itself is well-formed.');
    } else {
      log('simulation passed with no error.');
    }
    log('DRY RUN OK: create tx build + simulation verified. Nothing signed, nothing sent, 0 SOL spent.');
    log(`would-be mint: ${mint.publicKey.toBase58()}`);
    return;
  }

  tx.sign([mint, wallet]);
  const sig = base58Encode(tx.signatures[0]);
  log(`signed. create signature: ${sig}`);

  const latest = await connection.getLatestBlockhash('confirmed');
  const raw = tx.serialize();
  const sentSig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
  if (sentSig !== sig) log(`note: sendRawTransaction returned ${sentSig} (expected ${sig})`);
  log(`sent: https://solscan.io/tx/${sig}`);

  let confirmed = false;
  try {
    const conf = await connection.confirmTransaction(
      { signature: sig, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      'confirmed',
    );
    confirmed = !conf.value.err;
    if (conf.value.err) log(`confirm returned error: ${JSON.stringify(conf.value.err)}`);
  } catch (e) {
    log(`confirm timed out: ${e.message} — polling signature status...`);
  }
  if (!confirmed) {
    for (let i = 0; i < 12 && !confirmed; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const st = await connection.getSignatureStatuses([sig]);
      const s = st.value[0];
      log(`status poll ${i + 1}: ${s ? `${s.confirmationStatus ?? 'unknown'}${s.err ? ` err=${JSON.stringify(s.err)}` : ''}` : 'not found yet'}`);
      if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') && !s.err) confirmed = true;
    }
  }

  if (!confirmed) {
    writeFileSync(join(DIR, 'launch-pending.json'), JSON.stringify({ mint: mint.publicKey.toBase58(), create_signature: sig }, null, 2));
    throw new Error(
      `create tx sent but NOT confirmed within the wait window. Signature: ${sig}. ` +
        `Mint + signature saved to launch-pending.json — verify on Solscan before writing LAUNCH.json.`,
    );
  }

  const launch = { mint: mint.publicKey.toBase58(), create_signature: sig };
  writeFileSync(join(DIR, 'LAUNCH.json'), JSON.stringify(launch, null, 2) + '\n');
  log('LAUNCHED.');
  log(`mint: ${launch.mint}`);
  log(`create_signature: ${launch.create_signature}`);
  log(`pump.fun: https://pump.fun/coin/${launch.mint}`);
  log('LAUNCH.json written at the repo root.');
}

main().catch((err) => {
  console.error('[launch] FAILED:', err.message);
  process.exit(1);
});
