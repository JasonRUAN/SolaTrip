import deployment from "@/deployments/devnet.json";
import type { Address } from "./types";

export const CONTRACTS = {
  cluster: deployment.cluster,
  deployed: deployment.deployed,
  programId: deployment.programId as Address,
  usdcMint: deployment.usdcMint as Address,
  config: deployment.config as Address,
  orchestrator: deployment.orchestrator as Address,
  agents: deployment.agents,
  rpc: deployment.rpc,
  explorer: deployment.explorer,
} as const;

export const isDeployed = Boolean(
  CONTRACTS.deployed && CONTRACTS.programId && CONTRACTS.usdcMint && CONTRACTS.config,
);

export const isReviewDeployed = true;

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3010";

export function explorerTx(signature: string): string {
  return `${CONTRACTS.explorer}/tx/${signature}?cluster=devnet`;
}

export function explorerAddress(address: string): string {
  return `${CONTRACTS.explorer}/address/${address}?cluster=devnet`;
}
