from word_lookup import KrdictFetchGuard


def test_guard_allows_fetches_within_budget_and_stops_after_it():
    guard = KrdictFetchGuard(now=100.0, budget_seconds=12.0, max_consecutive_failures=5)
    assert guard.should_fetch(105.0)
    assert guard.remaining(105.0) == 7.0
    assert not guard.should_fetch(112.0)
    assert guard.remaining(200.0) == 0.0


def test_guard_trips_after_consecutive_failures_and_success_resets_the_count():
    guard = KrdictFetchGuard(now=0.0, budget_seconds=60.0, max_consecutive_failures=3)
    guard.record(ok=False)
    guard.record(ok=False)
    guard.record(ok=True)  # a success in between resets the run
    guard.record(ok=False)
    guard.record(ok=False)
    assert guard.should_fetch(1.0)
    guard.record(ok=False)
    assert guard.tripped
    assert not guard.should_fetch(1.0)


def test_guard_starts_tripped_during_a_cooldown():
    guard = KrdictFetchGuard(now=10.0, budget_seconds=12.0, max_consecutive_failures=5, cooldown_until=50.0)
    assert not guard.should_fetch(10.0)
    after = KrdictFetchGuard(now=60.0, budget_seconds=12.0, max_consecutive_failures=5, cooldown_until=50.0)
    assert after.should_fetch(60.0)
