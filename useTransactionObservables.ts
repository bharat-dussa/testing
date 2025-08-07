import { useCallback, useEffect } from 'react';
import { BehaviorSubject, Subject, merge, Subscription } from 'rxjs';
import { filter as rxJsFilter } from 'rxjs/operators';
import { includes } from 'rambda';
import Maybe from '../wrappers/Maybe';
import { getPaymentObservable } from './PaymentService';
import DirectPayService from './DirectPayService';
import { getApprovePaymentObservable } from './ApprovePaymentService';
import { getApprove2PayUsingVoucherObservable } from './ERupiService';
import PaymentAction from '../utils/PaymentActions';
import { PaginatedTransactions } from '../types/TransactionTypes';

export const useTransactionObservables = (
  transactionsObservableRef: React.MutableRefObject<BehaviorSubject<Maybe<PaginatedTransactions>> | null>,
  circleTransactionsObservableRef: React.MutableRefObject<BehaviorSubject<Maybe<PaginatedTransactions>> | null>,
  paymentSubscriptionRef: React.MutableRefObject<Subscription | null>,
  forceUpdate: () => void
) => {
  const allObservables = merge(
    getPaymentObservable(),
    DirectPayService.getDirectPayObservable(),
    getApprovePaymentObservable(),
    getApprove2PayUsingVoucherObservable(),
  );

  const subscribePaymentActions = useCallback(() => {
    if (paymentSubscriptionRef.current) {
      paymentSubscriptionRef.current.unsubscribe();
    }

    paymentSubscriptionRef.current = allObservables
      .pipe(
        rxJsFilter((action) =>
          includes(action, [
            PaymentAction.SENT,
            PaymentAction.APPROVED,
            PaymentAction.DECLINED,
            PaymentAction.FAILED,
            PaymentAction.DIRECT_PAY_FAILED,
            PaymentAction.DIRECT_PAY_SENT,
          ])
        )
      )
      .subscribe(forceUpdate);
  }, [allObservables, forceUpdate]);

  const initializeTransactionsObservable = useCallback(() => {
    if (!transactionsObservableRef.current) {
      transactionsObservableRef.current = new BehaviorSubject<Maybe<PaginatedTransactions>>(
        Maybe.unresolved()
      );
    }
  }, []);

  const initializeCircleTransactionsObservable = useCallback(() => {
    if (!circleTransactionsObservableRef.current) {
      circleTransactionsObservableRef.current = new BehaviorSubject<Maybe<PaginatedTransactions>>(
        Maybe.unresolved()
      );
    }
  }, []);

  const updateTransactionsObservable = useCallback((data: Maybe<PaginatedTransactions>) => {
    if (transactionsObservableRef.current) {
      transactionsObservableRef.current.next(data);
    }
  }, []);

  const updateCircleTransactionsObservable = useCallback((data: Maybe<PaginatedTransactions>) => {
    if (circleTransactionsObservableRef.current) {
      circleTransactionsObservableRef.current.next(data);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (paymentSubscriptionRef.current) {
        paymentSubscriptionRef.current.unsubscribe();
      }
    };
  }, []);

  return {
    allObservables,
    subscribePaymentActions,
    initializeTransactionsObservable,
    initializeCircleTransactionsObservable,
    updateTransactionsObservable,
    updateCircleTransactionsObservable,
  };
};