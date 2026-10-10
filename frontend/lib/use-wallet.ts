"use client";

import { useWalletConnection } from "@solana/react-hooks";

export function useWallet() {
  const connection = useWalletConnection();
  return {
    address: connection.wallet?.account.address,
    isConnected: connection.connected,
    connecting: connection.connecting,
    connectors: connection.connectors,
    connect: connection.connect,
    disconnect: connection.disconnect,
    wallet: connection.wallet,
  };
}
