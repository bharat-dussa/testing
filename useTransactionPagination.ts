import { useCallback } from 'react';
import { logError, logInfo } from './Analytics';
import { TRANSACTION_ANALYTICS_EVENTS } from '../../app/transactions/AnalyticsEvents';
import { trackGenericError } from '../../rudderstack/services/genericErrorEvent';
import Maybe from '../wrappers/Maybe';
import { PaginatedTransactions, Transaction } from '../types/TransactionTypes';

export const useTransactionPagination = () => {
  const pageSize = 20;

  const hasNextPage = useCallback((count: number, offset: number) => 
    offset + pageSize < count, []);

  const paginate = useCallback(({
    txnsCount,
    transactions,
    totalCbAmount,
    reqChkTxnCheckPoint1,
  }: {
    txnsCount: number;
    transactions: Transaction[];
    totalCbAmount: string;
    reqChkTxnCheckPoint1: number;
  }, offset: number, lastUpdated: Date): PaginatedTransactions => ({
    transactions,
    count: txnsCount,
    hasNext: hasNextPage(txnsCount, offset),
    fetchedTimestamp: lastUpdated,
    totalCbAmount,
    reqChkTxnCheckPoint1,
  }), [hasNextPage]);

  const createError = useCallback((errorResponse: any) => {
    let errorMessage = '';
    errorMessage = errorResponse.userMessage || 'An error occurred';
    return new Error(errorMessage);
  }, []);

  const onSuccess = useCallback((
    response: any,
    isCircleTxns: boolean,
    updateObservable: (data: Maybe<PaginatedTransactions>) => void,
    filterICDPendingTransactions: (transaction: Transaction) => boolean,
    offset: number,
    lastUpdated: Date
  ) => {
    if (response.error) {
      logError(
        TRANSACTION_ANALYTICS_EVENTS.TRANSACTIONS_REFRESH,
        JSON.stringify({ success: false })
      );
      updateObservable(Maybe.error(createError(response)));
    } else {
      logInfo(
        TRANSACTION_ANALYTICS_EVENTS.TRANSACTIONS_REFRESH,
        JSON.stringify({ success: true })
      );
      
      const filteredTxns = response.transactions.filter(filterICDPendingTransactions);
      const finalResponse = { ...response, transactions: filteredTxns };
      
      updateObservable(
        Maybe.of<PaginatedTransactions>(paginate(finalResponse, offset, lastUpdated))
      );
    }
  }, [paginate, createError]);

  const onError = useCallback((
    err: any,
    updateObservable: (data: Maybe<PaginatedTransactions>) => void
  ) => {
    logError(
      TRANSACTION_ANALYTICS_EVENTS.TRANSACTIONS_REFRESH,
      JSON.stringify({ success: false })
    );
    trackGenericError(err as Error);
    updateObservable(Maybe.error(createError(err)));
  }, [createError]);

  return {
    pageSize,
    hasNextPage,
    paginate,
    createError,
    onSuccess,
    onError,
  };
};