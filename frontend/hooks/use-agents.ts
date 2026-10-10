"use client";

import { useCallback, useEffect, useState } from "react";
import { BACKEND_URL } from "@/lib/contracts";
import { activeLocale, getDict } from "@/lib/i18n";
import type { AgentProfile, CategoryCode, OnchainReview } from "@/lib/types";

export function useAgents() {
  // 语言读模块级镜像：refresh 不该因为切语言就重新拉一次链
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${BACKEND_URL}/api/agents`);
      if (response.ok) {
        const payload = (await response.json()) as { agents?: AgentProfile[] };
        setAgents(payload.agents ?? []);
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch {
      setAgents([]);
      setError(getDict(activeLocale()).errors.agentListFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { agents, loading, error, refresh };
}

export function useAgentReviews(address?: string) {
  const [reviews, setReviews] = useState<OnchainReview[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setReviews([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`${BACKEND_URL}/api/agents/${address}/reviews`)
      .then((response) => (response.ok ? response.json() : { reviews: [] }))
      .then((payload: { reviews?: OnchainReview[] }) => {
        if (!cancelled) setReviews(payload.reviews ?? []);
      })
      .catch(() => {
        if (!cancelled) setReviews([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return { reviews, loading };
}
