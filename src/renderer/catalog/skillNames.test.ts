import { test, expect } from 'bun:test'
import { skillNames } from './skillNames.js'

test('presentation collapses packaging mirrors without merging distinct nested skills', () => {
  expect(skillNames(['skills/ponytail/SKILL.md', '.openclaw/skills/ponytail/SKILL.md', '.claude\\skills\\ponytail\\SKILL.md', 'team-a/review/SKILL.md', 'team-b/review/SKILL.md']))
    .toEqual(['ponytail', 'team-a/review', 'team-b/review'])
})
