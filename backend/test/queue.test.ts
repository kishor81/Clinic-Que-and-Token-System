import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Engine, localHHMM } from '../src/engine';

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/clinic.json'), 'utf8'));
const doctors = data.clinic.doctors;

describe('data/clinic.json examples', () => {
  data.examples.forEach((ex: any, i: number) => it(`replays example ${i}`, () => {
    const e = new Engine(doctors, data.clinic.averageConsultationMinutes);
    const tokens: Record<string, string> = {}, calls: any[] = [], snaps: any[] = [];
    for (const ev of ex.events) {
      const now = Date.parse(ev.at);
      if (ev.type === 'check_in') {
        const p = ev.patient;
        tokens[p.name] = e.checkIn({ name: p.name, age: p.age, kind: p.kind, emergency: p.emergency,
          appt: p.appointmentTime && Date.parse(p.appointmentTime) }, now).token;
      } else if (ev.type === 'call_next') {
        const p = e.callNext(ev.doctorId, now);
        calls.push({ at: localHHMM(now), doctorId: ev.doctorId, token: p?.token ?? null, name: p?.name ?? null });
      } else if (ev.type === 'done') e.done(ev.doctorId, now);
      else if (ev.type === 'no_show') e.noShow(ev.doctorId, now);
      else if (ev.type === 'queue') snaps.push({ at: ev.at, queue: e.queue(now).waiting });
    }
    expect(tokens).toEqual(ex.expected.tokens);
    expect(calls).toEqual(ex.expected.calls);
    expect(snaps).toEqual(ex.expected.queueSnapshots);
  }));
});

describe('edge cases', () => {
  const mk = () => new Engine(doctors);
  const appt = '2026-11-02T09:00:00+05:45';
  const t = (s: string) => Date.parse(`2026-11-02T${s}+05:45`);
  it('exactly 15 minutes late is on time, 16 is a walk-in', () => {
    const e = mk();
    expect(e.checkIn({ name: 'a', age: 30, kind: 'appointment', appt: Date.parse(appt) }, t('09:15:00')).token).toBe('A-001');
    expect(e.checkIn({ name: 'b', age: 30, kind: 'appointment', appt: Date.parse(appt) }, t('09:16:00')).token).toBe('W-001');
  });
  it('counters restart at local midnight', () => {
    const e = mk();
    expect(e.checkIn({ name: 'a', age: 30, kind: 'walk_in' }, t('23:59:00')).token).toBe('W-001');
    expect(e.checkIn({ name: 'b', age: 30, kind: 'walk_in' }, Date.parse('2026-11-03T00:01:00+05:45')).token).toBe('W-001');
  });
  it('rejects call-next while busy and never double-calls', () => {
    const e = mk();
    e.checkIn({ name: 'a', age: 30, kind: 'walk_in' }, t('09:00:00'));
    expect(e.callNext('D1', t('09:01:00'))?.name).toBe('a');
    expect(() => e.callNext('D1', t('09:01:00'))).toThrow();
    expect(e.callNext('D2', t('09:01:00'))).toBeNull();
  });
});
