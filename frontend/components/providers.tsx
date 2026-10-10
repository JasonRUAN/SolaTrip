"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SolanaProvider } from "@solana/react-hooks";
import { autoDiscover, createClient } from "@solana/client";
import { CONTRACTS } from "@/lib/contracts";
import { LocaleProvider } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/config";

const directRpc = process.env.NEXT_PUBLIC_SOLANA_RPC ?? CONTRACTS.rpc;
// 浏览器直连 devnet 公共节点经常被跨域拦住。HTTP 走同源反代，订阅仍用节点的 websocket。
const endpoint =
  typeof window === "undefined" ? directRpc : `${window.location.origin}/solana-rpc`;
const websocketEndpoint = directRpc.replace("https://", "wss://").replace("http://", "ws://");

export const solanaClient = createClient({
  endpoint,
  websocketEndpoint,
  // 签名必须声明 solana:devnet。钱包账户列表里第一条链经常是 mainnet，
  // 用那条链去验 devnet 区块哈希时，钱包会直接返回 Blockhash not found。
  walletConnectors: autoDiscover({
    overrides: () => ({ defaultChain: "solana:devnet" }),
  }),
});

export function AppProviders({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale: Locale;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SolanaProvider client={solanaClient}>
        <LocaleProvider initialLocale={initialLocale}>{children}</LocaleProvider>
      </SolanaProvider>
    </QueryClientProvider>
  );
}
