import AsyncStorage from '@react-native-async-storage/async-storage';
import { reassignLocalUserData } from '../localUserData';

// Only the AsyncStorage half of the move is under test here.
jest.mock('../Database', () => ({
  clearSqliteUserData: jest.fn(),
  hasSqliteUserData: jest.fn(async () => false),
  reassignSqliteUserData: jest.fn(async () => {}),
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///docs/' }));

const key = (owner, name) => `@ff/user-data/${owner}/${name}`;

describe('a guest signing in keeps their reading days', () => {
  beforeEach(() => AsyncStorage.clear());

  it('merges a day both have instead of dropping the guest\'s', async () => {
    // Today the guest reached the goal; the account only has a minute of it.
    await AsyncStorage.setItem(key('guest', 'reading-days'), JSON.stringify({
      '2026-10-28': { ms: 640000, metAt: '2026-10-28T20:00:00.000Z' },
      '2026-10-29': { ms: 700000, metAt: '2026-10-29T09:00:00.000Z' },
    }));
    await AsyncStorage.setItem(key('user-1', 'reading-days'), JSON.stringify({
      '2026-10-27': { ms: 660000, metAt: '2026-10-27T20:00:00.000Z' },
      '2026-10-29': { ms: 60000 },
    }));

    await reassignLocalUserData('guest', 'user-1');

    const days = JSON.parse(await AsyncStorage.getItem(key('user-1', 'reading-days')));
    expect(Object.keys(days).sort()).toEqual(['2026-10-27', '2026-10-28', '2026-10-29']);
    expect(days['2026-10-29']).toEqual({ ms: 700000, metAt: '2026-10-29T09:00:00.000Z' });
    expect(await AsyncStorage.getItem(key('guest', 'reading-days'))).toBeNull();
  });

  it('moves the word goals reached and the word-check date too', async () => {
    await AsyncStorage.setItem('levelMilestones:guest:ko_default:ko', '{"baseline":500,"reached":[],"celebrated":500}');
    await AsyncStorage.setItem('wordCheckAt:guest:ko_default:ko', '1790000000000');

    await reassignLocalUserData('guest', 'user-1');

    expect(await AsyncStorage.getItem('levelMilestones:user-1:ko_default:ko')).toContain('"baseline":500');
    expect(await AsyncStorage.getItem('wordCheckAt:user-1:ko_default:ko')).toBe('1790000000000');
    expect(await AsyncStorage.getItem('levelMilestones:guest:ko_default:ko')).toBeNull();
  });
});
