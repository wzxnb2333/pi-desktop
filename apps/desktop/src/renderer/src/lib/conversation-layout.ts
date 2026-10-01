/** Layout settles after React's fold update and its actual finite transitions, including reduced motion. */
export async function waitForConversationLayout(root: HTMLElement, target: HTMLElement, signal: AbortSignal): Promise<boolean> {
  await new Promise<void>(resolve => {
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish); });
    function finish() { cancelAnimationFrame(frame); signal.removeEventListener('abort', finish); resolve(); }
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
  const transitions: Promise<Animation>[] = [];
  for (let element: HTMLElement | null = target; element; element = element.parentElement) {
    transitions.push(...element.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
    if (element === root) break;
  }
  await new Promise<void>(resolve => {
    const finish = () => { signal.removeEventListener('abort', finish); resolve(); };
    signal.addEventListener('abort', finish, { once: true });
    void Promise.allSettled(transitions).then(finish);
    if (signal.aborted) finish();
  });
  return !signal.aborted && target.isConnected && root.contains(target) && !target.closest('[inert]');
}
