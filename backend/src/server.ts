import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { Engine, State } from './engine.js';

const clinic = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '../data/clinic.json'), 'utf8')).clinic;
const stateFile = process.env.STATE_FILE ?? path.resolve(process.cwd(), 'state.json');
let saved: State | undefined;
try { saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* first run */ }

// Data survives restarts: the whole state is written to a JSON file after every change.
const engine = new Engine(clinic.doctors, clinic.averageConsultationMinutes, saved, s => {
  fs.writeFileSync(stateFile + '.tmp', JSON.stringify(s));
  fs.renameSync(stateFile + '.tmp', stateFile);
});
const port = Number(process.env.PORT ?? 3001);
createApp(engine, { production: process.env.NODE_ENV === 'production' })
  .listen(port, () => console.log(`${clinic.name} API on :${port}`));
