/**
 * 只有連續兩輪擷取失敗或已確認週期缺口時才建議重載。
 * @param {{failureStreak?:number}|undefined} previous
 * @param {{success:boolean,trustedGap?:boolean}} sample
 */
export function advanceRecoveryDecision(previous, sample) {
  const failureStreak = sample.success ? 0 : Math.max(0, Number(previous?.failureStreak) || 0) + 1;
  return {
    failureStreak,
    shouldRecover: sample.trustedGap === true || failureStreak >= 2,
  };
}
