declare module "tulind" {
  type IndicatorCallback = (err: Error | null, result: number[][]) => void;
  type IndicatorFn = (
    inputs: number[][],
    options: number[],
    cb: IndicatorCallback
  ) => void;

  const tulind: {
    indicators: {
      atr: { indicator: IndicatorFn };
      vwap: { indicator: IndicatorFn };
    };
  };

  export default tulind;
}
