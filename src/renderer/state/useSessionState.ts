import * as React from 'react'

type Values = Record<string, unknown>
const SessionStateContext = React.createContext<[Values, React.Dispatch<React.SetStateAction<Values>>] | null>(null)

/** Retain unsent data when its cell is closed or moved; nothing is written to disk. */
export function SessionStateProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const state = React.useState<Values>({})
  return React.createElement(SessionStateContext.Provider, { value: state }, children)
}

/** A fork receives its draft after the source cell may already have unmounted. */
export function useSessionDraftWriter(): (id: string, text: string) => void {
  const shared = React.useContext(SessionStateContext)
  if (!shared) throw new Error('SessionStateProvider absent')
  const [, setValues] = shared
  return React.useCallback((id: string, text: string) => {
    setValues(values => ({ ...values, [`${id}:draft`]: text }))
  }, [setValues])
}

/** Pending input belongs to the session that created it, including async attachment reads. */
export function useSessionState<T>(sessionId: string | null, initial: T, field = 'draft'): [T, React.Dispatch<React.SetStateAction<T>>] {
  const local = React.useState<Values>({})
  const shared = React.useContext(SessionStateContext)
  const [values, setValues] = shared ?? local
  const key = `${sessionId ?? 'initial'}:${field}`
  const update = React.useCallback((next: React.SetStateAction<T>) => {
    setValues(current => ({ ...current, [key]: typeof next === 'function'
      ? (next as (value: T) => T)((current[key] as T | undefined) ?? initial) : next }))
  }, [key, initial, setValues])
  return [(values[key] as T | undefined) ?? initial, update]
}
