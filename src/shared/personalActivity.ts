/** Aggregate only: no conversation text or path crosses the bridge. */
export type ActivityPeriod = 7 | 30 | 90
export type PersonalActivity = {
  generatedAt: number
  sessions: number
  messages: number
  activeDays: number
  ignoredEntries: number
  unreadableFiles: number
  days: { date: string; messages: number }[]
}
