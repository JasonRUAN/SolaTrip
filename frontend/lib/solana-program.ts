import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from "@solana/kit";
import { CONTRACTS } from "./contracts";
import { canonicalVoucherId } from "./voucher-id";

const PROGRAM_ID = address(CONTRACTS.programId);
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

const FAUCET_DISC = hex("00623b1e908e710c");
const FUND_ORDER_DISC = hex("e062846e9dd8ea36");
const SUBMIT_REVIEW_DISC = hex("6a1e3253592ed5ef");

const encoder = getAddressEncoder();

function addr(value: Address): Uint8Array {
  return new Uint8Array(encoder.encode(value));
}

function hex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function u64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function borshString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(u32(bytes.length), bytes);
}

function i64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, value, true);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function pda(seeds: Uint8Array[]): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds });
  return derived;
}

export async function associatedTokenAddress(owner: string, mint: string): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM,
    seeds: [addr(address(owner)), addr(TOKEN_PROGRAM), addr(address(mint))],
  });
  return derived;
}

export async function orderAddress(orderId: bigint): Promise<Address> {
  return pda([new TextEncoder().encode("order"), u64(orderId)]);
}

export function hexToBytes(value: string): Uint8Array {
  const hexText = value.replace(/^0x/, "");
  if (hexText.length !== 64) throw new Error("行程哈希长度不正确");
  return hex(hexText);
}

/** 旅客签名领取测试币。faucet 会在需要时创建关联代币账户。 */
export async function faucetInstruction(traveler: string): Promise<Instruction> {
  const travelerAddress = address(traveler);
  return {
    programAddress: PROGRAM_ID,
    data: FAUCET_DISC,
    accounts: [
      { address: travelerAddress, role: AccountRole.WRITABLE_SIGNER },
      { address: address(CONTRACTS.config), role: AccountRole.READONLY },
      { address: address(CONTRACTS.usdcMint), role: AccountRole.WRITABLE },
      { address: await associatedTokenAddress(traveler, CONTRACTS.usdcMint), role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: ATA_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
  };
}

/** 旅客签名 fund_order，把测试币转入该订单金库。 */
export async function fundOrderInstruction(params: {
  payer: string;
  orderId: bigint;
  expectedTotal: bigint;
  itineraryHash: string;
  itemCount: number;
  settleDeadline: bigint;
}): Promise<Instruction> {
  const payer = address(params.payer);
  const mint = address(CONTRACTS.usdcMint);
  const order = await orderAddress(params.orderId);
  return {
    programAddress: PROGRAM_ID,
    data: concat(
      FUND_ORDER_DISC,
      u64(params.expectedTotal),
      hexToBytes(params.itineraryHash),
      Uint8Array.of(params.itemCount),
      i64(params.settleDeadline),
    ),
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: order, role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.READONLY },
      { address: address(CONTRACTS.config), role: AccountRole.READONLY },
      { address: await associatedTokenAddress(params.payer, CONTRACTS.usdcMint), role: AccountRole.WRITABLE },
      { address: await associatedTokenAddress(order, CONTRACTS.usdcMint), role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: ATA_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
  };
}

async function voucherAddress(tokenId: string): Promise<Address> {
  const id = canonicalVoucherId(tokenId);
  if (!id) throw new Error("无法识别凭证编号");
  const [orderId, indexRaw] = id.split("-");
  const index = Number(indexRaw);
  if (!orderId || !Number.isInteger(index) || index < 0 || index > 255) {
    throw new Error("无法识别凭证编号");
  }
  return pda([new TextEncoder().encode("voucher"), u64(BigInt(orderId)), Uint8Array.of(index)]);
}

/** 持有人签名提交评价。评价账户和服务商累计分都由这笔交易创建。 */
export async function submitReviewInstruction(params: {
  holder: string;
  provider: string;
  tokenId: string;
  score: number;
  comment: string;
}): Promise<Instruction> {
  const holder = address(params.holder);
  const provider = address(params.provider);
  const voucher = await voucherAddress(params.tokenId);
  return {
    programAddress: PROGRAM_ID,
    data: concat(SUBMIT_REVIEW_DISC, Uint8Array.of(params.score), borshString(params.comment)),
    accounts: [
      { address: holder, role: AccountRole.WRITABLE_SIGNER },
      { address: voucher, role: AccountRole.READONLY },
      { address: await pda([new TextEncoder().encode("agent"), addr(provider)]), role: AccountRole.READONLY },
      { address: await pda([new TextEncoder().encode("review"), addr(voucher)]), role: AccountRole.WRITABLE },
      { address: await pda([new TextEncoder().encode("score"), addr(provider)]), role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
  };
}
