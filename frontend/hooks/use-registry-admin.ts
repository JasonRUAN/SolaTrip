"use client";

import { useCallback, useEffect, useState } from "react";
import { address as toAddress, getAddressDecoder, type Instruction } from "@solana/kit";
import { useSendTransaction, useSolanaClient } from "@solana/react-hooks";
import { BACKEND_URL, CONTRACTS, isDeployed } from "@/lib/contracts";
import { activeLocale, getDict } from "@/lib/i18n";
import {
  agentAccountAddress,
  registerAgentInstruction,
  setAgentActiveInstruction,
} from "@/lib/solana-program";
import { maskFromCategories, type CategoryCode } from "@/lib/types";
import { useWallet } from "@/lib/use-wallet";
import { formatChainError, isBlockhashNotFound } from "@/lib/wallet-error";

export type OwnerState = "loading" | "ready" | "error";

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).length;
}

function bytesFromAccountData(data: unknown): Uint8Array | null {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  const raw = Array.isArray(data) ? data[0] : data;
  if (typeof raw !== "string" || raw.length === 0) return null;
  const binary = atob(raw);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function accountBytes(
  client: ReturnType<typeof useSolanaClient>,
  account: string,
): Promise<Uint8Array | null> {
  const info = await client.runtime.rpc
    .getAccountInfo(toAddress(account), { encoding: "base64" })
    .send();
  return bytesFromAccountData(info.value?.data);
}

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

async function ensureSol(client: ReturnType<typeof useSolanaClient>, owner: string): Promise<void> {
  const funded = await fetch(`${BACKEND_URL}/api/devnet/sol`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: owner }),
  });
  const payload = (await funded.json().catch(() => null)) as { signature?: string; error?: string } | null;
  if (!funded.ok) throw new Error(payload?.error || getDict(activeLocale()).errors.noSol);
  if (payload?.signature) await confirmSignature(client, payload.signature);
}

export function useRegistryAdmin() {
  const { address, isConnected } = useWallet();
  const client = useSolanaClient();
  const { send: sendTransaction } = useSendTransaction();
  const [adminAddress, setAdminAddress] = useState<string | null>(null);
  const [ownerState, setOwnerState] = useState<OwnerState>("loading");
  const [isPending, setPending] = useState(false);

  useEffect(() => {
    if (!isDeployed) {
      setAdminAddress(null);
      setOwnerState("ready");
      return;
    }
    let cancelled = false;
    setOwnerState("loading");
    void accountBytes(client, CONTRACTS.config)
      .then((data) => {
        if (cancelled) return;
        if (!data || data.length < 40) {
          setAdminAddress(null);
          setOwnerState("ready");
          return;
        }
        setAdminAddress(getAddressDecoder().decode(data.subarray(8, 40)));
        setOwnerState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setAdminAddress(null);
        setOwnerState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const isOwner = Boolean(isConnected && address && adminAddress && address === adminAddress);

  const sendInstruction = useCallback(
    async (instruction: Instruction) => {
      if (!address) throw new Error(getDict(activeLocale()).errors.walletNotConnected);
      await ensureSol(client, address);
      let signature: string | undefined;
      let lastError: unknown;
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
        } catch (error) {
          lastError = error;
          if (attempt === 1 || !isBlockhashNotFound(error)) throw error;
        }
      }
      if (!signature) throw lastError ?? new Error(getDict(activeLocale()).errors.blockhashNotFound);
      await confirmSignature(client, signature);
    },
    [address, client, sendTransaction],
  );

  const register = useCallback(
    async (input: {
      agent: string;
      name: string;
      categories: CategoryCode[];
      endpoint: string;
      description: string;
      website: string;
    }) => {
      const dict = getDict(activeLocale());
      if (!address) throw new Error(dict.errors.walletNotConnected);
      if (!adminAddress || address !== adminAddress) throw new Error(dict.admin.notOwner);
      let provider: string;
      try {
        provider = toAddress(input.agent.trim());
      } catch {
        throw new Error(dict.admin.errFillFields);
      }
      const name = input.name.trim();
      const endpoint = input.endpoint.trim().replace(/\/+$/, "");
      const description = input.description.trim();
      const website = input.website.trim();
      const mask = maskFromCategories(input.categories);
      if (!name || mask < 1 || mask > 15) throw new Error(dict.admin.errNeedCategory);
      if (
        utf8Size(name) > 64 ||
        utf8Size(endpoint) > 128 ||
        utf8Size(description) > 128 ||
        utf8Size(website) > 128
      ) {
        throw new Error(dict.admin.errTextTooLong);
      }
      const existing = await accountBytes(client, await agentAccountAddress(provider));
      if (existing) throw new Error(dict.admin.alreadyRegistered);

      setPending(true);
      try {
        await sendInstruction(
          await registerAgentInstruction({
            admin: address,
            provider,
            name,
            categoryMask: mask,
            endpoint,
            description,
            website,
          }),
        );
      } finally {
        setPending(false);
      }
    },
    [address, adminAddress, client, sendInstruction],
  );

  const setActive = useCallback(
    async (agent: string, active: boolean) => {
      const dict = getDict(activeLocale());
      if (!address) throw new Error(dict.errors.walletNotConnected);
      if (!adminAddress || address !== adminAddress) throw new Error(dict.admin.notOwner);
      let provider: string;
      try {
        provider = toAddress(agent.trim());
      } catch {
        throw new Error(dict.admin.errFillFields);
      }
      setPending(true);
      try {
        await sendInstruction(
          await setAgentActiveInstruction({ admin: address, provider, active }),
        );
      } finally {
        setPending(false);
      }
    },
    [address, adminAddress, sendInstruction],
  );

  return { isOwner, ownerState, isPending, register, setActive };
}
