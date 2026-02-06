export type Bias = "LONG" | "SHORT" | "NONE";
export type SetupSide = "LONG" | "SHORT";

export interface SetupSignal {
  side: SetupSide;
  score: number;
  reasons: string[];
}
