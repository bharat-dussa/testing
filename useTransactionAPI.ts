// hooks/useTransactionAPI.ts
import { useCallback } from 'react';
import RestClient from '../rest-client/RestClient';
import { validateResponse, createError, toServiceResponse, toServiceError } from '../utils/transactionUtils';
import { trackGenericError } from '../../rudderstack/services/genericErrorEvent';

export const useTransactionAPI = () => {
  const getTransactions = useCallback((upiCircleTransactions = false, filter = {}, pageSize = 20, offset = 0) => {
    const circleFilter = { upiCircle: 'Y' };
    const requestFilter = upiCircleTransactions ? { ...circleFilter } : { ...filter };
    
    return RestClient.silentPost(
      'transactionsList',
      {},
      { ...requestFilter, limit: pageSize, offset },
      {}
    );
  }, []);

  const getTransactionDetails = useCallback((transactionId: string) =>
    RestClient.get('transactionStatus', { transactionId }, {}, {}), []);

  const refreshTransactionDetailsBBPS = useCallback((transactionId: string) =>
    RestClient.get('transactionStatus', { transactionId }, {}, {}).then(validateResponse), []);

  const refreshTranactionDetails = useCallback((transactionId: string) =>
    Promise.resolve()
      .then(() => RestClient.get('transactionStatus', { transactionId }, {}, {}))
      .then(validateResponse), []);

  const refreshTranactionDetailsOnSilent = useCallback((transactionId: string) =>
    Promise.resolve()
      .then(() => RestClient.silentGet('transactionStatus', { transactionId }, {}, {}))
      .then(validateResponse), []);

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

  return {
    getTransactions,
    getTransactionDetails,
    refreshTransactionDetailsBBPS,
    refreshTranactionDetails,
    refreshTranactionDetailsOnSilent,
    getRequestConfig,
    getComplaintList,
  };
};