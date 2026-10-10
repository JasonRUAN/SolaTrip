import { formatVoucherId, isVoucherIdReady } from "./voucher-id";

/**
 * 从扫到的文本里取出对外凭证号（ST-000001-01）。
 * 票面二维码是 `/verify/{id}` 或 `solatrip://voucher/{id}`，也接受直接印出来的编号。
 */
export function parseVoucherQr(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;

  const embedded =
    raw.match(/\/verify\/([^/?#\s]+)/i)?.[1] ??
    raw.match(/(?:solatrip|solatrip):\/\/voucher\/([^/?#\s]+)/i)?.[1];

  let candidate = embedded ?? raw;
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // 非法转义就按原文继续认编号
  }

  if (!isVoucherIdReady(candidate)) return null;
  return formatVoucherId(candidate);
}
