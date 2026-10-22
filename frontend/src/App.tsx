import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, Queue, usePoll } from './api';

const useHash = () => {
  const [h, setH] = useState(location.hash || '#/reception');
  useEffect(() => { const f = () => setH(location.hash || '#/reception'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
};

export default function App() {
  const h = useHash();
  if (h === '#/display') return <Display />;
  return (
    <div className="page">
      <nav><a href="#/reception" className={h === '#/reception' ? 'on' : ''}>Reception</a>
        <a href="#/doctor" className={h === '#/doctor' ? 'on' : ''}>Doctor</a><a href="#/display">Waiting-room display</a></nav>
      {h === '#/doctor' ? <Doctor /> : <Reception />}
    </div>
  );
}

function Status({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <p className="note">Loading…</p>;
  return error ? <p className="err" role="alert">{error}. Showing the last known data may be out of date.</p> : null;
}

function QueueTable({ q }: { q: Queue }) {
  if (!q.waiting.length) return <p className="note">Nobody is waiting.</p>;
  return (
    <table><thead><tr><th>#</th><th>Token</th><th>Name</th><th>Estimated wait</th></tr></thead><tbody>
      {q.waiting.map(w => <tr key={w.token + w.name}><td>{w.position + 1}</td><td><b>{w.token}</b></td><td>{w.name}</td>
        <td>{w.estimatedWaitMinutes === 0 ? 'Next' : `${w.estimatedWaitMinutes} min`}</td></tr>)}
    </tbody></table>
  );
}

function Reception() {
  const { data, error, loading, reload } = usePoll<Queue>('/queue');
  const [f, setF] = useState({ name: '', age: '', kind: 'walk_in', appt: '', emergency: false });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const age = Number(f.age);
    if (!f.name.trim()) return setMsg({ ok: false, text: 'Name is required' });
    if (f.age === '' || !Number.isFinite(age) || age < 0 || age > 120) return setMsg({ ok: false, text: 'Age must be between 0 and 120' });
    if (f.kind === 'appointment' && !f.appt) return setMsg({ ok: false, text: 'Appointment time is required' });
    setBusy(true);
    try {
      const r = await api<{ token: string }>('/check-ins', 'POST', {
        name: f.name.trim(), age, kind: f.kind, emergency: f.emergency || undefined,
        appointmentTime: f.kind === 'appointment' ? `${f.appt}:00+05:45` : undefined, // clinic time zone
      });
      setMsg({ ok: true, text: `Checked in. Token ${r.token}` });
      setF({ name: '', age: '', kind: 'walk_in', appt: '', emergency: false });
      reload();
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    setBusy(false);
  };

  return (<>
    <h1>Reception</h1>
    <form onSubmit={submit} className="card">
      <label>Name<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
      <label>Age<input type="number" value={f.age} onChange={e => setF({ ...f, age: e.target.value })} /></label>
      <label>Type<select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
        <option value="walk_in">Walk-in</option><option value="appointment">Appointment</option></select></label>
      {f.kind === 'appointment' && <label>Appointment time (Kathmandu)<input type="datetime-local" value={f.appt} onChange={e => setF({ ...f, appt: e.target.value })} /></label>}
      <label className="row"><input type="checkbox" checked={f.emergency} onChange={e => setF({ ...f, emergency: e.target.checked })} /> Emergency</label>
      <button disabled={busy}>{busy ? 'Checking in…' : 'Check in'}</button>
      {msg && <p className={msg.ok ? 'ok' : 'err'} role="status">{msg.text}</p>}
    </form>
    <h2>Queue</h2>
    <Status loading={loading} error={error} />
    {data && <QueueTable q={data} />}
  </>);
}

function Doctor() {
  const docs = usePoll<{ id: string; name: string }[]>('/doctors', 60000);
  const { data, error, loading, reload } = usePoll<Queue>('/queue');
  const [id, setId] = useState(localStorage.getItem('doctorId') ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = data?.nowServing.find(s => s.doctorId === id);

  const act = async (a: string) => {
    setBusy(true); setErr(null);
    try { await api(`/doctors/${id}/${a}`, 'POST'); } catch (e) { setErr((e as Error).message); }
    await reload(); setBusy(false);
  };
  return (<>
    <h1>Doctor</h1>
    <Status loading={loading || docs.loading} error={error || docs.error} />
    <label>I am <select value={id} onChange={e => { setId(e.target.value); localStorage.setItem('doctorId', e.target.value); }}>
      <option value="">Choose…</option>{docs.data?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    {id && data && (<div className="card">
      <p>{mine ? <>With patient: <b className="big">{mine.token} · {mine.name}</b></> : 'No patient right now.'}</p>
      <div className="row">
        <button disabled={busy || !!mine} onClick={() => act('call-next')}>Call next</button>
        <button disabled={busy || !mine} onClick={() => act('done')}>Done</button>
        <button className="warn" disabled={busy || !mine} onClick={() => act('no-show')}>No-show</button></div>
      {err && <p className="err" role="alert">{err}</p>}
      {!mine && !data.waiting.length && <p className="note">Nobody is waiting.</p>}
    </div>)}
    {data && <><h2>Waiting ({data.waiting.length})</h2><QueueTable q={data} /></>}
  </>);
}

function Display() {
  const { data, error, loading } = usePoll<Queue>('/queue', 1500);
  const seen = useRef<Record<string, string>>({});
  const [fresh, setFresh] = useState<string[]>([]);
  useEffect(() => { // highlight a token for 8s when a doctor's current token changes
    if (!data) return;
    const first = Object.keys(seen.current).length === 0;
    const changed = data.nowServing.filter(s => seen.current[s.doctorId] !== s.token).map(s => s.token);
    seen.current = Object.fromEntries(data.nowServing.map(s => [s.doctorId, s.token]));
    if (changed.length && !first) { setFresh(f => [...f, ...changed]); setTimeout(() => setFresh(f => f.filter(t => !changed.includes(t))), 8000); }
  }, [data]);

  if (error) return <div className="tv down"><h1>Server unavailable</h1><p>Please ask reception for help.</p></div>;
  if (loading || !data) return <div className="tv"><h1>Loading…</h1></div>;
  return (<div className="tv">
    <h1>Now serving</h1>
    <div className="tiles">{data.nowServing.length ? data.nowServing.map(s =>
      <div key={s.doctorId} className={'tile' + (fresh.includes(s.token) ? ' fresh' : '')}>
        <div className="tok">{s.token}</div><div>{s.name}</div><div className="doc">Doctor {s.doctorId}</div></div>)
      : <p className="tok dim">—</p>}</div>
    <h2>Next up: {data.waiting.slice(0, 4).map(w => w.token).join('   ') || 'nobody waiting'}</h2>
  </div>);
}
