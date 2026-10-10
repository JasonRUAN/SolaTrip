import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export function sha256Hex(value: string): `0x${string}` {
  const bytes = sha256(new TextEncoder().encode(value));
  return `0x${bytesToHex(bytes)}` as `0x${string}`;
}
