/**
 * 工作目录的独占登记。
 *
 * 会话之间并行是这个应用想要的；两个会话同时往一个目录里写不是。
 * 一个会话开跑前登记它的工作目录，别的会话要写同一棵目录树就先等着。
 * 只读运行（没开工具）不登记，也不被挡。
 */

const claims = new Map<string, string[]>();

/** Windows 不分大小写，斜杠两种写法都有，末尾分隔符可有可无。 */
export function normalizeRoot(root: string): string {
  const unified = root.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return unified.toLowerCase();
}

/** 同一棵树上就算重叠：父目录、子目录、同一个目录都算。 */
export function overlaps(a: string, b: string): boolean {
  const x = normalizeRoot(a);
  const y = normalizeRoot(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

/** 占着这些目录的其他会话。空数组表示可以开跑。 */
export function holdersOf(conversationId: string, roots: string[]): string[] {
  const held = new Set<string>();
  for (const [owner, ownedRoots] of claims) {
    if (owner === conversationId) continue;
    if (ownedRoots.some((owned) => roots.some((want) => overlaps(owned, want)))) held.add(owner);
  }
  return [...held];
}

export function claimRoots(conversationId: string, roots: string[]): void {
  if (roots.length) claims.set(conversationId, [...roots]);
  else claims.delete(conversationId);
}

export function releaseRoots(conversationId: string): void {
  claims.delete(conversationId);
}

export function claimedRoots(conversationId: string): string[] {
  return [...(claims.get(conversationId) ?? [])];
}

/** 测试用。 */
export function resetClaims(): void {
  claims.clear();
}
