/**
 * 对外凭证号：ST-000001-01。
 * 链上与接口内部仍是 orderId-itemIndex（如 1-1），两边必须用同一套规则互转。
 * 对应实现：agents/shared/voucher-id.ts
 */

function unpad(digits: string): string {
  const trimmed = digits.replace(/^0+/, "");
  return trimmed.length > 0 ? trimmed : "0";
}

/** 用户输入已完整，可以拿去查询。半截的 ST-000001-0 不算。 */
export function isVoucherIdReady(input: string): boolean {
  const raw = input.trim().toUpperCase();
  return /^ST-\d{6,}-\d{2,}$/.test(raw) || /^\d+-\d+$/.test(raw);
}

/** 对外编号或旧的 order-item 形式 → 存储用的 orderId-itemIndex。认不出则返回 null。 */
export function canonicalVoucherId(input: string): string | null {
  const raw = input.trim().toUpperCase();
  const prefixed = /^ST-(\d+)-(\d+)$/.exec(raw);
  if (prefixed) return `${unpad(prefixed[1])}-${unpad(prefixed[2])}`;
  const plain = /^(\d+)-(\d+)$/.exec(raw);
  if (plain) return `${unpad(plain[1])}-${unpad(plain[2])}`;
  return null;
}

/** 1-1 → ST-000001-01。已经是对外编号时原样补齐。 */
export function formatVoucherId(tokenId: string): string {
  const canonical = canonicalVoucherId(tokenId);
  if (!canonical) return tokenId;
  const [order, item] = canonical.split("-");
  return `ST-${order.padStart(6, "0")}-${item.padStart(2, "0")}`;
}
