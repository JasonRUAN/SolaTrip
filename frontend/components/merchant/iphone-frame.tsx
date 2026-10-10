"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { useT } from "@/lib/i18n/context";
import { INTL_TAG, type Locale } from "@/lib/i18n/config";

function useClock(locale: Locale): string {
  const tag = INTL_TAG[locale];
  return useSyncExternalStore(
    (onChange) => {
      const id = window.setInterval(onChange, 30_000);
      return () => window.clearInterval(id);
    },
    () =>
      new Date().toLocaleTimeString(tag, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    () => "9:41"
  );
}

/** 桌面上的 iPhone 外壳。窄屏去掉金属边框，屏幕铺满商户页。 */
export function IphoneFrame({
  variant,
  children,
}: {
  variant: "scan" | "manual";
  children: ReactNode;
}) {
  const { t, locale } = useT();
  const time = useClock(locale);
  const onLight = variant === "manual";

  return (
    <div className="flex w-full flex-col items-center">
      <div className="relative w-full md:w-[min(390px,calc((100dvh-148px)*390/844))]">
        <span
          aria-hidden
          className="absolute top-28 -left-[3px] hidden h-8 w-[3px] rounded-l-sm bg-[#3a3e46] md:block"
        />
        <span
          aria-hidden
          className="absolute top-40 -left-[3px] hidden h-14 w-[3px] rounded-l-sm bg-[#3a3e46] md:block"
        />
        <span
          aria-hidden
          className="absolute top-56 -left-[3px] hidden h-14 w-[3px] rounded-l-sm bg-[#3a3e46] md:block"
        />
        <span
          aria-hidden
          className="absolute top-40 -right-[3px] hidden h-20 w-[3px] rounded-r-sm bg-[#3a3e46] md:block"
        />

        <div className="relative md:rounded-[3rem] md:bg-[linear-gradient(165deg,#4a4e57_0%,#1c1e24_38%,#2a2e36_100%)] md:p-3 md:shadow-[0_30px_70px_-24px_rgba(14,42,78,0.55),inset_0_1px_0_rgba(255,255,255,0.28)]">
          <div
            className={`relative flex h-[calc(100dvh-68px)] flex-col overflow-hidden md:h-[min(820px,calc(100dvh-172px))] md:rounded-[2.35rem] ${
              onLight ? "bg-sky-tint" : "bg-black"
            }`}
          >
            <div
              className={`pointer-events-none absolute inset-x-0 top-0 z-30 grid h-12 grid-cols-[1fr_7.5rem_1fr] items-end px-5 pb-1 text-[12px] font-semibold tracking-wide ${
                onLight ? "text-ink-900" : "text-white"
              }`}
            >
              <span className="tabular-nums">{time}</span>
              <span />
              <span className="flex items-center justify-end gap-1.5">
                <span className="flex items-end gap-[2px]" aria-hidden>
                  <i className={`h-1 w-[3px] rounded-sm ${onLight ? "bg-ink-900" : "bg-white"}`} />
                  <i className={`h-1.5 w-[3px] rounded-sm ${onLight ? "bg-ink-900" : "bg-white"}`} />
                  <i className={`h-2.5 w-[3px] rounded-sm ${onLight ? "bg-ink-900" : "bg-white"}`} />
                </span>
                <span
                  aria-hidden
                  className={`relative h-[10px] w-[20px] rounded-[3px] border ${
                    onLight ? "border-ink-900" : "border-white"
                  }`}
                >
                  <span
                    className={`absolute inset-[1.5px] right-[3px] rounded-[1px] ${
                      onLight ? "bg-ink-900" : "bg-white"
                    }`}
                  />
                  <span
                    className={`absolute top-1/2 -right-[2px] h-1 w-[2px] -translate-y-1/2 rounded-r-sm ${
                      onLight ? "bg-ink-900" : "bg-white"
                    }`}
                  />
                </span>
              </span>
            </div>

            <span
              aria-hidden
              className="pointer-events-none absolute top-3 left-1/2 z-40 flex h-7 w-[108px] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-3"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-[#1a2744] ring-1 ring-[#0e1a33]" />
            </span>

            <div className="flex min-h-0 flex-1 flex-col">{children}</div>

            <div className="flex h-5 shrink-0 items-center justify-center">
              <span
                aria-hidden
                className={`h-1 w-28 rounded-full ${onLight ? "bg-ink-900/80" : "bg-white/70"}`}
              />
            </div>
          </div>
        </div>
      </div>
      <p className="mt-4 hidden max-w-sm text-center text-[11px] font-semibold text-ink-300 md:block">
        {t("merchant.stageHint")}
      </p>
    </div>
  );
}
