import { GUEST_OWNER_ID, getLocalOwnerId, isAccountUser } from '../localDataScope';

describe('whose data this is', () => {
  it('keeps an anonymous session as the guest (local until sign-in)', () => {
    const anonymous = { id: 'anon-1', is_anonymous: true };
    expect(isAccountUser(anonymous)).toBe(false);
    expect(getLocalOwnerId(anonymous)).toBe(GUEST_OWNER_ID);
  });

  it('uses the account id for a signed-in account', () => {
    expect(isAccountUser({ id: 'user-1', is_anonymous: false })).toBe(true);
    expect(getLocalOwnerId({ id: 'user-1' })).toBe('user-1');
  });

  it('is the guest with no session', () => {
    expect(getLocalOwnerId(null)).toBe(GUEST_OWNER_ID);
  });
});
