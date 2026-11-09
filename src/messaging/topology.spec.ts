import { partitionOf } from './topology.js';

describe('partitionOf', () => {
  it('always maps a patient to the same partition', () => {
    expect(partitionOf('patient-1', 256)).toBe(partitionOf('patient-1', 256));
  });

  it('stays within range and spreads patients over the partitions', () => {
    const used = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const partition = partitionOf(`patient-${i}`, 64);
      expect(partition).toBeGreaterThanOrEqual(0);
      expect(partition).toBeLessThan(64);
      used.add(partition);
    }
    expect(used.size).toBe(64);
  });
});
