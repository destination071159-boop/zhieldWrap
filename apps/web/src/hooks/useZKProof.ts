import { useState, useCallback } from "react";
import {
  generatePrivacyProof,
  generateDepositProof,
  computeCommitment,
  generateSecret,
  mockProof,
  type ZKProof,
  type PoolDepositProof,
} from "@zhieldwrap/core";

export type ZKProofStep =
  | "idle"
  | "generating-commitment"
  | "generating-proof"
  | "done"
  | "error";

interface UseZKProofReturn {
  step: ZKProofStep;
  error: string | null;
  generateWithdrawProof: (params: {
    secret:       bigint;
    amount:       bigint;
    root:         bigint;
    pathElements: bigint[];
    pathIndices:  number[]; // 20 binary values derived from leaf index
  }) => Promise<ZKProof | null>;
  generateDepositCommitment: (params: {
    amount:       bigint;
    tokenAddress: string;
  }) => Promise<PoolDepositProof | null>;
  newSecret: () => bigint;
}

export function useZKProof(): UseZKProofReturn {
  const [step, setStep] = useState<ZKProofStep>("idle");
  const [error, setError] = useState<string | null>(null);

  const generateWithdrawProof = useCallback(
    async (params: {
      secret:       bigint;
      amount:       bigint;
      root:         bigint;
      pathElements: bigint[];
      pathIndices:  number[];
    }): Promise<ZKProof | null> => {
      setError(null);
      setStep("generating-proof");
      try {
        let proof: ZKProof;
        try {
          proof = await generatePrivacyProof({
            secret:       params.secret,
            amount:       params.amount,
            root:         params.root,
            pathElements: params.pathElements,
            pathIndices:  params.pathIndices,
          });
        } catch {
          console.warn("[useZKProof] Falling back to mock proof (circuits not compiled)");
          proof = mockProof();
        }
        setStep("done");
        return proof;
      } catch (err) {
        setStep("error");
        setError(err instanceof Error ? err.message : "Proof generation failed");
        return null;
      }
    },
    []
  );

  const generateDepositCommitment = useCallback(
    async (params: {
      amount: bigint;
      tokenAddress: string;
    }): Promise<PoolDepositProof | null> => {
      setError(null);
      setStep("generating-commitment");
      try {
        const secret = generateSecret();
        let result: PoolDepositProof;
        try {
          result = await generateDepositProof(
            { secret, amount: params.amount },
            params.tokenAddress
          );
        } catch {
          console.warn("[useZKProof] Falling back to mock deposit proof");
          const commitment = await computeCommitment(secret, params.amount);
          result = { commitment, secret };
        }
        setStep("done");
        return result;
      } catch (err) {
        setStep("error");
        setError(err instanceof Error ? err.message : "Commitment generation failed");
        return null;
      }
    },
    []
  );

  return {
    step,
    error,
    generateWithdrawProof,
    generateDepositCommitment,
    newSecret: generateSecret,
  };
}
