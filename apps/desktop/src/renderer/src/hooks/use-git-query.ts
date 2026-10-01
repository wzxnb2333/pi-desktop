import { useCallback, useEffect, useRef, useState } from 'react';

interface QueryState<T> {
  key: string | null;
  data?: T;
  pending: boolean;
  error: string;
}

/** Every selection and refresh supersedes the preceding read, including rejected reads. */
export function useGitQuery<T>(key: string | null, load: () => Promise<T>, revision?: unknown) {
  const [state, setState] = useState<QueryState<T>>({ key, pending: !!key, error: '' });
  const current = useRef({ key, load });
  current.current = { key, load };
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    if (key === null) { setState({ key, pending: false, error: '' }); return; }
    setState(previous => ({ key, data: previous.key === key ? previous.data : undefined, pending: true, error: '' }));
    try {
      const data = await current.current.load();
      if (generation.current === request && current.current.key === key) setState({ key, data, pending: false, error: '' });
    } catch (error) {
      if (generation.current === request && current.current.key === key) setState({ key, pending: false, error: error instanceof Error ? error.message : String(error) });
    }
  }, [key]);
  useEffect(() => {
    void reload();
    return () => { generation.current++; };
  }, [reload, revision]);
  return { ...(state.key === key ? state : { pending: !!key, error: '', data: undefined }), reload };
}
