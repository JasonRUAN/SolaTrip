"use client";

import { useCallback, useEffect, useState } from "react";
import { useSendTransaction, useSolanaClient } from "@solana/react-hooks";
import { BACKEND_URL } from "@/lib/contracts";
import { activeLocale, getDict } from "@/lib/i18n";
import { submitReviewInstruction } from "@/lib/solana-program";
import type { OnchainReview } from "@/lib/types";
import { useWallet } from "@/lib/use-wallet";
import { formatChainError, isBlockhashNotFound, walletErrorText } from "@/lib/wallet-error";

async function confirmSignature(
  client: ReturnType<typeof useSolanaClient>,
  value: string,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await client.runtime.rpc.getSignatureStatuses([value as never]).send();
    const row = status.value[0];
    if (row?.err) throw new Error(`链上交易失败：${formatChainError(row.err)}`);
    if (row?.confirmationStatus === "confirmed" || row?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("交易确认超时，请在浏览器里查看这笔签名是否已经落地");
}

export function useTokenReview(tokenId?: string) {
  const [review, setReview] = useState<OnchainReview | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!tokenId) {
      setReview(null);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/vouchers/${encodeURIComponent(tokenId)}/review`);
      const payload = (await response.json().catch(() => null)) as { review?: OnchainReview | null } | null;
      setReview(response.ok ? (payload?.review ?? null) : null);
    } catch {
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [tokenId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { review, loading, refresh };
}

export function useSubmitReview(tokenId?: string, provider?: string) {
  const { address } = useWallet();
  const client = useSolanaClient();
  const { send: sendTransaction } = useSendTransaction();
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (score: number, comment: string) => {
      if (!tokenId || !provider) return false;
      if (!address) {
        setError(getDict(activeLocale()).errors.walletNotConnected);
        return false;
      }
      setPending(true);
      setError(null);
      try {
        const funded = await fetch(`${BACKEND_URL}/api/devnet/sol`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address }),
        });
        const payload = (await funded.json().catch(() => null)) as { signature?: string; error?: string } | null;
        if (!funded.ok) throw new Error(payload?.error || getDict(activeLocale()).errors.noSol);
        if (payload?.signature) await confirmSignature(client, payload.signature);
        const instruction = await submitReviewInstruction({
          holder: address,
          provider,
          tokenId,
          score,
          comment,
        });
        let signature: string | undefined;
        let lastError: unknown;
        // finalized 的区块哈希各节点都已经看见；跳过预检，避免钱包节点和 Helius 节点短暂不一致。
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            signature = String(
              await sendTransaction(
                {
                  instructions: [instruction],
                  computeUnitLimit: 400_000,
                  commitment: "finalized",
                  prepareTransaction: false,
                },
                { commitment: "finalized", skipPreflight: true, maxRetries: 5 },
              ),
            );
            lastError = undefined;
            break;
          } catch (err) {
            lastError = err;
            if (attempt === 1 || !isBlockhashNotFound(err)) throw err;
          }
        }
        if (!signature) throw lastError ?? new Error(getDict(activeLocale()).errors.blockhashNotFound);
        await confirmSignature(client, signature);
        return true;
      } catch (err) {
        setError(walletErrorText(activeLocale(), err, getDict(activeLocale()).errors.submitFailed));
        return false;
      } finally {
        setPending(false);
      }
    },
    [address, client, provider, sendTransaction, tokenId],
  );

  return { submit, isPending, error, address };
}
