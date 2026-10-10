"use client";

import { useEffect, useRef, useState } from "react";
import { parseVoucherQr } from "@/lib/parse-voucher-qr";
import { useT } from "@/lib/i18n/context";

type CameraProblem = "denied" | "missing" | "failed";
type ScannerControls = { stop: () => void };

function cameraProblem(error: unknown): CameraProblem {
  const name =
    error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return "missing";
  }
  return "failed";
}

function stopStream(video: HTMLVideoElement | null) {
  const stream = video?.srcObject;
  if (stream instanceof MediaStream) {
    for (const track of stream.getTracks()) track.stop();
  }
}

/** 电脑摄像头取景。识别到凭证号后交给外面的同一套预览和核销。 */
export function ScannerApp({
  onDetected,
  onUseManual,
}: {
  onDetected: (voucherId: string) => void;
  onUseManual: () => void;
}) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const unrecognizedAt = useRef(0);
  const hideTimer = useRef<number | null>(null);
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [live, setLive] = useState(false);
  const [unrecognized, setUnrecognized] = useState(false);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let controls: ScannerControls | null = null;

    const start = async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 200,
        });
        controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
          if (cancelled || !result) return;
          const voucherId = parseVoucherQr(result.getText());
          if (!voucherId) {
            const now = Date.now();
            if (now - unrecognizedAt.current < 2500) return;
            unrecognizedAt.current = now;
            setUnrecognized(true);
            if (hideTimer.current) window.clearTimeout(hideTimer.current);
            hideTimer.current = window.setTimeout(() => setUnrecognized(false), 2200);
            return;
          }
          cancelled = true;
          controls?.stop();
          stopStream(video);
          onDetectedRef.current(voucherId);
        });
        if (cancelled) {
          controls.stop();
          stopStream(video);
        }
      } catch (error) {
        if (!cancelled) setProblem(cameraProblem(error));
      }
    };

    void start();

    return () => {
      cancelled = true;
      controls?.stop();
      stopStream(video);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  const problemText =
    problem === "denied"
      ? t("merchant.cameraDenied")
      : problem === "missing"
        ? t("merchant.cameraMissing")
        : t("merchant.cameraFailed");

  return (
    <div className="relative min-h-0 flex-1 bg-black">
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        onPlaying={() => setLive(true)}
        className="absolute inset-0 h-full w-full object-cover"
      />

      {problem ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 px-6">
          <div className="w-full rounded-2xl bg-white px-4 py-5 text-center shadow-card">
            <p className="text-sm font-semibold leading-relaxed text-ink-700">{problemText}</p>
            <button
              type="button"
              onClick={onUseManual}
              className="sky-gradient mt-4 h-11 w-full cursor-pointer rounded-2xl text-sm font-bold text-white"
            >
              {t("merchant.useManual")}
            </button>
          </div>
        </div>
      ) : (
        <>
          {!live ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black">
              <p className="text-sm font-semibold text-white/80">{t("merchant.scanOpening")}</p>
            </div>
          ) : null}

          <div className="pointer-events-none absolute inset-x-8 top-[12%] bottom-[22%] z-10">
            <span className="absolute top-0 left-0 h-8 w-8 rounded-tl-2xl border-t-[3px] border-l-[3px] border-white" />
            <span className="absolute top-0 right-0 h-8 w-8 rounded-tr-2xl border-t-[3px] border-r-[3px] border-white" />
            <span className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-2xl border-b-[3px] border-l-[3px] border-white" />
            <span className="absolute right-0 bottom-0 h-8 w-8 rounded-br-2xl border-r-[3px] border-b-[3px] border-white" />
            <span className="animate-scan-beam absolute inset-x-3 h-[2px] rounded-full bg-brand-400 shadow-[0_0_16px_2px_rgba(76,154,255,0.85)]" />
          </div>

          <div className="absolute inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2 px-6">
            {unrecognized ? (
              <p className="rounded-full bg-coral-500 px-3 py-1 text-[11px] font-bold text-white">
                {t("merchant.qrUnrecognized")}
              </p>
            ) : null}
            <p className="rounded-full bg-black/55 px-4 py-1.5 text-center text-xs font-semibold text-white backdrop-blur-md">
              {t("merchant.scanHint")}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
