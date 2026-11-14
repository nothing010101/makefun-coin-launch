// measure-cost.mjs — measure the EXACT lamport cost of the pump.fun create tx.
// Builds the real create transaction via PumpPortal trade-local, then simulates
// it with a funded stand-in as fee payer (simulation only, nothing is signed
// or sent) and reads the fee payer's lamport delta. That delta is the exact
// total SOL the wallet would spend for those parameters.
//
// The stand-in is a real funded wallet observed as a fee payer in a recent
// block (15.0 SOL). It is used ONLY as a simulation fee payer: no signature
// is ever requested from it and nothing is sent.
//
// Usage: node measure-cost.mjs [buySol] [prioritySol]
// Defaults: buy 0.001, priority 0.

import { Connection, Keypair, VersionedTransaction, PublicKey, TransactionMessage } from '@solana/web3.js';
import bs58 from 'bs58';

const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const TRADE_LOCAL_URL = 'https://pumpportal.fun/api/trade-local';
const METADATA_URI = 'https://raw.githubusercontent.com/nothing010101/makefun-coin-launch/main/metadata.json';
const STANDIN = 'C8Bey3LKVJHVqN6xPTeW8WJfUgFQAeGNBpT4Rp99JP1k';

const BUY_SOL = Number(process.argv[2] ?? 0.001);
const PRIORITY_SOL = Number(process.argv[3] ?? 0);

const connection = new Connection(RPC_URL, 'confirmed');

async function buildTx(publicKey, mint, buySol, prioritySol) {
  const payload = [
    {
      publicKey,
      action: 'create',
      tokenMetadata: { name: 'Make.fun Ghost', symbol: 'GHOST', uri: METADATA_URI },
      mint: mint.publicKey.toBase58(),
      denominatedInSol: 'true',
      amount: buySol,
      slippage: 10,
      priorityFee: prioritySol,
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
  // PumpPortal returns base58 (per its docs), not base64.
  return VersionedTransaction.deserialize(Buffer.from(bs58.decode(encoded)));
}

async function main() {
  const mint = Keypair.generate();
  const tx = await buildTx(STANDIN, mint, BUY_SOL, PRIORITY_SOL);
  console.log(`mint: ${mint.publicKey.toBase58()}`);
  console.log(`buy=${BUY_SOL} SOL priority=${PRIORITY_SOL} SOL`);

  // Decompile instructions (resolve address lookup tables first).
  const lutAccounts = [];
  for (const lut of tx.message.addressTableLookups) {
    const res = await connection.getAddressLookupTable(lut.accountKey);
    if (!res.value) throw new Error(`lookup table not found: ${lut.accountKey.toBase58()}`);
    lutAccounts.push(res.value);
  }
  const msg = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: lutAccounts });
  console.log(`instructions: ${msg.instructions.length}`);
  for (const [i, ix] of msg.instructions.entries()) {
    console.log(`  ix${i} ${ix.programId.toBase58()} dataLen=${ix.data.length} hex=${Buffer.from(ix.data).toString('hex').slice(0, 100)}`);
  }

  const feeRes = await connection.getFeeForMessage(tx.message, 'confirmed');
  console.log(`tx fee (getFeeForMessage): ${feeRes.value} lamports`);

  const pre = await connection.getBalance(new PublicKey(STANDIN));
  const sim = await connection.simulateTransaction(tx, {
    sigVerify: false,
    commitment: 'processed',
    accounts: { encoding: 'base64', addresses: [STANDIN] },
  });
  if (sim.value.err) {
    console.log(`simulation err: ${JSON.stringify(sim.value.err)}`);
    console.log(`logs: ${(sim.value.logs ?? []).slice(0, 25).join('\n  ')}`);
    throw new Error('simulation failed — cannot measure cost from this transaction');
  }
  const post = sim.value.accounts?.[0]?.lamports;
  if (post === undefined || post === null) throw new Error('simulation returned no account state');
  const delta = pre - post;
  console.log(`stand-in lamports before: ${pre}`);
  console.log(`stand-in lamports after sim: ${post}`);
  console.log(`TOTAL COST buy=${BUY_SOL} priority=${PRIORITY_SOL}: ${delta} lamports = ${delta / 1e9} SOL`);
  console.log(`  tx fee: ${feeRes.value} lamports`);
  console.log(`  buy: ${BUY_SOL * 1e9} lamports`);
  console.log(`  fixed cost (total - buy): ${delta - BUY_SOL * 1e9} lamports = ${(delta - BUY_SOL * 1e9) / 1e9} SOL`);
}

main().catch((e) => {
  console.error('MEASURE FAILED:', e.message);
  process.exit(1);
});
