import type { Conversation } from '../types';
import { butlerClock } from './butler-policy';
import { butlerPrivateText, type ButlerPrivacyPolicy } from './butler-privacy';
import { BUTLER_HABIT_PREFIX, modelSafeSummary } from './proactive-butler';

/*
 * In-app habit learning. Everything here runs on the device over its own copy of
 * the conversations; only the short sentences returned below can become Butler
 * signals (and so reach the selected model or the account brain). Message text is
 * never returned: topics come from conversation titles, after the privacy rules.
 */
/** observedAt is the earliest activity counted, so a forget made after it covers the habit too. */
export interface ButlerHabit { id: string; topic: string; intent: string; summary: string; observedAt: number }

const DAY = 86_400_000;
const WINDOW_DAYS = 14;
const PERIODS: [string, number, number][] = [['清晨', 5, 8], ['上午', 8, 12], ['中午', 12, 14], ['下午', 14, 18], ['晚上', 18, 23]];
const periodOf = (hour: number) => PERIODS.find(([, from, to]) => hour >= from && hour < to)?.[0] ?? '深夜';

interface Use { at: number; day: string; hour: number; conv: Conversation }

/**
 * `since(id)` is when the user last told the Butler to forget that habit (or
 * everything). Only activity after it is used, so a forgotten habit is learned
 * again from new behaviour and never from the old.
 */
export function learnButlerHabits(conversations: Conversation[], now: number, timezone: string,
  since: (id: string) => number = () => 0, policy?: ButlerPrivacyPolicy,
  excluded: (conv: Conversation, message: Conversation['messages'][number]) => boolean = () => false): ButlerHabit[] {
  const all: Use[] = [], hidden = new Set<string>();
  for (const conv of conversations) {
    // Scheduled runs, regression cases and the Butler's own Work are not the user's habits.
    if (conv.privacy === 'personal-butler' || conv.taskId || conv.evalCaseId) continue;
    for (const message of conv.messages) {
      if (message.role !== 'user' || message.contextKind || !Number.isFinite(message.createdAt)) continue;
      if (message.createdAt > now || message.createdAt < now - WINDOW_DAYS * DAY) continue;
      // Messages the privacy rules keep out, or whose needs the user deleted, are not counted,
      // and their conversation's title is not offered as a topic.
      if (excluded(conv, message)) { hidden.add(conv.id); continue; }
      const clock = butlerClock(message.createdAt, timezone);
      all.push({ at: message.createdAt, day: clock.day, hour: Number(clock.time.slice(0, 2)), conv });
    }
  }
  const uses = (id: string) => { const from = since(id); return all.filter(use => use.at > from); };
  const earliest = (list: Use[]) => Math.min(...list.map(use => use.at));
  const habits: ButlerHabit[] = [];

  const rhythmId = BUTLER_HABIT_PREFIX + 'rhythm', rhythm = uses(rhythmId);
  const days = new Set(rhythm.map(use => use.day));
  if (rhythm.length >= 12 && days.size >= 3) {
    const byPeriod = new Map<string, number>();
    for (const use of rhythm) byPeriod.set(periodOf(use.hour), (byPeriod.get(periodOf(use.hour)) ?? 0) + 1);
    const top = [...byPeriod].sort((a, b) => b[1] - a[1]).filter(([, count], index) => index === 0 || count / rhythm.length >= 0.25).slice(0, 2).map(([name]) => name);
    const firsts = [...days].map(day => Math.min(...rhythm.filter(use => use.day === day).map(use => use.hour))).sort((a, b) => a - b);
    const start = firsts[Math.floor(firsts.length / 2)];
    const weekday = rhythm.filter(use => { const d = new Date(use.day + 'T12:00:00Z').getUTCDay(); return d > 0 && d < 6; }).length / rhythm.length;
    const week = days.size >= 5 ? (weekday >= 0.85 ? '几乎只在工作日使用' : weekday <= 0.4 ? '周末用得更多' : '工作日和周末都会用') : '';
    habits.push({ id: rhythmId, topic: '使用时段', intent: '使用习惯',
      summary: `近两周有 ${days.size} 天在用，多在${top.join('和')}；通常 ${start} 点左右开始${week ? '，' + week : ''}。`, observedAt: earliest(rhythm) });
  }

  const topicsId = BUTLER_HABIT_PREFIX + 'topics', byConv = new Map<string, { title: string; count: number; at: number }>();
  for (const use of uses(topicsId)) {
    if (hidden.has(use.conv.id)) continue;
    const title = butlerPrivateText(use.conv.title ?? '', policy);
    const safe = title && title !== '[private]' ? modelSafeSummary(title, 24) : '';
    if (!safe || safe.includes('[REDACTED]') || safe.includes('[private]') || /^新(?:对话|会话)$/.test(safe)) continue;
    const entry = byConv.get(use.conv.id) ?? { title: safe, count: 0, at: use.at };
    entry.count++; entry.at = Math.min(entry.at, use.at); byConv.set(use.conv.id, entry);
  }
  const topics = [...byConv.values()].filter(entry => entry.count >= 2).sort((a, b) => b.count - a.count).slice(0, 3);
  if (topics.length >= 2) habits.push({ id: topicsId, topic: '常聊的话题', intent: '使用习惯',
    summary: `近两周聊得最多的是：${topics.map(entry => `「${entry.title}」`).join('、')}。`, observedAt: Math.min(...topics.map(entry => entry.at)) });

  const modesId = BUTLER_HABIT_PREFIX + 'modes', convs = new Map<string, Conversation>(), modeUses = uses(modesId);
  for (const use of modeUses) convs.set(use.conv.id, use.conv);
  if (convs.size >= 5) {
    const list = [...convs.values()], work = list.filter(conv => conv.workspace).length / list.length, project = list.filter(conv => conv.projectId).length / list.length;
    const parts = [work >= 0.5 ? '多数任务交给 Work 在独立工作区处理' : work >= 0.15 ? `约 ${Math.round(work * 100)}% 的对话用 Work 处理文件` : '以普通对话为主，很少用 Work',
      project >= 0.5 ? '常在项目里工作' : project > 0 ? '偶尔用项目整理对话' : ''].filter(Boolean);
    habits.push({ id: modesId, topic: '使用方式', intent: '使用习惯', summary: `近两周 ${list.length} 个对话：${parts.join('，')}。`, observedAt: earliest(modeUses) });
  }
  return habits;
}
