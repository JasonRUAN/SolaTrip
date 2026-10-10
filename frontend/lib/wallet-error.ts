/**
 * 写合约失败的展示文案。
 *
 * viem / wagmi 抛出的错误只有英文原文，其中「用户取消签名」是最高频的一种，
 * 直接展示会让中文界面出现英文，必须本地化；其余（revert 原因、gas 不足等）
 * 保留原文 —— 这些信息量都在技术细节里，翻译成中文反而丢信息。
 */
import { getDict } from "./i18n";
import type { Locale } from "./i18n/config";

const WRAPPER =
  /transaction plan failed to execute|transaction simulation failed|cause property is deprecated/i;

/** 用户在钱包弹窗里点了「拒绝 / 取消」 */
export function isUserRejected(error: unknown): boolean {
  const message = errorText(error);
  return /user (rejected|denied)|rejected the request|用户拒绝/i.test(message);
}

function errorText(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error && current.message) messages.push(current.message);
    const record = current as { cause?: unknown; context?: { cause?: unknown } };
    current = record.cause ?? record.context?.cause;
  }
  return messages.findLast((message) => !WRAPPER.test(message)) ?? messages.at(-1) ?? "";
}

/** 链上错误对象里的槽位、错误码是 bigint，直接 JSON.stringify 会抛错。 */
export function formatChainError(value: unknown): string {
  return JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item));
}

export function isBlockhashNotFound(error: unknown): boolean {
  return /blockhash not found/i.test(errorText(error));
}

/** 用户取消 → 本地化文案；其余 Error → 最内层原因；非 Error → 调用方给的兜底文案 */
export function walletErrorText(locale: Locale, error: unknown, fallback: string): string {
  if (isUserRejected(error)) return getDict(locale).errors.userRejected;
  const message = errorText(error);
  if (/attempt to debit an account but found no record of a prior credit/i.test(message)) {
    return getDict(locale).errors.noSol;
  }
  if (isBlockhashNotFound(error)) return getDict(locale).errors.blockhashNotFound;
  return message || fallback;
}
