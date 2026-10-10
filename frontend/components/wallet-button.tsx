"use client";

import { useState } from "react";
import { maskAddress } from "@/lib/format";
import { useT } from "@/lib/i18n/context";
import { useWallet } from "@/lib/use-wallet";

export function WalletButton() {
  const { address, isConnected, connecting, connectors, connect, disconnect } = useWallet();
  const { t } = useT();
  const [open, setOpen] = useState(false);

  if (isConnected && address) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-2 rounded-full border border-brand-200 bg-white/90 px-3 py-2 text-sm font-semibold text-ink-700 shadow-soft"
        >
          <span className="h-2 w-2 rounded-full bg-mint-500" />
          <span className="font-mono">{maskAddress(address)}</span>
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-700">devnet</span>
        </button>
        {open ? (
          <div className="absolute right-0 z-50 mt-2 w-48 rounded-xl border border-brand-100 bg-white p-2 shadow-lift">
            <button
              type="button"
              onClick={() => {
                void disconnect();
                setOpen(false);
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-ink-500 hover:bg-brand-50"
            >
              {t("wallet.disconnect")}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={connecting}
        onClick={() => setOpen((value) => !value)}
        className="sky-gradient rounded-full px-4 py-2 text-sm font-bold text-white shadow-soft disabled:opacity-60"
      >
        {connecting ? t("wallet.connecting") : t("wallet.connect")}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-brand-100 bg-white p-2 shadow-lift">
          {connectors.length === 0 ? (
            <p className="px-3 py-2 text-sm text-ink-300">{t("wallet.noWallet")}</p>
          ) : (
            connectors.map((connector) => (
              <button
                key={connector.id}
                type="button"
                onClick={() => {
                  void connect(connector.id);
                  setOpen(false);
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-ink-700 hover:bg-brand-50"
              >
                {connector.name}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
