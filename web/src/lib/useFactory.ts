import { useCallback, useEffect, useRef, useState } from 'react';
import { isActive, type TaskStatus } from '@shared/domain';
import type { AgentProbe, FactoryState, ProgressEvent, ProgressUpdate, Task, TaskEvent } from '@shared/types';
import { api, connectLive } from './live';
import { arrivals, chime, readNotifyMode, showBadge, unseenAfter, wantsBanner, wantsSound, without } from './notifications';
import { mergeEvents, refreshQueue } from './sync';
import { groupTasks, repoName, taskState } from './tasks';

export type AgentState = { harness: string; probe: AgentProbe | null; error: string };

type Detail = { task: Task; events: TaskEvent[] };
type DetailResponse = Detail & { hasMore: boolean };
type Success<T> = string | ((result: T) => string);

const searchDebounceMs = 180;
const noticeMs = 5000;
const scopeKey = 'factory-task-scope';

export type Scope = 'repository' | 'all';

const hashTask = () => new URLSearchParams(location.hash.slice(1)).get('task');
const message = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

export function useFactory() {
  const [state, setState] = useState<FactoryState | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [connection, setConnection] = useState('Connecting');
  const [selected, setSelected] = useState<string | null>(hashTask);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>(() => (localStorage.getItem(scopeKey) === 'all' ? 'all' : 'repository'));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState<AgentState>({ harness: '', probe: null, error: '' });
  const [unseen, setUnseen] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<ReadonlyMap<string, ProgressUpdate>>(new Map());
  const live = useRef({ selected, query, scope, events: [] as TaskEvent[], loadedFor: null as string | null, probing: 0, statuses: new Map<string, TaskStatus>() });
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const probe = useCallback(async (harness: string) => {
    const version = ++live.current.probing;
    setAgent({ harness, probe: null, error: '' });
    try {
      const result = await api<AgentProbe>('/probe', { harness });
      if (version === live.current.probing) setAgent({ harness, probe: result, error: '' });
    } catch (failure) {
      if (version === live.current.probing) setAgent({ harness, probe: null, error: message(failure) });
    }
  }, []);

  const select = useCallback((id: string | null) => {
    live.current.selected = id;
    live.current.events = [];
    live.current.loadedFor = null;
    setSelected(id);
    setDetail(null);
    setUnseen(current => without(current, id));
    history.replaceState(null, '', id ? `#${new URLSearchParams({ task: id })}` : location.pathname);
    refreshRef.current();
  }, []);

  useEffect(() => {
    const notifyChanges = (next: FactoryState) => {
      const previous = live.current.statuses;
      live.current.statuses = new Map([...previous, ...next.tasks.map(task => [task.id, task.status] as const)]);
      const fresh = arrivals(previous, next.tasks).filter(task => document.hidden || task.id !== live.current.selected);
      setUnseen(current => unseenAfter(current, next.tasks, fresh));
      setProgress(current => {
        const idle = [...current.keys()].filter(id => !isActive(live.current.statuses.get(id)));
        if (!idle.length) return current;
        const kept = new Map(current);
        for (const id of idle) kept.delete(id);
        return kept;
      });
      if (!fresh.length) return;
      const mode = readNotifyMode();
      if (wantsSound(mode)) chime();
      if (!wantsBanner(mode) || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
      for (const task of fresh) {
        const notification = new Notification(task.title, { body: `${taskState(task).label} · ${repoName(task.repository)}`, tag: task.id });
        notification.onclick = () => {
          window.focus();
          select(task.id);
        };
      }
    };

    const refresh = refreshQueue(async () => {
      try {
        const { query: search } = live.current;
        const next = await api<FactoryState>(`/state?${new URLSearchParams({ q: search, ...(live.current.scope === 'all' && { all: '1' }) })}`);
        if (search !== live.current.query) {
          refresh();
          return;
        }
        setState(next);
        notifyChanges(next);
        setError(current => (current.startsWith('Could not refresh') ? '' : current));
        let id = live.current.selected;
        if (!id && !search) {
          id = groupTasks(next.tasks).find(group => group.id !== 'done')?.tasks[0]?.id ?? null;
          if (id) {
            live.current.selected = id;
            setSelected(id);
          }
        }
        if (!id) {
          setDetail(null);
          return;
        }
        const events = live.current.loadedFor === id ? live.current.events : [];
        const cursor = events.at(-1);
        const result = await api<DetailResponse>(`/tasks/${id}?${cursor ? `after=${cursor.id}` : 'latest=1'}`);
        if (live.current.selected !== id) return;
        live.current.events = mergeEvents(events, result.events);
        live.current.loadedFor = id;
        setDetail({ task: result.task, events: live.current.events });
        if (result.hasMore) refresh();
      } catch (failure) {
        setError(`Could not refresh: ${message(failure)}`);
      }
    });
    refreshRef.current = refresh;
    const onProgress = (event: ProgressEvent) =>
      setProgress(current => {
        const next = new Map(current);
        if ('cleared' in event) next.delete(event.taskId);
        else next.set(event.taskId, event);
        return next;
      });
    return connectLive(refresh, setConnection, onProgress);
  }, [select]);

  useEffect(() => {
    if (state && !agent.harness) probe(state.preferences.implementer);
  }, [state, agent.harness, probe]);

  useEffect(() => {
    live.current.query = query;
    const timer = setTimeout(() => refreshRef.current(), searchDebounceMs);
    return () => clearTimeout(timer);
  }, [query]);

  const attention = (state?.needsYou ?? 0) + unseen.size;
  useEffect(() => {
    document.title = attention ? `(${attention}) Local Factory` : 'Local Factory';
    showBadge(attention);
  }, [attention]);

  useEffect(() => {
    const clearViewed = () => {
      if (!document.hidden) setUnseen(current => without(current, live.current.selected));
    };
    document.addEventListener('visibilitychange', clearViewed);
    return () => document.removeEventListener('visibilitychange', clearViewed);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), noticeMs);
    return () => clearTimeout(timer);
  }, [notice]);

  const act = useCallback(async <T,>(operation: () => Promise<T>, success?: Success<T>) => {
    setBusy(true);
    try {
      const result = await operation();
      setError('');
      if (success) setNotice(typeof success === 'function' ? success(result) : success);
      return true;
    } catch (failure) {
      setNotice('');
      setError(message(failure));
      return false;
    } finally {
      setBusy(false);
      refreshRef.current();
    }
  }, []);

  const chooseAgent = useCallback((harness: string) => act(async () => {
    await api('/preferences', { implementer: harness });
    probe(harness);
  }), [act, probe]);

  const chooseScope = useCallback((next: Scope) => {
    live.current.scope = next;
    localStorage.setItem(scopeKey, next);
    setScope(next);
    refreshRef.current();
  }, []);

  const rememberModel = useCallback((harness: string, model: string) => {
    api('/preferences', { harness, model }).then(() => refreshRef.current(), () => undefined);
  }, []);

  return {
    state,
    detail: detail?.task.id === selected ? detail : null,
    connection,
    selected,
    select,
    query,
    setQuery,
    scope,
    chooseScope,
    rememberModel,
    error,
    setError,
    notice,
    setNotice,
    busy,
    act,
    agent,
    unseen,
    progress: selected ? progress.get(selected) : undefined,
    chooseAgent,
    reprobe: () => probe(agent.harness),
    refresh: () => refreshRef.current(),
  };
}

type Factory = ReturnType<typeof useFactory>;
