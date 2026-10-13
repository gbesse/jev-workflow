import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  compileWorkflow,
  certifyDecisionSlo,
  buildRiskCard,
  renderRiskCard,
  renderRiskBadge,
} from '../dist/index.js';
const output = resolve(process.argv[2] || 'output/riskcard');
await mkdir(output, { recursive: true });
const artifact = compileWorkflow({
  version: 1,
  name: 'RiskCard synthetic demo',
  policyVersion: '2026-10-13',
  model: 'synthetic; no provider call',
  input: { message: { type: 'string', required: true } },
  state: { include: ['message'] },
  questions: { approve: { type: 'noul', instructions: 'Synthetic question' } },
  routing: { rules: [], default: { action: 'review' } },
});
const rows = Array.from({ length: 200 }, (_, i) => ({
  id: 'synthetic-' + i,
  action: i % 100 < 80 ? 'auto_approve' : 'review',
  score: i % 100 < 80 ? 0.95 : 0.4,
  correct: true,
  slices: { region: i % 2 ? 'east' : 'west' },
}));
const certificate = certifyDecisionSlo(artifact, rows, {
  action: 'auto_approve',
  maxRisk: 0.1,
  minimumCoverage: 0.5,
  slices: ['region'],
  minSliceSize: 20,
});
for (const locale of ['fr', 'en', 'es']) {
  const card = buildRiskCard(certificate, { locale });
  await writeFile(resolve(output, locale + '.html'), renderRiskCard(card), {
    mode: 0o600,
    flag: 'wx',
  });
  await writeFile(resolve(output, locale + '.svg'), renderRiskBadge(card), {
    mode: 0o600,
    flag: 'wx',
  });
}
await writeFile(resolve(output, 'certificate.json'), JSON.stringify(certificate, null, 2), {
  mode: 0o600,
  flag: 'wx',
});
console.log(
  JSON.stringify({
    output,
    source: {
      fr: 'Données synthétiques, aucun appel Jev.',
      en: 'Synthetic data, no Jev call.',
      es: 'Datos sintéticos, sin llamadas Jev.',
    },
  }),
);
