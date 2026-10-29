import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadMilestones, markGoalCelebrated, recordGoal } from '../levelMilestones';

const args = ['user-1', 'ko-profile', 'ko'];

describe('word goals', () => {
  beforeEach(() => AsyncStorage.clear());

  it('takes the first goal seen as the start, without celebrating', async () => {
    const { record } = await recordGoal(...args, 1500);
    expect(record).toMatchObject({ baseline: 1500, reached: [], celebrated: 1500 });
  });

  it('celebrates a goal passed later, once', async () => {
    await recordGoal(...args, 1500);
    const { record, newGoal } = await recordGoal(...args, 1750, '2026-10-29T10:00:00Z');
    expect(newGoal).toBe(1750);
    expect(record.reached).toEqual([{ words: 1750, at: '2026-10-29T10:00:00Z' }]);

    await markGoalCelebrated(...args, 1750);
    expect((await loadMilestones(...args)).celebrated).toBe(1750);
    expect((await recordGoal(...args, 1750)).newGoal).toBeNull();
  });

  it('does not count a goal again after the estimate dips and recovers', async () => {
    await recordGoal(...args, 1500);
    await recordGoal(...args, 1750);
    await recordGoal(...args, 1500);
    const { record } = await recordGoal(...args, 1750);
    expect(record.reached).toHaveLength(1);
  });
});
