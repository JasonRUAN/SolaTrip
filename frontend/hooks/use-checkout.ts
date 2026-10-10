"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { address as solanaAddress } from "@solana/kit";
import { useSendTransaction, useSolanaClient, useSplToken } from "@solana/react-hooks";
import { useWallet } from "@/lib/use-wallet";
import { fromUnits } from "@/lib/format";
import { consumeSSE } from "@/lib/sse-client";
import { BACKEND_URL, CONTRACTS, isDeployed } from "@/lib/contracts";
import {
  invalidateVoucherList,
  loadCheckoutSnapshot,
  saveCheckoutSnapshot,
} from "@/lib/session-cache";
import { saveLocalItinerary } from "@/lib/itinerary-export";
import { useLocale } from "@/lib/i18n/context";
import { activeLocale, getDict, interpolate } from "@/lib/i18n";
import { backendErrorText } from "@/lib/backend-error";
import { formatChainError, walletErrorText } from "@/lib/wallet-error";
import { faucetInstruction, fundOrderInstruction } from "@/lib/solana-program";
import type { ItineraryDay, Quote, SettlementEvent, SettlementStep, TripRequest } from "@/lib/types";

export type CheckoutStage = "connect" | "faucet" | "pay" | "settling" | "done";

/** 结算进度快照里的 phase */
type CheckoutSnapshotPhase = "idle" | "settling" | "done";

/** step.key = `${orderId}-${index}`，并发到达时仍按报价单顺序排 */
function stepIndex(key: string): number {
  const n = Number(key.split("-").pop());
  return Number.isFinite(n) ? n : 0;
}

const SETTLE_WINDOW_SEC = 3 * 24 * 60 * 60;
/** 创建测试币账户大约要 0.002 SOL 租金，再留一点交易费。 */
const MIN_SOL_LAMPORTS = 20_000_000n;

async function confirmSignature(
  client: ReturnType<typeof useSolanaClient>,
  value: string,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await client.runtime.rpc
      .getSignatureStatuses([value as never])
      .send();
    const row = status.value[0];
    if (row?.err) throw new Error(`链上交易失败：${formatChainError(row.err)}`);
    if (row?.confirmationStatus === "confirmed" || row?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("交易确认超时，请在浏览器里查看这笔签名是否已经落地");
}

export function useCheckout(params: {
  quote?: Quote;
  runId?: string;
  days?: ItineraryDay[];
  request?: TripRequest | null;
}) {
  const { quote, days, request } = params;
  const runId = params.runId;
  const { address, isConnected } = useWallet();
  const client = useSolanaClient();
  const { send: sendTransaction } = useSendTransaction();
  const token = useSplToken(CONTRACTS.usdcMint, { owner: address });
  const { t } = useLocale();

  const snapshot = useMemo(() => loadCheckoutSnapshot(runId), [runId]);

  const [phase, setPhase] = useState<CheckoutSnapshotPhase>(snapshot?.phase ?? "idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(snapshot?.orderId ?? null);
  const [payTxHash, setPayTxHash] = useState<string | null>(snapshot?.payTxHash ?? null);
  const [steps, setSteps] = useState<SettlementStep[]>(snapshot?.steps ?? []);
  const [tokenIds, setTokenIds] = useState<string[]>(snapshot?.tokenIds ?? []);

  const watchingRef = useRef<string | null>(null);

  const prevRunIdRef = useRef(runId);
  useEffect(() => {
    if (prevRunIdRef.current !== runId) {
      prevRunIdRef.current = runId;
      watchingRef.current = null;
      setPhase("idle");
      setOrderId(null);
      setPayTxHash(null);
      setSteps([]);
      setTokenIds([]);
      setError(null);
    }
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    if (phase === "idle" && steps.length === 0 && !orderId) return;
    saveCheckoutSnapshot({ runId, phase, orderId, payTxHash, steps, tokenIds });
  }, [runId, phase, orderId, payTxHash, steps, tokenIds]);

  const total = useMemo(() => BigInt(quote?.total ?? "0"), [quote]);
  const balance = token.balance?.amount;

  const readBalance = useCallback(async () => {
    const next = await token.refresh();
    return next?.amount ?? 0n;
  }, [token]);

  /**
   * 当前步骤由真实余额决定：没连钱包停在连接，余额不够停在领测试币，够了才能支付。
   * Solana 的 fund_order 由旅客签名直接划转，没有单独的 ERC20 授权步骤。
   */
  const stage: CheckoutStage = useMemo(() => {
    if (phase === "settling") return "settling";
    if (phase === "done") return "done";
    if (!isConnected || !address) return "connect";
    if (!isDeployed) return "faucet";
    if (token.status === "loading" || balance === undefined) return "faucet";
    if (balance < total) return "faucet";
    return "pay";
  }, [address, balance, isConnected, phase, token.status, total]);

  const ensureSol = useCallback(
    async (owner: string) => {
      const balance = await client.runtime.rpc.getBalance(solanaAddress(owner)).send();
      if (BigInt(balance.value) >= MIN_SOL_LAMPORTS) return;
      let response: Response;
      try {
        response = await fetch(`${BACKEND_URL}/api/devnet/sol`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: owner }),
        });
      } catch (error) {
        throw new Error(
          interpolate(getDict(activeLocale()).errors.backendUnreachable, {
            url: BACKEND_URL,
            msg: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      const payload = (await response.json().catch(() => null)) as { signature?: string; skipped?: boolean; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || getDict(activeLocale()).errors.noSol);
      if (payload?.signature) await confirmSignature(client, payload.signature);
    },
    [client],
  );

  const sendAndConfirm = useCallback(
    async (instruction: Awaited<ReturnType<typeof faucetInstruction>>) => {
      if (!address) throw new Error(getDict(activeLocale()).errors.walletNotConnected);
      try {
        await ensureSol(address);
      } catch (error) {
        const text = walletErrorText(activeLocale(), error, "");
        throw new Error(text || getDict(activeLocale()).errors.noSol);
      }
      const signature = await sendTransaction(
        {
          instructions: [instruction],
          computeUnitLimit: 400_000,
          commitment: "finalized",
          prepareTransaction: false,
        },
        { commitment: "finalized", skipPreflight: true, maxRetries: 5 },
      );
      await confirmSignature(client, String(signature));
      return String(signature);
    },
    [address, client, ensureSol, sendTransaction],
  );

  const faucet = useCallback(async () => {
    if (!isDeployed || !address) return;
    setBusy("faucet");
    setError(null);
    try {
      await sendAndConfirm(await faucetInstruction(address));
      await token.refresh();
    } catch (err) {
      setError(walletErrorText(activeLocale(), err, getDict(activeLocale()).errors.claimFailed));
    } finally {
      setBusy(null);
    }
  }, [address, sendAndConfirm, token]);

  const registerOrder = useCallback(
    async (orderIdValue: string, txHash?: string) => {
      let response: Response;
      try {
        response = await fetch(`${BACKEND_URL}/api/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: params.runId,
            orderId: orderIdValue,
            traveler: address,
            txHash,
            total: quote?.total,
            quote,
            days: days ?? [],
          }),
        });
      } catch (err) {
        throw new Error(
          interpolate(getDict(activeLocale()).errors.backendUnreachable, {
            url: BACKEND_URL,
            msg: err instanceof Error ? err.message : String(err),
          }),
        );
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          interpolate(getDict(activeLocale()).errors.orderRegisterFailed, {
            status: response.status,
            detail,
          }).slice(0, 200),
        );
      }
      if (quote || (days && days.length > 0)) {
        saveLocalItinerary(orderIdValue, { request, days: days ?? [], quote });
      }
    },
    [address, days, params.runId, quote, request],
  );

  const watchSettlement = useCallback(async (orderIdValue: string) => {
    watchingRef.current = orderIdValue;
    setPhase("settling");

    await consumeSSE<SettlementEvent>(
      `${BACKEND_URL}/api/orders/${orderIdValue}/stream`,
      { method: "GET" },
      {
        onError: (streamError) => {
          setError(
            interpolate(getDict(activeLocale()).errors.settlementDisconnected, {
              url: BACKEND_URL,
              msg: streamError.message,
            }),
          );
        },
        onEvent: (event) => {
          if (event.type === "settlement.step") {
            setSteps((prev) => {
              const next = prev.filter((item) => item.key !== event.step.key);
              return [...next, event.step].sort((a, b) => stepIndex(a.key) - stepIndex(b.key));
            });
          }
          if (event.type === "settlement.done") {
            setTokenIds((prev) => {
              const merged = [...prev];
              for (const id of event.tokenIds) {
                if (!merged.includes(id)) merged.push(id);
              }
              return merged;
            });
            setPhase("done");
            invalidateVoucherList();
          }
          if (event.type === "settlement.error") {
            setError(backendErrorText(activeLocale(), event) ?? event.message);
          }
        },
      },
      undefined,
      activeLocale(),
    );
  }, []);

  useEffect(() => {
    if (phase === "settling" && orderId && watchingRef.current !== orderId) {
      void watchSettlement(orderId);
    }
  }, [phase, orderId, watchSettlement]);

  const prepareOrder = useCallback(async () => {
    if (!quote || !address || !runId) {
      throw new Error(getDict(activeLocale()).errors.noOrderId);
    }
    let response: Response;
    try {
      response = await fetch(`${BACKEND_URL}/api/orders/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, traveler: address, quote }),
      });
    } catch (err) {
      throw new Error(
        interpolate(getDict(activeLocale()).errors.backendUnreachable, {
          url: BACKEND_URL,
          msg: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    const payload = (await response.json().catch(() => null)) as { orderId?: string; message?: string; error?: string } | null;
    if (!response.ok || !payload?.orderId) {
      throw new Error(payload?.message || payload?.error || getDict(activeLocale()).errors.noOrderId);
    }
    return payload.orderId;
  }, [address, quote, runId]);

  const pay = useCallback(async () => {
    if (!quote || quote.lineItems.length === 0 || quote.total === "0") return;
    setError(null);

    if (!isDeployed) {
      setError(getDict(activeLocale()).pay.notDeployed);
      return;
    }
    if (!isConnected || !address) {
      setError(getDict(activeLocale()).errors.walletNotConnected);
      return;
    }

    const selfDealing = quote.lineItems.find((item) => item.provider === address);
    if (selfDealing) {
      setError(
        interpolate(getDict(activeLocale()).errors.selfDealing, {
          provider: selfDealing.providerName,
        }),
      );
      return;
    }

    setBusy("prepare");
    try {
      let current = await readBalance();
      let faucetCount = 0;
      while (current < total && faucetCount < 5) {
        setBusy("faucet");
        await sendAndConfirm(await faucetInstruction(address));
        current = await readBalance();
        faucetCount += 1;
      }

      if (current < total) {
        throw new Error(
          interpolate(getDict(activeLocale()).errors.insufficientBalance, {
            balance: String(fromUnits(current)),
            total: String(fromUnits(total)),
          }),
        );
      }

      setBusy("prepare");
      const preparedOrderId = await prepareOrder();
      setBusy("pay");
      const signature = await sendAndConfirm(
        await fundOrderInstruction({
          payer: address,
          orderId: BigInt(preparedOrderId),
          expectedTotal: total,
          itineraryHash: quote.itineraryHash,
          itemCount: quote.lineItems.length,
          settleDeadline: BigInt(Math.floor(Date.now() / 1000) + SETTLE_WINDOW_SEC),
        }),
      );
      setPayTxHash(signature);
      setOrderId(preparedOrderId);
      setBusy(null);
      await token.refresh();
      await registerOrder(preparedOrderId, signature);
      await watchSettlement(preparedOrderId);
    } catch (err) {
      console.error("[pay] 支付流程失败:", err);
      setError(walletErrorText(activeLocale(), err, getDict(activeLocale()).errors.payFailed));
      setBusy(null);
      await token.refresh();
    }
  }, [
    address,
    isConnected,
    prepareOrder,
    quote,
    readBalance,
    registerOrder,
    sendAndConfirm,
    token,
    total,
    watchSettlement,
  ]);

  const retryingRef = useRef(false);

  const retryFailed = useCallback(async () => {
    if (!orderId || retryingRef.current) return;
    const failedSteps = steps.filter((step) => step.status === "failed");
    const indexes = failedSteps.map((step) => stepIndex(step.key));
    if (indexes.length === 0) return;

    const previousErrors = new Map(failedSteps.map((step) => [step.key, step.error]));
    retryingRef.current = true;
    setBusy("retry");
    setError(null);
    setSteps((prev) =>
      prev.map((step) =>
        indexes.includes(stepIndex(step.key))
          ? { ...step, status: "settling", error: undefined }
          : step,
      ),
    );

    try {
      let response: Response;
      try {
        response = await fetch(`${BACKEND_URL}/api/orders/${orderId}/retry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
          indexes,
          runId,
          traveler: address,
          quote,
        }),
        });
      } catch (err) {
        throw new Error(
          interpolate(getDict(activeLocale()).errors.backendUnreachable, {
            url: BACKEND_URL,
            msg: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          backendErrorText(activeLocale(), {
            code: payload?.error,
            message: payload?.message,
          }) ?? getDict(activeLocale()).errors.payFailed,
        );
      }
      setPhase("settling");
      await watchSettlement(orderId);
      setSteps((prev) =>
        prev.map((step) =>
          previousErrors.has(step.key) && (step.status === "settling" || step.status === "paid")
            ? {
                ...step,
                status: "failed",
                error: step.error ?? previousErrors.get(step.key),
              }
            : step,
        ),
      );
    } catch (err) {
      setSteps((prev) =>
        prev.map((step) =>
          previousErrors.has(step.key) && step.status === "settling"
            ? { ...step, status: "failed", error: previousErrors.get(step.key) }
            : step,
        ),
      );
      setError(err instanceof Error ? err.message : getDict(activeLocale()).errors.payFailed);
    } finally {
      retryingRef.current = false;
      setPhase((current) => (current === "settling" ? "done" : current));
      setBusy(null);
    }
  }, [address, orderId, quote, runId, steps, watchSettlement]);

  const nextAction = useMemo(() => {
    if (phase === "settling" || phase === "done") return null;
    if (!isDeployed) return { label: t("pay.notDeployed"), run: pay };
    if (!isConnected) return { label: t("errors.nextActionConnect"), run: () => {} };
    return { label: t("errors.nextActionPay"), run: pay };
  }, [isConnected, pay, phase, t]);

  return {
    stage,
    busy,
    error,
    orderId,
    payTxHash,
    steps,
    tokenIds,
    total,
    isConnected,
    actions: { faucet, pay, retryFailed },
    nextAction,
    requiresWallet: isDeployed && !isConnected,
  };
}
