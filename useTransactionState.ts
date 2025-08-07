export const useTransactionsState = () => {
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState({});
  const [dateMode, setDateMode] = useState({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorOccuredDuringLastUpdate, setErrorOccuredDuringLastUpdate] = useState(false);
  
  const transactionsObservableRef = useRef<BehaviorSubject<Maybe<PaginatedTransactions>> | null>(null);
  const circleTransactionsObservableRef = useRef<BehaviorSubject<Maybe<PaginatedTransactions>> | null>(null);
  const paymentSubscriptionRef = useRef<Subscription | null>(null);
  const subjectRef = useRef<Subject<any> | null>(null);

  const resetOffset = useCallback(() => setOffset(0), []);
  const incrementOffset = useCallback((pageSize: number) => 
    setOffset(prev => prev + pageSize), []);

  const updateLastUpdated = useCallback(() => setLastUpdated(new Date()), []);
  
  const setErrorState = useCallback((hasError: boolean) => 
    setErrorOccuredDuringLastUpdate(hasError), []);

  return {
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
  };
};