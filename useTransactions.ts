// hooks/useTransactions.ts - Complete Combined Hook
import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BehaviorSubject, Subject, merge, Subscription } from 'rxjs';
import { filter as rxJsFilter } from 'rxjs/operators';
import {
  propEq,
  anyPass,
  allPass,
  isEmpty,
  includes,
  prop,
  has,
  not,
  path,
  isNil,
  pipe,
} from 'rambda';

// Import all the necessary services and utilities
import RestClient from '../rest-client/RestClient';
import Maybe from '../wrappers/Maybe';
import { translate, translatableKeysAsObject } from './i18nService';
import { TxnStatusType, TransactionType } from '../constants';
import {
  createNetworkError,
  CustomError,
  ErrorTypes,
  wrapAsNetworkErrorInCaseNotCustomError,
  toServiceError,
  toServiceResponse,
} from './Error';
import { getPaymentObservable } from './PaymentService';
import PaymentAction from '../utils/PaymentActions';
import DirectPayService from './DirectPayService';
import { getApprovePaymentObservable } from './ApprovePaymentService';
import { getApprove2PayUsingVoucherObservable } from './ERupiService';
import { logError, logInfo } from './Analytics';
import { TRANSACTION_ANALYTICS_EVENTS } from '../../app/transactions/AnalyticsEvents';
import { MandateType } from '../../app/mandates/utils/MandateTypeDetailsUtil';
import { uniqueId } from '../utils/NPCIPayloadUtils';
import { TxnPurposeCode } from './SendMoneyService';
import {
  isDefaultSyncNotExpired,
  shouldAllowRefresh,
  storeSyncDetails,
} from '../../app/transactions/utils/SyncTransactionDetailsUtils';
import { trackGenericError } from '../../rudderstack/services/genericErrorEvent';
import * as SnackService from './SnackService';
import { getPreference, setPreference } from '../../appshell/UserPreferences';
import UserPreferenceKeys from '../../appshell/UserPreferenceKeys';

// Types
type Concern = {
  commentary: string;
  name: string;
};

export type Complaint = {
  id: string;
  procStatus: string;
  compDescription: string;
  reqAdjFlag: string;
  adjFlag: string;
  adjRemarks: string;
  adjAmt: string;
  adjCode: string;
  adjRefId: string;
};

export type TxnInfo = {
  isICDRequested: boolean;
  custRef: string;
  upiVersion: string;
  isERupiiTxn: boolean;
  eRupiiVoucherUmn: string;
  mc: string;
  isLiteTxn: null;
  isReqChkTxnExhausted?: boolean;
};

type VoucherInfo = {};

export type Voucher = {
  id: string;
  CustomerId: string;
  umn: string;
  uuid: string;
  payerAddr: string;
  payeeAddr: string;
  purpose: string;
  payerName: string;
  payeeName: string;
  mandateName: string;
  payerMcc: string;
  payeeMcc: string;
  type: string;
  valStart: string;
  valEnd: string;
  amount: string;
  acNum: string;
  ifsc: string;
  payeeBrandName: string;
  additionalInfo: string;
  revokeable: string;
  isRevoked: boolean;
  revokedAt: string;
  voucherInfo: VoucherInfo;
  bankName: string;
  createdAt: string;
  updatedAt: string;
};

export type Transaction = {
  prepaidRechargeResponse?: null | any;
  id: string;
  createdAt: string;
  updatedAt: string;
  status: TxnStatusType;
  amount: string;
  billStatus: TxnStatusType;
  bill: any;
  selfInitiated: boolean;
  expiry: string;
  payerInfo: {
    vpa: string;
    name: string;
    secondaryUserName?: string;
    bankIIN?: string;
    maskedAccountNumber?: string;
    bankName?: string;
    role?: string;
  };
  payeeInfo: {
    accountType?: string;
    mcc?: string;
    name: string;
  };
  type: string;
  Complaints?: Complaint;
  payerVpa: string;
  payeeVpa: string;
  txnInfo: TxnInfo;
  mode: string;
  upiRequestId: string;
  upiMsgId: null;
  npciResponse: { errCode: string; riskScores?: string };
  remarks: string;
  currency: string;
  upiResponseId: null;
  CustomerId: string;
  channel: string;
  txnInitiationType: string;
  txnCategory: null;
  BillId: null;
  isMerchantTxn: null;
  custRef: string;
  refurl: string;
  initiationMode: string;
  purpose: string;
  mandateId: null;
  voucher: Voucher;
  allowRaiseComplaint: boolean;
  errorDetails?: { userMessage: string };
  userMessage?: string;
};

export type PaginatedTransactions = {
  transactions: Transaction[];
  count: number;
  hasNext: boolean;
  fetchedTimestamp: Date;
  totalCbAmount: string;
  reqChkTxnCheckPoint1: number;
};

export const useTransactions = () => {
  const { t } = useTranslation();

  // State Management
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState({});
  const [dateMode, setDateMode] = useState({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorOccuredDuringLastUpdate, setErrorOccuredDuringLastUpdate] = useState(false);

  // Refs for observables and subscriptions
  const transactionsObservableRef = useRef<BehaviorSubject<Maybe<PaginatedTransactions>> | null>(null);
  const circleTransactionsObservableRef = useRef<BehaviorSubject<Maybe<PaginatedTransactions>> | null>(null);
  const paymentSubscriptionRef = useRef<Subscription | null>(null);
  const subjectRef = useRef<Subject<any> | null>(null);

  const pageSize = 20;
  const circleFilter = { upiCircle: 'Y' };

  // Utility functions
  const resetOffset = useCallback(() => setOffset(0), []);
  const incrementOffset = useCallback(() => setOffset(prev => prev + pageSize), []);
  const updateLastUpdated = useCallback(() => setLastUpdated(new Date()), []);
  const setErrorState = useCallback((hasError: boolean) => 
    setErrorOccuredDuringLastUpdate(hasError), []);

  // API Functions
  const validateResponse = useCallback((response: any) =>
    response.error ? Promise.reject(response) : response, []);

  const getTransactions = useCallback((upiCircleTransactions = false) => {
    const requestFilter = upiCircleTransactions ? { ...circleFilter } : { ...filter };
    return RestClient.silentPost(
      'transactionsList',
      {},
      { ...requestFilter, limit: pageSize, offset },
      {}
    );
  }, [filter, offset, pageSize]);

  const getTransactionDetails = useCallback((transactionId: string) =>
    RestClient.get('transactionStatus', { transactionId }, {}, {}), []);

  const refreshTransactionDetailsBBPS = useCallback((transactionId: string) =>
    RestClient.get('transactionStatus', { transactionId }, {}, {}).then(validateResponse), 
    [validateResponse]);

  const refreshTranactionDetails = useCallback((transactionId: string) =>
    Promise.resolve()
      .then(() => RestClient.get('transactionStatus', { transactionId }, {}, {}))
      .then(validateResponse), [validateResponse]);

  const refreshTranactionDetailsOnSilent = useCallback((transactionId: string) =>
    Promise.resolve()
      .then(() => RestClient.silentGet('transactionStatus', { transactionId }, {}, {}))
      .then(validateResponse), [validateResponse]);

  const getRequestConfig = useCallback((): Promise<any> =>
    RestClient.post('reqConfig', {}, {}, {})
      .then(toServiceResponse)
      .catch((err) => {
        trackGenericError(err as Error);
        throw err;
      }), []);

  const getComplaintList = useCallback(async () => {
    const response = await getRequestConfig();
    return response.reasonCodes;
  }, [getRequestConfig]);

  // Transaction Type Checking Functions
  const isMobilePrepaidRecharge = useCallback(
    (transaction: Transaction) => propEq('txnCategory', 'PREPAID')(transaction), []);

  const isMandateOrIPO = useCallback((transaction: Transaction) => allPass([
    propEq('txnInitiationType', 'UPI_MANDATE'),
    anyPass([
      propEq('purpose', MandateType.DEFAULT),
      propEq('purpose', MandateType.IPO),
      propEq('purpose', MandateType.STANDING_INSTRUCTION),
      propEq('purpose', MandateType.GIFT),
    ]),
  ])(transaction), []);

  const isERupiTransaction = useCallback((transaction: Transaction) => 
    (path('txnInfo.isERupiiTxn', transaction) && transaction?.txnInfo?.isERupiiTxn) || false, []);

  const isPrepaidVoucher = useCallback((transaction: Transaction) => allPass([
    propEq('txnInitiationType', 'UPI_MANDATE'),
    propEq('purpose', MandateType.PREPAID_VOUCHER),
  ])(transaction), []);

  const isBBPS = useCallback((transaction: Transaction) => has('bill')(transaction), []);

  const isPrepaidRecharge = useCallback((transaction: Transaction) => allPass([
    isBBPS,
    path('txnInfo.isPrepaidRecharge')
  ])(transaction), [isBBPS]);

  const isScanAndPay = useCallback((transaction: Transaction) => allPass([
    pipe(prop('txnInitiationType'), includes('QR')),
    propEq('selfInitiated', true),
    propEq('type', 'PAY'),
  ])(transaction), []);

  const isApproveToPay = useCallback((transaction: Transaction) => allPass([
    propEq('type', 'COLLECT'),
    propEq('selfInitiated', false),
    anyPass([
      propEq('status', TxnStatusType.SUCCESS),
      propEq('status', TxnStatusType.DECLINED),
      propEq('status', TxnStatusType.FAILURE),
      propEq('status', TxnStatusType.EXPIRED),
      propEq('status', TxnStatusType.PENDING),
      propEq('status', TxnStatusType.COLLECT_PAY_INITIATED),
      propEq('status', TxnStatusType.DEEMED),
      propEq('status', TxnStatusType.DECLINE_INITIATED),
    ]),
  ])(transaction), []);

  const isReceiveCard = useCallback((transaction: Transaction) => allPass([
    propEq('type', 'PAY'),
    propEq('selfInitiated', false),
  ])(transaction), []);

  const isRequestCard = useCallback((transaction: Transaction) => allPass([
    propEq('type', 'COLLECT'),
    propEq('selfInitiated', true),
    anyPass([
      propEq('status', TxnStatusType.SUCCESS),
      propEq('status', TxnStatusType.DECLINED),
      propEq('status', TxnStatusType.FAILURE),
      propEq('status', TxnStatusType.EXPIRED),
      propEq('status', TxnStatusType.PENDING),
    ]),
  ])(transaction), []);

  const isAtmWithdrawal = useCallback((transaction: Transaction) => allPass([
    pipe(prop('txnInitiationType'), includes('QR')),
    anyPass([
      propEq('purpose', TxnPurposeCode.METRO_ATM_QR),
      propEq('purpose', TxnPurposeCode.NON_METRO_ATM_QR),
    ]),
  ])(transaction), []);

  const isICDRequestGeneratedTransaction = useCallback((transaction: Transaction) => {
    return (
      transaction?.txnInfo?.isICDRequested === true &&
      transaction.status !== 'PENDING' &&
      (transaction?.purpose === TxnPurposeCode.SEND_TO_SELF ||
        transaction?.purpose === TxnPurposeCode.SEND_TO_OTHER)
    );
  }, []);

  const isICDCashDepositTransaction = useCallback((transaction: Transaction) => {
    return (
      transaction.status !== 'PENDING' &&
      transaction.selfInitiated === true &&
      transaction?.txnInfo?.isICDRequested === false &&
      (transaction?.purpose === TxnPurposeCode.SEND_TO_SELF ||
        transaction?.purpose === TxnPurposeCode.SEND_TO_OTHER)
    );
  }, []);

  const isICDCashDepositPendingTransaction = useCallback((transaction: Transaction) => {
    return (
      transaction.status === 'PENDING' &&
      (transaction.selfInitiated === true || transaction.selfInitiated === false) &&
      transaction?.txnInfo?.isICDRequested === false &&
      (transaction?.purpose === TxnPurposeCode.SEND_TO_SELF ||
        transaction?.purpose === TxnPurposeCode.SEND_TO_OTHER)
    );
  }, []);

  const isICDCashReceivedTransaction = useCallback((transaction: Transaction) => {
    return (
      transaction.selfInitiated === false &&
      transaction.status !== 'PENDING' &&
      (transaction?.purpose === TxnPurposeCode.SEND_TO_SELF ||
        transaction?.purpose === TxnPurposeCode.SEND_TO_OTHER)
    );
  }, []);

  const getTransactionType = useCallback((transaction: Transaction): TransactionType => {
    if (isMobilePrepaidRecharge(transaction)) return TransactionType.MOBILE_PREPAID;
    if (isPrepaidVoucher(transaction)) return TransactionType.PREPAID_VOUCHER;
    if (isMandateOrIPO(transaction)) return TransactionType.MANDATE;
    if (isApproveToPay(transaction)) return TransactionType.APPROVE_TO_PAY;
    if (isAtmWithdrawal(transaction)) return TransactionType.ATM_WITHDRAWAL;
    if (isERupiTransaction(transaction)) return TransactionType.ERUPI;
    if (isScanAndPay(transaction)) return TransactionType.SCAN_AND_PAY;
    if (isRequestCard(transaction)) return TransactionType.REQUEST;
    if (isPrepaidRecharge(transaction)) return TransactionType.PREPAID_RECHARGE;
    if (isBBPS(transaction)) return TransactionType.BILLPAY;
    if (isICDRequestGeneratedTransaction(transaction)) return TransactionType.ICD_REQUEST_GENERATION;
    if (isICDCashDepositTransaction(transaction)) return TransactionType.ICD_CASH_DEPOSIT;
    if (isICDCashReceivedTransaction(transaction)) return TransactionType.ICD_RECEIVED_TRANSACTION;
    if (isReceiveCard(transaction) && isNil(transaction.payerInfo?.role)) return TransactionType.RECEIVED;
    return TransactionType.SEND;
  }, [
    isMobilePrepaidRecharge, isPrepaidVoucher, isMandateOrIPO, isApproveToPay,
    isAtmWithdrawal, isERupiTransaction, isScanAndPay, isRequestCard,
    isPrepaidRecharge, isBBPS, isICDRequestGeneratedTransaction,
    isICDCashDepositTransaction, isICDCashReceivedTransaction, isReceiveCard
  ]);

  // Pagination and Error Handling
  const hasNextPage = useCallback((count: number) => offset + pageSize < count, [offset, pageSize]);

  const createError = useCallback((errorResponse: any) => {
    let errorMessage = '';
    errorMessage = errorResponse.errorCode && translatableKeysAsObject[errorResponse.errorCode]
      ? translate(translatableKeysAsObject[errorResponse.errorCode])
      : errorResponse.userMessage;
    if (isEmpty(errorMessage))
      return wrapAsNetworkErrorInCaseNotCustomError(errorResponse);
    return new CustomError(ErrorTypes.SERVICE_ERROR, errorMessage, errorResponse);
  }, []);

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
  }): PaginatedTransactions => ({
    transactions,
    count: txnsCount,
    hasNext: hasNextPage(txnsCount),
    fetchedTimestamp: lastUpdated!,
    totalCbAmount,
    reqChkTxnCheckPoint1,
  }), [hasNextPage, lastUpdated]);

  const onError = useCallback((err: any, isCircleTxns: boolean = false) => {
    logError(
      TRANSACTION_ANALYTICS_EVENTS.TRANSACTIONS_REFRESH,
      JSON.stringify({ success: false })
    );
    setErrorState(true);
    
    if (isCircleTxns && circleTransactionsObservableRef.current) {
      circleTransactionsObservableRef.current.next(Maybe.error(createError(err)));
    } else if (transactionsObservableRef.current) {
      transactionsObservableRef.current.next(Maybe.error(createError(err)));
    }
  }, [setErrorState, createError]);

  const onSuccess = useCallback((response: any, isCircleTxns: boolean = false) => {
    if (response.error) {
      onError(response, isCircleTxns);
    } else {
      logInfo(
        TRANSACTION_ANALYTICS_EVENTS.TRANSACTIONS_REFRESH,
        JSON.stringify({ success: true })
      );
      setErrorState(false);
      
      let finalResponse = response;
      let filteredTxns = finalResponse.transactions.filter(
        (icdPendingTxn: Transaction) => !isICDCashDepositPendingTransaction(icdPendingTxn)
      );
      finalResponse.transactions = filteredTxns;
      
      if (isCircleTxns && circleTransactionsObservableRef.current) {
        circleTransactionsObservableRef.current.next(
          Maybe.of<PaginatedTransactions>(paginate(finalResponse))
        );
      } else if (transactionsObservableRef.current) {
        transactionsObservableRef.current.next(
          Maybe.of<PaginatedTransactions>(paginate(finalResponse))
        );
      }
    }
  }, [onError, setErrorState, paginate, isICDCashDepositPendingTransaction]);

  // Observable Management
  const allObservables = merge(
    getPaymentObservable(),
    DirectPayService.getDirectPayObservable(),
    getApprovePaymentObservable(),
    getApprove2PayUsingVoucherObservable(),
  );

  const subscribePaymentActions = useCallback(() => {
    if (!paymentSubscriptionRef.current) {
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
    }
  }, [allObservables]);

  // Main Update Functions
  const forceUpdate = useCallback(() => {
    resetOffset();
    updateLastUpdated();
    
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
    
    if (!paymentSubscriptionRef.current) subscribePaymentActions();
    
    getTransactions()
      .then((res) => onSuccess(res))
      .catch((err) => onError(err));
  }, [resetOffset, updateLastUpdated, subscribePaymentActions, getTransactions, onSuccess, onError]);

  const forceCircleUpdate = useCallback(() => {
    resetOffset();
    updateLastUpdated();
    
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
    
    if (!paymentSubscriptionRef.current) subscribePaymentActions();
    
    getTransactions(true)
      .then((res) => onSuccess(res, true))
      .catch((err) => onError(err, true));
  }, [resetOffset, updateLastUpdated, subscribePaymentActions, getTransactions, onSuccess, onError]);

  // Cache Management
  const hasExpired = useCallback(() => {
    if (!lastUpdated) return true;
    const now = new Date();
    const elapsed = now.getTime() - lastUpdated.getTime();
    const duration = 30 * 60 * 1000; // 30 minutes
    return elapsed >= duration;
  }, [lastUpdated]);

  const shouldUpdate = useCallback(() =>
    !transactionsObservableRef.current || errorOccuredDuringLastUpdate || hasExpired(),
    [errorOccuredDuringLastUpdate, hasExpired]);

  const shouldUpdateCircleHistory = useCallback(() =>
    !circleTransactionsObservableRef.current || errorOccuredDuringLastUpdate || hasExpired(),
    [errorOccuredDuringLastUpdate, hasExpired]);

  // Filter Functions
  const applyFilter = useCallback((filterBy: any) => {
    setFilter(filterBy);
    forceUpdate();
  }, [forceUpdate]);

  const applyDateMode = useCallback((dateModeBy: any) => {
    setDateMode(dateModeBy);
    forceUpdate();
  }, [forceUpdate]);

  const clearFilter = useCallback(() => {
    setFilter({});
    forceUpdate();
  }, [forceUpdate]);

  const clearDateMode = useCallback(() => {
    setDateMode({});
    forceUpdate();
  }, [forceUpdate]);

  const clearFilterWithoutUpdate = useCallback(() => {
    setFilter({});
  }, []);

  const clearFilterWithUpdate = useCallback(() => {
    setFilter({});
    setDateMode({});
    forceUpdate();
  }, [forceUpdate]);

  const filterforupiId = useCallback((upiId: string) => {
    setFilter({ vpa: upiId });
    forceUpdate();
  }, [forceUpdate]);

  const upiLitefilter = useCallback((upilite: string) => {
    setFilter({ upiLite: upilite });
    forceUpdate();
  }, [forceUpdate]);

  const isFilterApplied = useCallback(() => not(isEmpty(filter)), [filter]);
  const isDateModeApplied = useCallback(() => not(isEmpty(dateMode)), [dateMode]);
  const getAppliedFilter = useCallback(() => ({ ...filter }), [filter]);
  const getAppliedDateMode = useCallback(() => ({ ...dateMode }), [dateMode]);

  // Public API Functions
  const fetchTransactionsList = useCallback(() => {
    if (shouldUpdate()) forceUpdate();
    return transactionsObservableRef.current;
  }, [shouldUpdate, forceUpdate]);

  const fetchCircleTransactionList = useCallback(() => {
    if (shouldUpdateCircleHistory()) forceCircleUpdate();
    return circleTransactionsObservableRef.current;
  }, [shouldUpdateCircleHistory, forceCircleUpdate]);

  const refreshTransactionDetails = useCallback(async (transaction: Transaction) => {
    const response = await getTransactionDetails(transaction.id);
    return response;
  }, [getTransactionDetails]);

  const fetchMore = useCallback(async () => {
    try {
      if (!errorOccuredDuringLastUpdate && transactionsObservableRef.current) {
        incrementOffset();
        const existingTransactions = 
          transactionsObservableRef.current.getValue().data.transactions || [];
        const response = await getTransactions();
        
        if (response.error) {
          transactionsObservableRef.current.next(Maybe.error(createError(response)));
        } else {
          let finalResponse = response;
          let filteredTxns = finalResponse.transactions.filter(
            (icdPendingTxn: Transaction) => !isICDCashDepositPendingTransaction(icdPendingTxn)
          );
          finalResponse.transactions = filteredTxns;
          
          const data = {
            hasNext: hasNextPage(finalResponse.txnsCount),
            transactions: [...existingTransactions, ...finalResponse.transactions],
            count: finalResponse.txnsCount,
            fetchedTimestamp: lastUpdated!,
            totalCbAmount: finalResponse?.totalCbAmount,
          } as PaginatedTransactions;

          transactionsObservableRef.current.next(Maybe.of<PaginatedTransactions>(data));
        }
      }
    } catch (err) {
      trackGenericError(err as Error);
      if (transactionsObservableRef.current) {
        transactionsObservableRef.current.next(Maybe.error(createError(err)));
      }
    }
  }, [
    errorOccuredDuringLastUpdate, incrementOffset, getTransactions, 
    createError, isICDCashDepositPendingTransaction, hasNextPage, lastUpdated
  ]);

  const fetchMoreCircleTxns = useCallback(async () => {
    try {
      if (!errorOccuredDuringLastUpdate && circleTransactionsObservableRef.current) {
        incrementOffset();
        const existingTransactions = 
          circleTransactionsObservableRef.current.getValue().data.transactions || [];
        const response = await getTransactions(true);
        
        if (response.error) {
          circleTransactionsObservableRef.current.next(Maybe.error(createError(response)));
        } else {
          let finalResponse = response;
          let filteredTxns = finalResponse.transactions.filter(
            (icdPendingTxn: Transaction) => !isICDCashDepositPendingTransaction(icdPendingTxn)
          );
          finalResponse.transactions = filteredTxns;
          
          const data = {
            hasNext: hasNextPage(finalResponse.txnsCount),
            transactions: [...existingTransactions, ...finalResponse.transactions],
            count: finalResponse.txnsCount,
            fetchedTimestamp: lastUpdated!,
          } as PaginatedTransactions;

          circleTransactionsObservableRef.current.next(Maybe.of<PaginatedTransactions>(data));
        }
      }
    } catch (err) {
      trackGenericError(err as Error);
      if (circleTransactionsObservableRef.current) {
        circleTransactionsObservableRef.current.next(Maybe.error(createError(err)));
      }
    }
  }, [
    errorOccuredDuringLastUpdate, incrementOffset, getTransactions, 
    createError, isICDCashDepositPendingTransaction, hasNextPage, lastUpdated
  ]);

  // Complaint Functions
  const raiseConcern = useCallback((transactionId: string, concern: Concern) => {
    const reqBody = { query: concern.commentary, disposition: concern.name };
    const reqParams = { transactionId };
    
    return RestClient.post('query', reqParams, reqBody, {})
      .then(validateResponse)
      .catch((err) => {
        if (err.userMessage) {
          return Promise.reject(new CustomError(ErrorTypes.NETWORK_ERROR, err.userMessage, err));
        }
        return Promise.reject(createNetworkError(err));
      });
  }, [validateResponse]);

  const getQueryApi = useCallback((transactionId: string) => {
    const reqParams = { transactionId };
    return RestClient.get('query', reqParams, {}, {})
      .then(validateResponse)
      .catch((err) => {
        if (err.userMessage) return err;
        return Promise.reject(createNetworkError(err));
      });
  }, [validateResponse]);

  const checkIfRaised = useCallback(async (transactionId: string) => {
    const response = await getQueryApi(transactionId);
    return !isEmpty(path(['query', 'id'], response));
  }, [getQueryApi]);

  const hasTransaction = has('transaction');
  const hasComplaints = has('complaints');

  const isValidTransactionObject = useCallback((response: any) => {
    if (hasTransaction(response)) return response;
    else return Promise.reject(response);
  }, []);

  const isValidTransactionComplaintObject = useCallback((response: any) => {
    if (
      hasTransaction(response) &&
      hasComplaints(response) &&
      !isEmpty(path(['complaints.crn'], response))
    ) {
      return response;
    } else {
      return Promise.reject(response);
    }
  }, []);

  const raiseComplaint = useCallback((reqBody: any) =>
    Promise.resolve()
      .then(() => RestClient.post('raiseComplaint', {}, reqBody, {}))
      .then(toServiceResponse)
      .then(isValidTransactionComplaintObject)
      .catch((err) => {
        trackGenericError(err as Error);
        logInfo(TRANSACTION_ANALYTICS_EVENTS.TRANSACTIONS_COMPLAINT_FAILURE);
        SnackService.error('Raise complaint Failed');
        throw new Error(err.message);
      }), [toServiceResponse, isValidTransactionComplaintObject]);

  const transactionRaiseComplaint = useCallback((transaction: Transaction, complaint: any) => {
    const reqId = uniqueId();
    const reqBody = {
      customerId: transaction.CustomerId,
      orgTxnId: transaction.upiRequestId,
      upiRequestId: reqId,
      compDescription: complaint.description,
      adjFlag: complaint.flag,
      adjCode: complaint.code,
      type: '',
      subType: '',
    };
    return raiseComplaint(reqBody);
  }, [raiseComplaint]);

  const fetchComplaintList = useCallback((): Promise<void> =>
    getComplaintList()
      .then(validateResponse)
      .catch((err) => {
        trackGenericError(err as Error);
        SnackService.error(err.message);
      }), [getComplaintList, validateResponse]);

  // Transaction Status Refresh with Complex Logic
  const formatTime12Hr = useCallback((date: Date) => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 === 0 ? 12 : hours % 12;
    const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes;
    return `${formattedHours}:${formattedMinutes} ${ampm}`;
  }, []);

  const fetchTransactionStatusDetails = useCallback(async (
    transaction: Transaction,
    reqChkTxnCheckPoint1: number
  ) => {
    const isExhausted = transaction?.txnInfo?.isReqChkTxnExhausted;
    const createdAt = new Date(transaction?.createdAt);
    const now = new Date();
    const secondsSinceCreated = (now.getTime() - createdAt.getTime()) / 1000;

    // Check if exhausted already
    if (isExhausted) {
      SnackService.info(t('PENDING_STATUS_LIMT_EXCEEDED_DEFAULT'));
      return;
    }

    // Block refresh if within first checkpoint
    if (
      transaction?.payerInfo?.role !== 'PRIMARY' &&
      transaction?.payerInfo?.role !== 'SECONDARY' &&
      secondsSinceCreated <= reqChkTxnCheckPoint1
    ) {
      SnackService.info(t('PENDING_STATUS_BLOCK', { reqChkTxnCheckPoint1 }));
      return;
    }

    const reqChkTxnData = await getPreference(UserPreferenceKeys.reqChkTxnParams, '[]');
    const parsedReqChkTxnData = JSON.parse(reqChkTxnData);
    const reqChkTxnParamsIndex = parsedReqChkTxnData.findIndex(
      (item: any) => item.transactionId === transaction.id
    );

    if (reqChkTxnParamsIndex === -1) {
      try {
        const refreshedTransaction = await refreshTranactionDetails(transaction.id);
        const { currentCount, maxCount, checkPoint2 } =
          refreshedTransaction?.transaction?.reqChkTxnParams ?? {};
        const isExhausted = refreshedTransaction?.transaction?.txnInfo?.isReqChkTxnExhausted;
        const refreshedCreatedAt = new Date(refreshedTransaction?.transaction?.createdAt);
        const futureDate = new Date(refreshedCreatedAt.getTime() + checkPoint2 * 1000);
        const formattedTime = formatTime12Hr(futureDate);
        const refreshDoneCount = `${currentCount}/${maxCount}`;
        const remainingCount = `${maxCount - currentCount}`;
        const pluralizedText = Number(remainingCount) > 1 ? 's' : '';
        const { role, name } = refreshedTransaction?.transaction?.payerInfo;

        const data = [
          {
            transactionId: refreshedTransaction.transaction?.id,
            reqChkTxnParams: refreshedTransaction?.transaction?.reqChkTxnParams,
            isReqChkTxnExhausted: refreshedTransaction?.transaction?.txnInfo?.isReqChkTxnExhausted,
            refreshedCreatedAt: refreshedTransaction?.transaction?.createdAt,
          },
          ...parsedReqChkTxnData,
        ];

        if (currentCount !== null && maxCount !== null) {
          setPreference(UserPreferenceKeys.reqChkTxnParams, JSON.stringify(data));
        }

        if (
          refreshedTransaction?.transaction?.status === TxnStatusType.DELEGATE_INITIATED &&
          currentCount === null &&
          maxCount === null
        ) {
          if (role === 'PRIMARY') {
            SnackService.error(t('PENDING_TXN_DELEGATE_INITIATED_PRIMARY'));
            return;
          }
          if (role === 'SECONDARY') {
            SnackService.error(
              t('PENDING_TXN_DELEGATE_INITIATED_SECONDARY', {
                interpolation: { escapeValue: false },
                name,
              })
            );
            return;
          }
        }

        if (
          isExhausted &&
          refreshedTransaction?.transaction?.status !== TxnStatusType.SUCCESS
        ) {
          SnackService.error(t('PENDING_STATUS_LIMT_EXCEEDED_DEFAULT'));
        }

        if (
          !isExhausted &&
          refreshedTransaction?.transaction?.status !== TxnStatusType.SUCCESS &&
          refreshedTransaction?.transaction?.status !== TxnStatusType.DECLINED &&
          refreshedTransaction?.transaction?.status !== TxnStatusType.EXPIRED
        ) {
          SnackService.info(
            t('PENDING_STATUS_WITHIN_TWO_HOURS', {
              interpolation: { escapeValue: false },
              remainingCount,
              pluralizedText,
              formattedTime,
              refreshDoneCount,
            })
          );
        }

        if (
          !isExhausted &&
          maxCount === currentCount &&
          refreshedTransaction?.transaction?.status !== TxnStatusType.SUCCESS &&
          refreshedTransaction?.transaction?.status !== TxnStatusType.DECLINED &&
          refreshedTransaction?.transaction?.status !== TxnStatusType.EXPIRED
        ) {
          SnackService.error(
            t('PENDING_STATUS_ATTEMPTS_EXCEEDED', {
              interpolation: { escapeValue: false },
              formattedTime,
              refreshDoneCount,
            })
          );
        }

        forceUpdate();
        return refreshedTransaction?.transaction;
      } catch {
        SnackService.error(t('SOMETHING_WRONG'));
      }
    } else {
      const { currentCount, maxCount, checkPoint2 } =
        parsedReqChkTxnData[reqChkTxnParamsIndex]?.reqChkTxnParams;
      const isExhausted = parsedReqChkTxnData[reqChkTxnParamsIndex]?.isReqChkTxnExhausted;
      const refreshedCreatedAt = new Date(
        parsedReqChkTxnData[reqChkTxnParamsIndex]?.refreshedCreatedAt
      );
      const futureDate = new Date(refreshedCreatedAt.getTime() + checkPoint2 * 1000);
      const formattedTime = formatTime12Hr(futureDate);

      if (!isExhausted && secondsSinceCreated >= checkPoint2) {
        try {
          const refreshedTransaction = await refreshTranactionDetails(transaction.id);
          const { currentCount, maxCount } =
            refreshedTransaction?.transaction?.reqChkTxnParams ?? {};
          const isExhausted = refreshedTransaction?.transaction?.txnInfo?.isReqChkTxnExhausted;
          const remainingCount = `${maxCount - currentCount}`;
          const refreshDoneCount = `${currentCount}/${maxCount}`;
          const pluralizedText = Number(remainingCount) > 1 ? 's' : '';

          parsedReqChkTxnData[reqChkTxnParamsIndex].reqChkTxnParams =
            refreshedTransaction?.transaction?.reqChkTxnParams;
          parsedReqChkTxnData[reqChkTxnParamsIndex].isReqChkTxnExhausted =
            refreshedTransaction?.transaction?.txnInfo?.isReqChkTxnExhausted;
          setPreference(UserPreferenceKeys.reqChkTxnParams, JSON.stringify(parsedReqChkTxnData));

          if (
            isExhausted &&
            refreshedTransaction?.transaction?.status !== TxnStatusType.SUCCESS
          ) {
            SnackService.error(t('PENDING_STATUS_LIMT_EXCEEDED_DEFAULT'));
          }

          if (
            !isExhausted &&
            refreshedTransaction?.transaction?.status !== TxnStatusType.SUCCESS &&
            refreshedTransaction?.transaction?.status !== TxnStatusType.DECLINED &&
            refreshedTransaction?.transaction?.status !== TxnStatusType.EXPIRED
          ) {
            SnackService.info(
              t('PENDING_STATUS_AFTER_TWO_HOURS_ATTEMPTS', {
                interpolation: { escapeValue: false },
                remainingCount,
                pluralizedText,
                refreshDoneCount,
              })
            );
          }

          forceUpdate();
          return refreshedTransaction?.transaction;
        } catch {
          SnackService.error(t('SOMETHING_WRONG'));
          return;
        }
      } else if (!isExhausted && currentCount < maxCount) {
        try {
          const refreshedTransaction = await refreshTranactionDetails(transaction.id);
          const { currentCount, maxCount } =
            refreshedTransaction?.transaction?.reqChkTxnParams ?? {};
          const refreshDoneCount = `${currentCount}/${maxCount}`;
          const remainingCount = `${maxCount - currentCount}`;
          const pluralizedText = Number(remainingCount) > 1 ? 's' : '';

          parsedReqChkTxnData[reqChkTxnParamsIndex].reqChkTxnParams =
            refreshedTransaction?.transaction?.reqChkTxnParams;
          parsedReqChkTxnData[reqChkTxnParamsIndex].isReqChkTxnExhausted =
            refreshedTransaction?.transaction?.txnInfo?.isReqChkTxnExhausted;
          setPreference(UserPreferenceKeys.reqChkTxnParams, JSON.stringify(parsedReqChkTxnData));

          if (
            maxCount === currentCount &&
            refreshedTransaction?.transaction?.status !== TxnStatusType.SUCCESS &&
            refreshedTransaction?.transaction?.status !== TxnStatusType.DECLINED &&
            refreshedTransaction?.transaction?.status !== TxnStatusType.EXPIRED
          ) {
            SnackService.error(
              t('PENDING_STATUS_ATTEMPTS_EXCEEDED', {
                interpolation: { escapeValue: false },
                formattedTime,
                refreshDoneCount,
              })
            );
          }

          if (
            maxCount !== currentCount &&
            refreshedTransaction?.transaction?.status !== TxnStatusType.SUCCESS &&
            refreshedTransaction?.transaction?.status !== TxnStatusType.DECLINED &&
            refreshedTransaction?.transaction?.status !== TxnStatusType.EXPIRED
          ) {
            SnackService.info(
              t('PENDING_STATUS_WITHIN_TWO_HOURS', {
                interpolation: { escapeValue: false },
                remainingCount,
                pluralizedText,
                formattedTime,
                refreshDoneCount,
              })
            );
          }

          forceUpdate();
          return refreshedTransaction?.transaction;
        } catch {
          SnackService.error(t('SOMETHING_WRONG'));
          return;
        }
      } else if (isExhausted) {
        SnackService.error(t('PENDING_STATUS_LIMT_EXCEEDED_DEFAULT'));
      } else {
        SnackService.info(t('PENDING_STATUS_AFTER_SOME_TIME', { formattedTime }));
      }
    }
  }, [t, refreshTranactionDetails, formatTime12Hr, forceUpdate]);

  // Transaction Sync Functions
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

  // Pending Bills Helper
  const handleSuccessResponse = useCallback((response: any) =>
    response.error ? Promise.reject(response) : paginate(response), [paginate]);

  const get = useCallback((status: TxnStatusType | string) => () =>
    RestClient.get('transactionsList', {}, {}, { limit: 20, offset: 0, status })
      .then(handleSuccessResponse)
      .catch(pipe(toServiceError, Promise.reject)), [handleSuccessResponse]);

  const pendingBills = get(TxnStatusType.PENDING);
  const getAllObservables = useCallback(() => allObservables, [allObservables]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (paymentSubscriptionRef.current) {
        paymentSubscriptionRef.current.unsubscribe();
      }
    };
  }, []);

  // Return all the functionality
  return {
    // Main transaction fetching
    fetchTransactionsList,
    fetchCircleTransactionList,
    fetchMore,
    fetchMoreCircleTxns,
    refetchTransactions: forceUpdate,
    refetchCircleTransactions: forceCircleUpdate,

    // Transaction details and refresh
    refreshTransactionDetails,
    refreshTranactionDetails,
    refreshTranactionDetailsOnSilent,
    refreshTransactionDetailsBBPS,
    fetchTransactionDetails,
    fetchTransactionStatusDetails,

    // Filters
    applyFilter,
    applyDateMode,
    clearFilter,
    clearDateMode,
    clearFilterWithoutUpdate,
    clearFilterWithUpdate,
    filterforupiId,
    upiLitefilter,
    isFilterApplied,
    isDateModeApplied,
    getAppliedFilter,
    getAppliedDateMode,

    // Transaction type checking
    getTransactionType,
    isMobilePrepaidRecharge,
    isMandateOrIPO,
    isERupiTransaction,
    isPrepaidVoucher,
    isBBPS,
    isPrepaidRecharge,
    isScanAndPay,
    isApproveToPay,
    isReceiveCard,
    isRequestCard,
    isAtmWithdrawal,
    isICDRequestGeneratedTransaction,
    isICDCashDepositTransaction,
    isICDCashDepositPendingTransaction,
    isICDCashReceivedTransaction,

    // Complaints
    raiseConcern,
    getQueryApi,
    checkIfRaised,
    raiseComplaint,
    transactionRaiseComplaint,
    getComplaintList,
    fetchComplaintList,

    // Observables
    getAllObservables,
    pendingBills,

    // Constants
    constantValues: { upiLite: 'Y' },

    // Types export for convenience
    Transaction,
    PaginatedTransactions,
    Concern,
    Complaint,
    TxnInfo,
    Voucher,
  };
};