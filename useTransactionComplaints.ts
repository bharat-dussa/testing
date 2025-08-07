// hooks/useTransactionComplaints.ts
import { useCallback } from 'react';
import { isEmpty, has, path } from 'rambda';
import RestClient from '../rest-client/RestClient';
import { validateResponse, toServiceResponse } from '../utils/transactionUtils';
import { uniqueId } from '../utils/NPCIPayloadUtils';
import { trackGenericError } from '../../rudderstack/services/genericErrorEvent';
import { logInfo } from './Analytics';
import { TRANSACTION_ANALYTICS_EVENTS } from '../../app/transactions/AnalyticsEvents';
import * as SnackService from './SnackService';
import { Transaction } from '../types/TransactionTypes';

type Concern = {
  commentary: string;
  name: string;
};

export const useTransactionComplaints = () => {
  const raiseConcern = useCallback((transactionId: string, concern: Concern) => {
    const reqBody = {
      query: concern.commentary,
      disposition: concern.name,
    };
    const reqParams = { transactionId };
    
    return RestClient.post('query', reqParams, reqBody, {})
      .then(validateResponse)
      .catch((err) => {
        if (err.userMessage) {
          return Promise.reject(new Error(err.userMessage));
        }
        return Promise.reject(new Error('Network error occurred'));
      });
  }, []);

  const getQueryApi = useCallback((transactionId: string) => {
    const reqParams = { transactionId };
    return RestClient.get('query', reqParams, {}, {})
      .then(validateResponse)
      .catch((err) => {
        if (err.userMessage) return err;
        return Promise.reject(new Error('Network error occurred'));
      });
  }, []);

  const checkIfRaised = useCallback(async (transactionId: string) => {
    const response = await getQueryApi(transactionId);
    return !isEmpty(path(['query', 'id'], response));
  }, [getQueryApi]);

  const hasTransaction = useCallback((response: any) => has('transaction', response), []);
  const hasComplaints = useCallback((response: any) => has('complaints', response), []);

  const isValidTransactionComplaintObject = useCallback((response: any) => {
    if (
      hasTransaction(response) &&
      hasComplaints(response) &&
      !isEmpty(path(['complaints.crn'], response))
    ) {
      return response;
    }
    return Promise.reject(response);
  }, [hasTransaction, hasComplaints]);

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
      }), [isValidTransactionComplaintObject]);

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

  return {
    raiseConcern,
    getQueryApi,
    checkIfRaised,
    raiseComplaint,
    transactionRaiseComplaint,
  };
};