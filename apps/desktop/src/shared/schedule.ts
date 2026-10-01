import type { Automation } from './contracts.ts';

/** Each wall-clock date has one occurrence, including a repeated fall-back hour. */
export function nextAutomationRun(job: Pick<Automation, 'intervalMinutes' | 'schedule'>, after: number): number {
  const schedule = job.schedule;
  if (!schedule) return after + job.intervalMinutes * 60000;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: schedule.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = (time: number) => {
    const values = Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]));
    return { year: Number(values.year), month: Number(values.month), day: Number(values.day), minute: Number(values.hour) * 60 + Number(values.minute) };
  };
  const today = parts(after);
  const [hour, minute] = schedule.time.split(':').map(Number);
  const targetMinute = hour * 60 + minute;
  for (let day = 0; day <= 370; day++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + day));
    if (schedule.kind === 'weekly' && date.getUTCDay() !== schedule.weekday) continue;
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    if (schedule.kind === 'monthly' && date.getUTCDate() !== Math.min(schedule.monthday, lastDay)) continue;
    // Search actual UTC instants, never manufacture a timezone offset. In a spring gap the first
    // existing local minute after the requested time is used; a repeated hour picks its first copy.
    const center = date.getTime() + targetMinute * 60000;
    let occurrence: number | undefined;
    for (let time = center - 16 * 3600000; time <= center + 16 * 3600000; time += 60000) {
      const local = parts(time);
      if (local.year === date.getUTCFullYear() && local.month === date.getUTCMonth() + 1 && local.day === date.getUTCDate() && local.minute >= targetMinute) {
        occurrence = time;
        break;
      }
    }
    if (occurrence !== undefined && occurrence > after) return occurrence;
  }
  throw new Error('无法计算下一次日历运行时间');
}
