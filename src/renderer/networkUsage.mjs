export const normalizeLimiterPath = (path) => (
  String(path || '').trim().replace(/\//g, '\\').toLowerCase()
);

export const hasActiveBandwidthLimit = (paths, rulesByPath) => (
  (paths || []).some((path) => {
    const rule = rulesByPath.get(normalizeLimiterPath(path));
    return Boolean(
      rule
      && rule.enabled !== false
      && (rule.blocked || rule.downloadLimitBps || rule.uploadLimitBps)
    );
  })
);

export const compareNetworkProcesses = (sort, left, right) => {
  const nameOrder = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  if (sort === 'connections-asc') {
    return Number(left.connections || 0) - Number(right.connections || 0) || nameOrder;
  }
  if (sort === 'limited-first') {
    return Number(right.hasBandwidthLimit) - Number(left.hasBandwidthLimit)
      || Number(right.connections || 0) - Number(left.connections || 0)
      || nameOrder;
  }
  if (sort === 'name-asc') return nameOrder;
  if (sort === 'name-desc') return -nameOrder;
  return Number(right.connections || 0) - Number(left.connections || 0) || nameOrder;
};
