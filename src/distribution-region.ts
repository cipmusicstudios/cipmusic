export type DistributionRegion = 'global' | 'mainland_china';

const DISTRIBUTION_REGION = (import.meta.env.VITE_DISTRIBUTION_REGION ?? '').trim().toLowerCase();

export const distributionRegion: DistributionRegion =
  DISTRIBUTION_REGION === 'mainland_china' ? 'mainland_china' : 'global';

export const isMainlandChinaDistribution = distributionRegion === 'mainland_china';
