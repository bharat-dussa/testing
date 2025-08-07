// hooks/useTransactionFilters.ts
import { useCallback } from 'react';
import { isEmpty, not } from 'rambda';

export const useTransactionFilters = (
  filter: object,
  dateMode: object,
  setFilter: (filter: object) => void,
  setDateMode: (dateMode: object) => void,
  forceUpdate: () => void
) => {
  const applyFilter = useCallback((filterBy: object) => {
    setFilter(filterBy);
    forceUpdate();
  }, [setFilter, forceUpdate]);

  const applyDateMode = useCallback((dateModeBy: object) => {
    setDateMode(dateModeBy);
    forceUpdate();
  }, [setDateMode, forceUpdate]);

  const clearFilter = useCallback(() => {
    setFilter({});
    forceUpdate();
  }, [setFilter, forceUpdate]);

  const clearDateMode = useCallback(() => {
    setDateMode({});
    forceUpdate();
  }, [setDateMode, forceUpdate]);

  const clearFilterWithoutUpdate = useCallback(() => {
    setFilter({});
  }, [setFilter]);

  const clearFilterWithUpdate = useCallback(() => {
    setFilter({});
    setDateMode({});
    forceUpdate();
  }, [setFilter, setDateMode, forceUpdate]);

  const filterforupiId = useCallback((upiId: string) => {
    setFilter({ vpa: upiId });
    forceUpdate();
  }, [setFilter, forceUpdate]);

  const upiLitefilter = useCallback((upilite: string) => {
    setFilter({ upiLite: upilite });
    forceUpdate();
  }, [setFilter, forceUpdate]);

  const isFilterApplied = useCallback(() => not(isEmpty(filter)), [filter]);
  const isDateModeApplied = useCallback(() => not(isEmpty(dateMode)), [dateMode]);
  
  const getAppliedFilter = useCallback(() => ({ ...filter }), [filter]);
  const getAppliedDateMode = useCallback(() => ({ ...dateMode }), [dateMode]);

  return {
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
  };
};