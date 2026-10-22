import express, { NextFunction, Request, Response } from 'express';
import { ConflictError, Engine, NotFoundError } from './engine.js';

class BadRequest extends Error {}
const OFFSET_RE = /(Z|[+-]\d\d:\d\d)$/;
const parseInstant = (v: unknown, field: string) => {
  if (typeof v !== 'string' || !OFFSET_RE.test(v) || Number.isNaN(Date.parse(v)))
    throw new BadRequest(`${field} must be an ISO date-time with a UTC offset`);
  return Date.parse(v);
};

export function createApp(engine: Engine, opts: { production?: boolean } = {}) {
  const app = express();
  app.use(express.json());

  // Clock: tests can set the time with an X-Now header (disabled in production).
  const now = (req: Request) => {
    const h = req.header('X-Now');
    return h && !opts.production ? parseInstant(h, 'X-Now') : Date.now();
  };
  const route = (fn: (req: Request, res: Response) => void) =>
    (req: Request, res: Response, next: NextFunction) => { try { fn(req, res); } catch (e) { next(e); } };

  app.get('/api/doctors', route((_q, res) => { res.json(engine.doctors); }));

  app.post('/api/check-ins', route((req, res) => {
    const b = req.body ?? {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) throw new BadRequest('name is required');
    if (typeof b.age !== 'number' || !Number.isFinite(b.age) || b.age < 0 || b.age > 120)
      throw new BadRequest('age must be a number between 0 and 120');
    if (b.kind !== 'appointment' && b.kind !== 'walk_in') throw new BadRequest('kind must be "appointment" or "walk_in"');
    if (b.emergency !== undefined && typeof b.emergency !== 'boolean') throw new BadRequest('emergency must be a boolean');
    let appt: number | undefined;
    if (b.kind === 'appointment') {
      if (b.appointmentTime == null) throw new BadRequest('appointmentTime is required for appointments');
      appt = parseInstant(b.appointmentTime, 'appointmentTime');
    }
    res.status(201).json(engine.checkIn({ name, age: b.age, kind: b.kind, appt, emergency: b.emergency }, now(req)));
  }));

  app.post('/api/doctors/:id/call-next', route((req, res) => { res.json({ patient: engine.callNext(req.params.id, now(req)) }); }));
  app.post('/api/doctors/:id/done', route((req, res) => { engine.done(req.params.id, now(req)); res.json({ ok: true }); }));
  app.post('/api/doctors/:id/no-show', route((req, res) => { engine.noShow(req.params.id, now(req)); res.json({ ok: true }); }));
  app.get('/api/queue', route((req, res) => { res.json(engine.queue(now(req))); }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof BadRequest) return void res.status(400).json({ error: err.message });
    if (err instanceof NotFoundError) return void res.status(404).json({ error: err.message });
    if (err instanceof ConflictError) return void res.status(409).json({ error: err.message });
    if (err instanceof SyntaxError) return void res.status(400).json({ error: 'Invalid JSON body' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
