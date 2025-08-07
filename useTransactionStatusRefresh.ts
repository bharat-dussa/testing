import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getPreference, setPreference } from '../../appshell/UserPreferences';
import UserPreferenceKeys from '../../appshell/UserPreferenceKeys';
import { TxnStatusType } from '../constants';
import { Transaction } from '../types/TransactionTypes';
import * as SnackService from './SnackService';

export const useTransactionStatusRefresh = (
  refreshTranactionDetails: (id: string) => Promise<any>,
  forceUpdate: () => void
) => {
  const { t } = useTranslation();

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
        return await handleFirstTimeRefresh(refreshedTransaction, parsedReqChkTxnData);
      } catch {
        SnackService.error(t('SOMETHING_WRONG'));
      }
    } else {
      return await handleSubsequentRefresh(
        transaction,
        parsedReqChkTxnData,
        reqChkTxnParamsIndex,
        secondsSinceCreated
      );
    }
  }, [refreshTranactionDetails, formatTime12Hr, t, forceUpdate]);

  const handleFirstTimeRefresh = useCallback(async (
    refreshedTransaction: any,
    parsedReqChkTxnData: any[]
  ) => {
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

    handleTransactionStatusMessages(
      refreshedTransaction,
      isExhausted,
      role,
      name,
      remainingCount,
      pluralizedText,
      formattedTime,
      refreshDoneCount,
      currentCount,
      maxCount
    );

    forceUpdate();
    return refreshedTransaction?.transaction;
  }, [formatTime12Hr, forceUpdate, t]);

  const handleSubsequentRefresh = useCallback(async (
    transaction: Transaction,
    parsedReqChkTxnData: any[],
    reqChkTxnParamsIndex: number,
    secondsSinceCreated: number
  ) => {
    const { currentCount, maxCount, checkPoint2 } =
      parsedReqChkTxnData[reqChkTxnParamsIndex]?.reqChkTxnParams;
    const isExhausted = parsedReqChkTxnData[reqChkTxnParamsIndex]?.isReqChkTxnExhausted;
    const refreshedCreatedAt = new Date(
      parsedReqChkTxnData[reqChkTxnParamsIndex]?.refreshedCreatedAt
    );
    const futureDate = new Date(refreshedCreatedAt.getTime() + checkPoint2 * 1000);
    const formattedTime = formatTime12Hr(futureDate);

    if (!isExhausted && secondsSinceCreated >= checkPoint2) {
      return await handleAfterCheckpoint2Refresh(
        transaction,
        parsedReqChkTxnData,
        reqChkTxnParamsIndex
      );
    } else if (!isExhausted && currentCount < maxCount) {
      return await handleWithinCheckpoint2Refresh(
        transaction,
        parsedReqChkTxnData,
        reqChkTxnParamsIndex,
        formattedTime
      );
    } else if (isExhausted) {
      SnackService.error(t('PENDING_STATUS_LIMT_EXCEEDED_DEFAULT'));
    } else {
      SnackService.info(t('PENDING_STATUS_AFTER_SOME_TIME', { formattedTime }));
    }
  }, [refreshTranactionDetails, formatTime12Hr, forceUpdate, t]);

  const handleTransactionStatusMessages = useCallback((
    refreshedTransaction: any,
    isExhausted: boolean,
    role: string,
    name: string,
    remainingCount: string,
    pluralizedText: string,
    formattedTime: string,
    refreshDoneCount: string,
    currentCount: number,
    maxCount: number
  ) => {
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

    const isNonFinalStatus = 
      refreshedTransaction?.transaction?.status !== TxnStatusType.SUCCESS &&
      refreshedTransaction?.transaction?.status !== TxnStatusType.DECLINED &&
      refreshedTransaction?.transaction?.status !== TxnStatusType.EXPIRED;

    if (!isExhausted && isNonFinalStatus) {
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

    if (!isExhausted && maxCount === currentCount && isNonFinalStatus) {
      SnackService.error(
        t('PENDING_STATUS_ATTEMPTS_EXCEEDED', {
          interpolation: { escapeValue: false },
          formattedTime,
          refreshDoneCount,
        })
      );
    }
  }, [t]);

  const handleAfterCheckpoint2Refresh = useCallback(async (
    transaction: Transaction,
    parsedReqChkTxnData: any[],
    reqChkTxnParamsIndex: number
  ) => {
    try {
      const refreshedTransaction = await refreshTranactionDetails(transaction.id);
      const { currentCount, maxCount } = refreshedTransaction?.transaction?.reqChkTxnParams ?? {};
      const isExhausted = refreshedTransaction?.transaction?.txnInfo?.isReqChkTxnExhausted;
      const remainingCount = `${maxCount - currentCount}`;
      const refreshDoneCount = `${currentCount}/${maxCount}`;
      const pluralizedText = Number(remainingCount) > 1 ? 's' : '';

      parsedReqChkTxnData[reqChkTxnParamsIndex].reqChkTxnParams =
        refreshedTransaction?.transaction?.reqChkTxnParams;
      parsedReqChkTxnData[reqChkTxnParamsIndex].isReqChkTxnExhausted =
        refreshedTransaction?.transaction?.txnInfo?.isReqChkTxnExhausted;
      
      setPreference(UserPreferenceKeys.reqChkTxnParams, JSON.stringify(parsedReqChkTxnData));

      if (isExhausted && refreshedTransaction?.transaction?.status !== TxnStatusType.SUCCESS) {
        SnackService.error(t('PENDING_STATUS_LIMT_EXCEEDED_DEFAULT'));
      }

      const isNonFinalStatus = 
        refreshedTransaction?.transaction?.status !== TxnStatusType.SUCCESS &&
        refreshedTransaction?.transaction?.status !== TxnStatusType.DECLINED &&
        refreshedTransaction?.transaction?.status !== TxnStatusType.EXPIRED;

      if (!isExhausted && isNonFinalStatus) {
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
    }
  }, [refreshTranactionDetails, forceUpdate, t]);

  const handleWithinCheckpoint2Refresh = useCallback(async (
    transaction: Transaction,
    parsedReqChkTxnData: any[],
    reqChkTxnParamsIndex: number,
    formattedTime: string
  ) => {
    try {
      const refreshedTransaction = await refreshTranactionDetails(transaction.id);
      const { currentCount, maxCount } = refreshedTransaction?.transaction?.reqChkTxnParams ?? {};
      const refreshDoneCount = `${currentCount}/${maxCount}`;
      const remainingCount = `${maxCount - currentCount}`;
      const pluralizedText = Number(remainingCount) > 1 ? 's' : '';

      parsedReqChkTxnData[reqChkTxnParamsIndex].reqChkTxnParams =
        refreshedTransaction?.transaction?.reqChkTxnParams;
      parsedReqChkTxnData[reqChkTxnParamsIndex].isReqChkTxnExhausted =
        refreshedTransaction?.transaction?.txnInfo?.isReqChkTxnExhausted;
      
      setPreference(UserPreferenceKeys.reqChkTxnParams, JSON.stringify(parsedReqChkTxnData));

      const isNonFinalStatus = 
        refreshedTransaction?.transaction?.status !== TxnStatusType.SUCCESS &&
        refreshedTransaction?.transaction?.status !== TxnStatusType.DECLINED &&
        refreshedTransaction?.transaction?.status !== TxnStatusType.EXPIRED;

      if (maxCount === currentCount && isNonFinalStatus) {
        SnackService.error(
          t('PENDING_STATUS_ATTEMPTS_EXCEEDED', {
            interpolation: { escapeValue: false },
            formattedTime,
            refreshDoneCount,
          })
        );
      }

      if (maxCount !== currentCount && isNonFinalStatus) {
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
    }
  }, [refreshTranactionDetails, forceUpdate, t]);

  return {
    fetchTransactionStatusDetails,
  };
};