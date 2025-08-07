import { useCallback } from 'react';
import { Subject } from 'rxjs';
import {
  isDefaultSyncNotExpired,
  shouldAllowRefresh,
  storeSyncDetails,
} from '../../app/transactions/utils/SyncTransactionDetailsUtils';

export const useTransactionSync = (
  subjectRef: React.MutableRefObject<Subject<any> | null>,
  refreshTranactionDetails: (id: string) => Promise<any>,
  forceUpdate: () => void
) => {
  const fetchTransactionDetails = useCallback((
    transactionId: string,
    isNeedToSync: boolean
  ) => {
    if (!subjectRef.current) {
      subjectRef.current = new Subject();
    }

    if (isNeedToSync) {
      shouldAllowRefresh(transactionId).then((isSyncAllowed) => {
        if (isSyncAllowed) {
          refreshTranactionDetails(transactionId).then((refreshedTransaction) => {
            const refreshedTransactionData = refreshedTransaction?.transaction;
            if (subjectRef.current) {
              subjectRef.current.next(refreshedTransactionData);
            }
            forceUpdate();
            if (!isDefaultSyncNotExpired(refreshedTransactionData.createdAt)) {
              storeSyncDetails(transactionId);
            }
          });
        }
      });
    }
    return subjectRef.current;
  }, [refreshTranactionDetails, forceUpdate]);

  return {
    fetchTransactionDetails,
  };
};