export function meanBy<T>(array: T[], selector: (item: T) => number): number {
  if (!array.length) {
    return 0;
  }
  const total = array.reduce((sum, item) => sum + selector(item), 0);
  return total / array.length;
}
