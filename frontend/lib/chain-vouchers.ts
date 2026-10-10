import { BACKEND_URL } from "./contracts";
import type { VoucherDetail } from "./types";

export async function fetchHolderVouchers(address: string): Promise<VoucherDetail[]> {
  const response = await fetch(`${BACKEND_URL}/api/vouchers?address=${encodeURIComponent(address)}`);
  if (!response.ok) return [];
  const payload = (await response.json()) as { vouchers?: VoucherDetail[] };
  return payload.vouchers ?? [];
}

export async function enrichVoucherMetadata(details: VoucherDetail[]): Promise<VoucherDetail[]> {
  return Promise.all(
    details.map(async (detail) => {
      if (detail.metadata) return detail;
      const response = await fetch(`${BACKEND_URL}/api/vouchers/${detail.tokenId}/metadata`);
      if (!response.ok) return detail;
      const metadata = await response.json();
      return { ...detail, metadata };
    }),
  );
}
