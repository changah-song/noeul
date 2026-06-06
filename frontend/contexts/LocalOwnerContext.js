import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  getLocalOwnerSnapshot,
  subscribeLocalOwner,
} from '../services/localOwnerCoordinator';

const LocalOwnerContext = createContext(getLocalOwnerSnapshot());

export const LocalOwnerProvider = ({ children }) => {
  const [snapshot, setSnapshot] = useState(getLocalOwnerSnapshot);

  useEffect(() => {
    setSnapshot(getLocalOwnerSnapshot());
    return subscribeLocalOwner(setSnapshot);
  }, []);

  const value = useMemo(() => ({
    activeOwnerId: snapshot.activeOwnerId,
    ownershipBlocked: snapshot.ownershipBlocked,
    pendingOwnershipDecision: snapshot.pendingOwnershipDecision,
    lastAuthEvent: snapshot.lastAuthEvent,
    syncPaused: snapshot.syncPaused,
    syncGeneration: snapshot.syncGeneration,
  }), [
    snapshot.activeOwnerId,
    snapshot.lastAuthEvent,
    snapshot.ownershipBlocked,
    snapshot.pendingOwnershipDecision,
    snapshot.syncGeneration,
    snapshot.syncPaused,
  ]);

  return (
    <LocalOwnerContext.Provider value={value}>
      {children}
    </LocalOwnerContext.Provider>
  );
};

export const useLocalOwner = () => useContext(LocalOwnerContext);
