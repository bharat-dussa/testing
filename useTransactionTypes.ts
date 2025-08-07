import { useCallback } from 'react';
import {
  propEq,
  anyPass,
  allPass,
  includes,
  prop,
  has,
  path,
  isNil,
  pipe,
} from 'rambda';
import { TransactionType, TxnStatusType } from '../constants';
import { MandateType } from '../../app/mandates/utils/MandateTypeDetailsUtil';
import { TxnPurposeCode } from './SendMoneyService';
import { Transaction } from '../types/TransactionTypes';

export const useTransactionTypes = () => {
  const isMobilePrepaidRecharge = useCallback(
    (transaction: Transaction) => propEq('txnCategory', 'PREPAID')(transaction),
    []
  );

  const isMandateOrIPO = useCallback(
    (transaction: Transaction) => allPass([
      propEq('txnInitiationType', 'UPI_MANDATE'),
      anyPass([
        propEq('purpose', MandateType.DEFAULT),
        propEq('purpose', MandateType.IPO),
        propEq('purpose', MandateType.STANDING_INSTRUCTION),
        propEq('purpose', MandateType.GIFT),
      ]),
    ])(transaction),
    []
  );

  const isERupiTransaction = useCallback(
    (transaction: Transaction) => 
      (path('txnInfo.isERupiiTxn', transaction) && transaction?.txnInfo?.isERupiiTxn) || false,
    []
  );

  const isPrepaidVoucher = useCallback(
    (transaction: Transaction) => allPass([
      propEq('txnInitiationType', 'UPI_MANDATE'),
      propEq('purpose', MandateType.PREPAID_VOUCHER),
    ])(transaction),
    []
  );

  const isBBPS = useCallback(
    (transaction: Transaction) => has('bill')(transaction),
    []
  );

  const isPrepaidRecharge = useCallback(
    (transaction: Transaction) => allPass([
      isBBPS,
      path('txnInfo.isPrepaidRecharge')
    ])(transaction),
    [isBBPS]
  );

  const isScanAndPay = useCallback(
    (transaction: Transaction) => allPass([
      pipe(prop('txnInitiationType'), includes('QR')),
      propEq('selfInitiated', true),
      propEq('type', 'PAY'),
    ])(transaction),
    []
  );

  const isApproveToPay = useCallback(
    (transaction: Transaction) => allPass([
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
    ])(transaction),
    []
  );

  const isReceiveCard = useCallback(
    (transaction: Transaction) => allPass([
      propEq('type', 'PAY'),
      propEq('selfInitiated', false),
    ])(transaction),
    []
  );

  const isRequestCard = useCallback(
    (transaction: Transaction) => allPass([
      propEq('type', 'COLLECT'),
      propEq('selfInitiated', true),
      anyPass([
        propEq('status', TxnStatusType.SUCCESS),
        propEq('status', TxnStatusType.DECLINED),
        propEq('status', TxnStatusType.FAILURE),
        propEq('status', TxnStatusType.EXPIRED),
        propEq('status', TxnStatusType.PENDING),
      ]),
    ])(transaction),
    []
  );

  const isAtmWithdrawal = useCallback(
    (transaction: Transaction) => allPass([
      pipe(prop('txnInitiationType'), includes('QR')),
      anyPass([
        propEq('purpose', TxnPurposeCode.METRO_ATM_QR),
        propEq('purpose', TxnPurposeCode.NON_METRO_ATM_QR),
      ]),
    ])(transaction),
    []
  );

  const isICDRequestGeneratedTransaction = useCallback(
    (transaction: Transaction) => {
      return (
        transaction?.txnInfo?.isICDRequested === true &&
        transaction.status !== 'PENDING' &&
        (transaction?.purpose === TxnPurposeCode.SEND_TO_SELF ||
          transaction?.purpose === TxnPurposeCode.SEND_TO_OTHER)
      );
    },
    []
  );

  const isICDCashDepositTransaction = useCallback(
    (transaction: Transaction) => {
      return (
        transaction.status !== 'PENDING' &&
        transaction.selfInitiated === true &&
        transaction?.txnInfo?.isICDRequested === false &&
        (transaction?.purpose === TxnPurposeCode.SEND_TO_SELF ||
          transaction?.purpose === TxnPurposeCode.SEND_TO_OTHER)
      );
    },
    []
  );

  const isICDCashDepositPendingTransaction = useCallback(
    (transaction: Transaction) => {
      return (
        transaction.status === 'PENDING' &&
        (transaction.selfInitiated === true || transaction.selfInitiated === false) &&
        transaction?.txnInfo?.isICDRequested === false &&
        (transaction?.purpose === TxnPurposeCode.SEND_TO_SELF ||
          transaction?.purpose === TxnPurposeCode.SEND_TO_OTHER)
      );
    },
    []
  );

  const isICDCashReceivedTransaction = useCallback(
    (transaction: Transaction) => {
      return (
        transaction.selfInitiated === false &&
        transaction.status !== 'PENDING' &&
        (transaction?.purpose === TxnPurposeCode.SEND_TO_SELF ||
          transaction?.purpose === TxnPurposeCode.SEND_TO_OTHER)
      );
    },
    []
  );

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
    isMobilePrepaidRecharge,
    isPrepaidVoucher,
    isMandateOrIPO,
    isApproveToPay,
    isAtmWithdrawal,
    isERupiTransaction,
    isScanAndPay,
    isRequestCard,
    isPrepaidRecharge,
    isBBPS,
    isICDRequestGeneratedTransaction,
    isICDCashDepositTransaction,
    isICDCashReceivedTransaction,
    isReceiveCard,
  ]);

  return {
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
    getTransactionType,
  };
};