import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileWorkflow } from '../src/compiler.js';
import { generateEgressKeyPair } from '../src/egress.js';
import { buildRiskCard, renderRiskBadge, renderRiskCard } from '../src/riskcard.js';
import { certifyDecisionSlo, signDecisionCertificate } from '../src/slo.js';
import { sha256 } from '../src/utils.js';
import type { DecisionCertificate, DecisionSloRow, JsonValue, WorkflowSpec } from '../src/types.js';

const now = '2026-10-14T00:00:00.000Z';
const artifact = compileWorkflow({
  version: 1,
  name: 'RiskCard example',
  policyVersion: '2026-10-13',
  model: 'synthetic-model',
  input: { message: { type: 'string', required: true } },
  state: { include: ['message'] },
  questions: { approve: { type: 'noul', instructions: 'Synthetic question' } },
  routing: { rules: [], default: { action: 'human_review' } },
} satisfies WorkflowSpec);
const rows: DecisionSloRow[] = Array.from({ length: 200 }, (_, i) => ({
  id: `private-${i}`,
  action: i % 100 < 80 ? 'auto_approve' : 'review',
  score: i % 100 < 80 ? 0.95 : 0.4,
  correct: true,
  slices: { region: i % 2 ? 'east' : 'west' },
}));
const certificate = () =>
  certifyDecisionSlo(artifact, rows, {
    action: 'auto_approve',
    maxRisk: 0.1,
    minimumCoverage: 0.5,
    slices: ['region'],
    minSliceSize: 20,
    createdAt: '2026-10-13T00:00:00.000Z',
  });
function rehash(c: DecisionCertificate): DecisionCertificate {
  const { certificateId, ...unsigned } = c;
  return { ...unsigned, certificateId: sha256(unsigned as unknown as JsonValue) };
}

test('all three report languages show held-out evidence without raw decisions', () => {
  for (const locale of ['fr', 'en', 'es'] as const) {
    const card = buildRiskCard(certificate(), { locale, now });
    const html = renderRiskCard(card);
    assert.ok(html.includes(`<html lang="${locale}">`));
    assert.ok(html.includes('80'));
    assert.ok(html.includes('region=east'));
    assert.equal(card.status, 'certified');
    assert.equal(card.signature, 'unsigned');
    assert.ok(!html.includes('private-0'));
    assert.ok(!html.includes('<script'));
    assert.ok(renderRiskBadge(card).startsWith('<svg'));
  }
});

test('expired and future certificates cannot produce a current certified badge', () => {
  const c = certificate();
  const expired = buildRiskCard(c, { now: c.expiresAt });
  const future = buildRiskCard(c, { now: '2026-10-12T23:59:59Z' });
  assert.equal(expired.status, 'expired');
  assert.equal(future.status, 'future');
  assert.ok(!renderRiskBadge(expired).includes('Validated automation rate:'));
});

test('signed certificates stay unverified without a key and reject invalid keys', () => {
  const keys = generateEgressKeyPair(),
    other = generateEgressKeyPair();
  const signed = signDecisionCertificate(certificate(), keys.privateKey);
  assert.equal(buildRiskCard(signed, { now }).status, 'unverified');
  assert.equal(buildRiskCard(signed, { now, publicKey: keys.publicKey }).signature, 'verified');
  assert.throws(() => buildRiskCard(signed, { now, publicKey: other.publicKey }));
  assert.throws(() => buildRiskCard(signed, { now, requireSignature: true }));
  assert.throws(() => buildRiskCard(certificate(), { now, requireSignature: true }));
});

test('tampered and internally inconsistent evidence is rejected even after a new checksum', () => {
  const changed = certificate();
  changed.evidence.validation!.coverage = 0.99;
  assert.throws(() => buildRiskCard(changed, { now }));
  assert.throws(() => buildRiskCard(rehash(changed), { now }));
  const badBound = certificate();
  badBound.evidence.validation!.upperRiskBound = 0;
  assert.throws(() => buildRiskCard(rehash(badBound), { now }));
});

test('workflow labels and slice values are escaped without translating user content', () => {
  const c = certificate();
  c.workflow.name = '<img src=x onerror="alert(1)">';
  c.reasons = ['User-authored reason <script>bad()</script>'];
  const html = renderRiskCard(buildRiskCard(rehash(c), { now, locale: 'fr' }));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('User-authored reason &lt;script&gt;'));
});

test('CLI writes private outputs, localizes messages and never overwrites files', async () => {
  const execute = promisify(execFile),
    directory = await mkdtemp(join(tmpdir(), 'riskcard-'));
  try {
    const source = join(directory, 'certificate.json');
    await writeFile(source, JSON.stringify(certificate()));
    for (const locale of ['fr', 'en', 'es']) {
      const html = join(directory, locale + '.html'),
        badge = join(directory, locale + '.svg');
      await execute(process.execPath, [
        '--import',
        'tsx',
        'src/cli.ts',
        'report',
        source,
        '--html',
        html,
        '--badge',
        badge,
        '--lang',
        locale,
      ]);
      assert.ok((await readFile(html, 'utf8')).includes(`<html lang="${locale}">`));
      assert.equal((await stat(html)).mode & 0o777, 0o600);
      await assert.rejects(
        execute(process.execPath, [
          '--import',
          'tsx',
          'src/cli.ts',
          'report',
          source,
          '--html',
          html,
          '--lang',
          locale,
        ]),
      );
      assert.ok((await readFile(html, 'utf8')).includes('RiskCard'));
    }
    const first = join(directory, 'rollback.html'),
      existing = join(directory, 'en.svg');
    await assert.rejects(
      execute(process.execPath, [
        '--import',
        'tsx',
        'src/cli.ts',
        'report',
        source,
        '--html',
        first,
        '--badge',
        existing,
      ]),
    );
    await assert.rejects(stat(first));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
