// Pure queue logic. No clock, no I/O: every method receives `now` (ms since epoch).
export type Cls = 'E' | 'A' | 'W';                      // current class (changes after a no-show)
export type Rule = 'emergency' | 'due' | 'walkin' | 'early'; // which call rule picked a patient
export interface Patient {
  id: number; name: string; age: number; token: string; cls: Cls;
  appt?: number; checkInAt: number; noShows: number;
  status: 'waiting' | 'serving' | 'done' | 'gone';
}
export interface State {
  nextId: number; patients: Patient[];
  counters: Record<string, Record<Cls, number>>;        // keyed by local day
  serving: Record<string, number | null>;               // doctorId -> patient id
  rules: Rule[];                                        // last non-emergency call rules (max 3)
}
export class ConflictError extends Error {}
export class NotFoundError extends Error {}

const MIN = 60_000, LATE = 15 * MIN, DUE = 10 * MIN, TZ_OFFSET = 345 * MIN; // Asia/Kathmandu UTC+05:45
export const localDay = (ms: number) => new Date(ms + TZ_OFFSET).toISOString().slice(0, 10);
export const localHHMM = (ms: number) => new Date(ms + TZ_OFFSET).toISOString().slice(11, 16);

export const emptyState = (doctorIds: string[]): State => ({
  nextId: 1, patients: [], counters: {}, rules: [],
  serving: Object.fromEntries(doctorIds.map(d => [d, null])),
});

/** Rules 3 + 4: who is called next, and under which rule. */
function pick(waiting: Patient[], now: number, recent: Rule[]): { p: Patient; rule: Rule } | null {
  const byCheckIn = (a: Patient, b: Patient) => a.checkInAt - b.checkInAt;
  const emergencies = waiting.filter(p => p.cls === 'E').sort(byCheckIn);
  if (emergencies[0]) return { p: emergencies[0], rule: 'emergency' };
  const appts = waiting.filter(p => p.cls === 'A');
  const due = appts.filter(p => p.appt! <= now + DUE).sort((a, b) => a.appt! - b.appt! || byCheckIn(a, b));
  const walkIns = waiting.filter(p => p.cls === 'W')
    .sort((a, b) => Number(b.age >= 65) - Number(a.age >= 65) || byCheckIn(a, b));
  if (due[0]) {
    const last3 = recent.slice(-3);
    // Fairness: three due-appointment calls in a row -> a waiting walk-in goes first.
    if (walkIns[0] && last3.length === 3 && last3.every(r => r === 'due')) return { p: walkIns[0], rule: 'walkin' };
    return { p: due[0], rule: 'due' };
  }
  if (walkIns[0]) return { p: walkIns[0], rule: 'walkin' };
  const early = appts.sort((a, b) => a.appt! - b.appt! || byCheckIn(a, b))[0];
  return early ? { p: early, rule: 'early' } : null;
}

export interface CheckInInput { name: string; age: number; kind: 'appointment' | 'walk_in'; appt?: number; emergency?: boolean }

export class Engine {
  constructor(
    public doctors: { id: string; name: string }[],
    private avgMinutes = 12,
    public state: State = emptyState(doctors.map(d => d.id)),
    private onChange: (s: State) => void = () => {},
  ) {}

  private find(id: number) { return this.state.patients.find(p => p.id === id)!; }
  private doctor(id: string) {
    if (!this.doctors.some(d => d.id === id)) throw new NotFoundError(`Unknown doctor ${id}`);
  }
  private view(p: Patient) { return { token: p.token, name: p.name, age: p.age, class: p.cls }; }

  checkIn(i: CheckInInput, now: number) {
    // Rule 1: more than 15 min late => walk-in. Exactly 15 is still on time.
    const cls: Cls = i.emergency ? 'E' : i.kind === 'appointment' && now - i.appt! <= LATE ? 'A' : 'W';
    const day = localDay(now);
    const c = (this.state.counters[day] ??= { E: 0, A: 0, W: 0 });
    c[cls]++;
    const p: Patient = {
      id: this.state.nextId++, name: i.name, age: i.age, cls, token: `${cls}-${String(c[cls]).padStart(3, '0')}`,
      appt: cls === 'A' ? i.appt : undefined, checkInAt: now, noShows: 0, status: 'waiting',
    };
    this.state.patients.push(p);
    this.onChange(this.state);
    return this.view(p);
  }

  callNext(doctorId: string, now: number) {
    this.doctor(doctorId);
    if (this.state.serving[doctorId] != null) throw new ConflictError('Doctor is already seeing a patient');
    // Node runs this synchronously, so two simultaneous requests are handled one after the other
    // and can never receive the same patient.
    const r = pick(this.state.patients.filter(p => p.status === 'waiting'), now, this.state.rules);
    if (!r) return null;
    r.p.status = 'serving';
    this.state.serving[doctorId] = r.p.id;
    if (r.rule !== 'emergency') this.state.rules = [...this.state.rules, r.rule].slice(-3);
    this.onChange(this.state);
    return this.view(r.p);
  }

  private finish(doctorId: string, now: number, noShow: boolean) {
    this.doctor(doctorId);
    const id = this.state.serving[doctorId];
    if (id == null) throw new ConflictError('Doctor has no patient to finish');
    const p = this.find(id);
    this.state.serving[doctorId] = null;
    if (!noShow) p.status = 'done';
    else if (++p.noShows >= 2) p.status = 'gone';
    else { p.status = 'waiting'; p.cls = 'W'; p.appt = undefined; p.checkInAt = now; } // keeps token
    this.onChange(this.state);
  }
  done(doctorId: string, now: number) { this.finish(doctorId, now, false); }
  noShow(doctorId: string, now: number) { this.finish(doctorId, now, true); }

  queue(now: number) {
    const nowServing = this.doctors.flatMap(d => {
      const id = this.state.serving[d.id];
      return id == null ? [] : [{ doctorId: d.id, token: this.find(id).token, name: this.find(id).name }];
    });
    // Rule 6: simulate pressing Call next repeatedly with the clock frozen at `now`.
    let rest = this.state.patients.filter(p => p.status === 'waiting');
    let recent = [...this.state.rules];
    const waiting: { position: number; token: string; name: string; estimatedWaitMinutes: number }[] = [];
    for (let r = pick(rest, now, recent); r; r = pick(rest, now, recent)) {
      rest = rest.filter(p => p !== r!.p);
      if (r.rule !== 'emergency') recent = [...recent, r.rule].slice(-3);
      const position = waiting.length;
      waiting.push({ position, token: r.p.token, name: r.p.name,
        estimatedWaitMinutes: Math.floor(position / this.doctors.length) * this.avgMinutes });
    }
    return { nowServing, waiting };
  }
}
