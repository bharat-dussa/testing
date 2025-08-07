import { useCallback } from 'react';
import { isEmpty } from 'rambda';
import { useTransactionsState } from './useTransactionsState';
import { useTransactionFilters } from './useTransactionFilters';
import { useTransactionAPI } from './useTransactionAPI';
import { useTransactionComplaints } from './useTransactionComplaints';
import { useTransactionStatusRefresh } from './useTransactionStatusRefresh';
import { useTransactionTypes } from './useTransactionTypes';
import { useTransactionObservables } from './useTransactionObservables';
import { useTransactionSync } from './useTransactionSync';
import { useTransactionPagination } from './useTransactionPagination';
import Maybe from '../wrappers/Maybe';
import { PaginatedTransactions } from '../types/TransactionTypes';

export const useTransactionsManager = () => {
  const state = useTransactionsState();
  const {
    offset,
    filter,
    dateMode,
    lastUpdated,
    errorOccuredDuringLastUpdate,
    transactionsObservableRef,
    circleTransactionsObservableRef,
    paymentSubscriptionRef,
    subjectRef,
    setFilter,
    setDateMode,
    resetOffset,
    incrementOffset,
    updateLastUpdated,
    setErrorState,
  } = state;

  const api = useTransactionAPI();
  const { getTransactions, refreshTranactionDetails } = api;
  
  const complaints = useTransactionComplaints();
  const types = useTransactionTypes();
  const { isICDCashDepositPendingTransaction } = types;
  const pagination = useTransactionPagination();
  const { pageSize, onSuccess, onError } = pagination;

  // Main update functions
  const forceUpdate = useCallback(() => {
    resetOffset();
    updateLastUpdated();
    setErrorState(false);
    
    if (!transactionsObservableRef.current) {
      transactionsObservableRef.current = new BehaviorSubject<Maybe<PaginatedTransactions>>(
        Maybe.unresolved()
      );
    } else {
      const shimmerData = {
        hasNext: false,
        transactions: [],
        count: 1,
        fetchedTimestamp: new Date(),
        showShimmer: true,
        totalCbAmount: '0',
        reqChkTxnCheckPoint1: 0,
      } as PaginatedTransactions;
      transactionsObservableRef.current.next(Maybe.of<PaginatedTransactions>(shimmerData));
    }

    getTransactions(false, filter, pageSize, 0)
      .then((res) => onSuccess(
        res, 
        false, 
        (data) => transactionsObservableRef.current?.next(data),
        (txn) => !isICDCashDepositPendingTransaction(txn),
        0,
        lastUpdated!
      ))
      .catch((err) => onError(err, (data) => transactionsObservableRef.current?.next(data)));
  }, [
    resetOffset,
    updateLastUpdated,
    setErrorState,
    getTransactions,
    filter,
    pageSize,
    onSuccess,
    onError,
    isICDCashDepositPendingTransaction,
    lastUpdated
  ]);

  const forceCircleUpdate = useCallback(() => {
    resetOffset();
    updateLastUpdated();
    setErrorState(false);
    
    if (!circleTransactionsObservableRef.current) {
      circleTransactionsObservableRef.current = new BehaviorSubject<Maybe<PaginatedTransactions>>(
        Maybe.unresolved()
      );
    } else {
      const shimmerData = {
        hasNext: false,
        transactions: [],
        count: 0,
        fetchedTimestamp: new Date(),
        showShimmer: true,
        totalCbAmount: '0',
      } as PaginatedTransactions;
      circleTransactionsObservableRef.current.next(Maybe.of<PaginatedTransactions>(shimmerData));
    }

    getTransactions(true, {}, pageSize, 0)
      .then((res) => onSuccess(
        res,
        true,
        (data) => circleTransactionsObservableRef.current?.next(data),
        (txn) => !isICDCashDepositPendingTransaction(txn),
        0,
        lastUpdated!
      ))
      .catch((err) => onError(err, (data) => circleTransactionsObservableRef.current?.next(data)));
  }, [
    resetOffset,
    updateLastUpdated,
    setErrorState,
    getTransactions,
    pageSize,
    onSuccess,
    onError,
    isICDCashDepositPendingTransaction,
    lastUpdated
  ]);

  // Cache expiry check
  const hasExpired = useCallback(() => {
    if (!lastUpdated) return true;
    const now = new Date();
    const elapsed = now.getTime() - lastUpdated.getTime();
    const duration = 30 * 60 * 1000; // 30 minutes
    return elapsed >= duration;
  }, [lastUpdated]);

  const shouldUpdate = useCallback(() =>
    !transactionsObservableRef.current || errorOccuredDuringLastUpdate || hasExpired(),
    [errorOccuredDuringLastUpdate, hasExpired]
  );

  const shouldUpdateCircleHistory = useCallback(() =>
    !circleTransactionsObservableRef.current || errorOccuredDuringLastUpdate || hasExpired(),
    [errorOccuredDuringLastUpdate, hasExpired]
  );

  // Public API functions
  const fetchTransactionsList = useCallback(() => {
    if (shouldUpdate()) forceUpdate();
    return transactionsObservableRef.current;
  }, [shouldUpdate, forceUpdate]);

  const fetchCircleTransactionList = useCallback(() => {
    if (shouldUpdateCircleHistory()) forceCircleUpdate();
    return circleTransactionsObservableRef.current;
  }, [shouldUpdateCircleHistory, forceCircleUpdate]);

  const fetchMore = useCallback(async () => {
    try {
      if (!errorOccuredDuringLastUpdate && transactionsObservableRef.current) {
        incrementOffset(pageSize);
        const newOffset = offset + pageSize;
        const existingTransactions = 
          transactionsObservableRef.current.getValue().data.transactions || [];
        
        const response = await getTransactions(false, filter, pageSize, newOffset);
        
        if (response.error) {
          transactionsObservableRef.current.next(Maybe.error(new Error(response.userMessage)));
        } else {
          const filteredTxns = response.transactions.filter(
            (txn) => !isICDCashDepositPendingTransaction(txn)
          );
          
          const data = {
            hasNext: pagination.hasNextPage(response.txnsCount, newOffset),
            transactions: [...existingTransactions, ...filteredTxns],
            count: response.txnsCount,
            fetchedTimestamp: lastUpdated!,
            totalCbAmount: response?.totalCbAmount,
          } as PaginatedTransactions;

          transactionsObservableRef.current.next(Maybe.of<PaginatedTransactions>(data));
        }
      }
    } catch (err) {
      if (transactionsObservableRef.current) {
        transactionsObservableRef.current.next(Maybe.error(new Error('Failed to fetch more transactions')));
      }
    }
  }, [
    errorOccuredDuringLastUpdate,
    incrementOffset,
    pageSize,
    offset,
    getTransactions,
    filter,
    isICDCashDepositPendingTransaction,
    pagination,
    lastUpdated
  ]);

  const fetchMoreCircleTxns = useCallback(async () => {
    try {
      if (!errorOccuredDuringLastUpdate && circleTransactionsObservableRef.current) {
        incrementOffset(pageSize);
        const newOffset = offset + pageSize;
        const existingTransactions = 
          circleTransactionsObservableRef.current.getValue().data.transactions || [];
        
        const response = await getTransactions(true, {}, pageSize, newOffset);
        
        if (response.error) {
          circleTransactionsObservableRef.current.next(Maybe.error(new Error(response.userMessage)));
        } else {
          const filteredTxns = response.transactions.filter(
            (txn) => !isICDCashDepositPendingTransaction(txn)
          );
          
          const data = {
            hasNext: pagination.hasNextPage(response.txnsCount, newOffset),
            transactions: [...existingTransactions, ...filteredTxns],
            count: response.txnsCount,
            fetchedTimestamp: lastUpdated!,
          } as PaginatedTransactions;

          circleTransactionsObservableRef.current.next(Maybe.of<PaginatedTransactions>(data));
        }
      }
    } catch (err) {
      if (circleTransactionsObservableRef.current) {
        circleTransactionsObservableRef.current.next(Maybe.error(new Error('Failed to fetch more circle transactions')));
      }
    }
  }, [
    errorOccuredDuringLastUpdate,
    incrementOffset,
    pageSize,
    offset,
    getTransactions,
    isICDCashDepositPendingTransaction,
    pagination,
    lastUpdated
  ]);

  // Initialize filter functions
  const filters = useTransactionFilters(filter, dateMode, setFilter, setDateMode, forceUpdate);
  
  // Initialize observables management
  const observables = useTransactionObservables(
    transactionsObservableRef,
    circleTransactionsObservableRef,
    paymentSubscriptionRef,
    forceUpdate
  );

  // Initialize sync functionality
  const sync = useTransactionSync(subjectRef, refreshTranactionDetails, forceUpdate);

  // Initialize status refresh functionality
  const statusRefresh = useTransactionStatusRefresh(refreshTranactionDetails, forceUpdate);

  return {
    // Main functions
    fetchTransactionsList,
    fetchCircleTransactionList,
    fetchMore,
    fetchMoreCircleTxns,
    refetchTransactions: forceUpdate,
    refetchCircleTransactions: forceCircleUpdate,
    
    // Filter functions
    ...filters,
    
    // API functions
    ...api,
    
    // Complaint functions
    ...complaints,
    
    // Type checking functions
    ...types,
    
    // Status refresh
    ...statusRefresh,
    
    // Sync functions
    ...sync,
    
    // Observable management
    ...observables,
    
    // Constants
    constantValues: { upiLite: 'Y' },
  };
};