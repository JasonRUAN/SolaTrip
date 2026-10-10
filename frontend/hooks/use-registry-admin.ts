"use client";

import { useCallback } from "react";
import { useWallet } from "@/lib/use-wallet";
import type { CategoryCode } from "@/lib/types";

export function useRegistryAdmin() {
  const { isConnected } = useWallet();
  const register = useCallback(
    async (_input: {
      agent: string;
      name: string;
      categories: CategoryCode[];
      endpoint: string;
      description: string;
      website: string;
    }) => {
      throw new Error("服务商注册请使用 contract 部署脚本，在 devnet 上由管理员密钥完成");
    },
    [],
  );
  const setActive = useCallback(async (_agent: string, _active: boolean) => {
    throw new Error("请使用部署脚本更新服务商状态");
  }, []);
  return { isOwner: isConnected, isPending: false, register, setActive };
}
