import {
  exactBinomialUpperBound,
  unwrapDecisionCertificate,
  verifyDecisionCertificateSignature,
} from './slo.js';
import type { DecisionCertificate, RiskEvidence } from './types.js';

export const riskCardText = {
  en: {
    title: 'Decision RiskCard',
    invalid: 'Invalid certificate, evidence, signature or report options',
    certified: 'Holdout evidence meets the declared SLO',
    rejected: 'Declared SLO rejected',
    insufficient: 'Insufficient evidence',
    expired: 'Certificate expired',
    future: 'Certificate not yet valid',
    unverified: 'Signature not verified',
    unsigned: 'Checksum only; no authenticated issuer',
    verified: 'Ed25519 signature verified against the supplied key',
    signature: 'Signature',
    coverage: 'Validated automation rate',
    risk: 'Upper risk bound',
    budget: 'Declared risk budget',
    confidence: 'Family-wise confidence',
    threshold: 'Fixed threshold',
    sample: 'Holdout decisions',
    errors: 'Observed errors',
    selected: 'Selected decisions',
    slices: 'Slice evidence',
    scrollNote: 'Scroll the table horizontally on a narrow screen',
    group: 'Group',
    enough: 'Enough selected decisions',
    yes: 'yes',
    no: 'no',
    missing: 'not available',
    workflow: 'Workflow',
    action: 'Action',
    model: 'Model',
    valid: 'Validity',
    created: 'Created',
    expires: 'Expires',
    reasons: 'Certificate reasons (preserved as supplied)',
    evidence: 'Evidence identifiers',
    scope:
      'This snapshot describes one fixed threshold on caller-supplied labels and holdout data. It does not estimate the maximum possible automation rate, authorize actions or establish safety under distribution shift. Confidence assumes representative, independently labeled binomial observations; a checksum is not a signature.',
    privacy:
      'The report includes workflow metadata, slice names and evidence hashes, but no raw decisions, texts or private keys. Review these fields before sharing. No certificate is renewed or changed.',
    source: 'Built with jev-workflow',
    report: 'Report written',
    help: 'Render a saved certificate without rerunning Jev. Existing output files are never overwritten.',
  },
  fr: {
    title: 'RiskCard de décision',
    invalid: 'Certificat, preuves, signature ou options de rapport invalides',
    certified: 'Les preuves du holdout satisfont le SLO déclaré',
    rejected: 'SLO déclaré rejeté',
    insufficient: 'Preuves insuffisantes',
    expired: 'Certificat expiré',
    future: 'Certificat pas encore valide',
    unverified: 'Signature non vérifiée',
    unsigned: 'Empreinte uniquement ; émetteur non authentifié',
    verified: 'Signature Ed25519 vérifiée avec la clé fournie',
    signature: 'Signature',
    coverage: 'Taux d’automatisation validé',
    risk: 'Borne supérieure du risque',
    budget: 'Budget de risque déclaré',
    confidence: 'Confiance familiale',
    threshold: 'Seuil fixé',
    sample: 'Décisions du holdout',
    errors: 'Erreurs observées',
    selected: 'Décisions sélectionnées',
    slices: 'Preuves par segment',
    scrollNote: 'Faire défiler le tableau horizontalement sur un écran étroit',
    group: 'Groupe',
    enough: 'Assez de décisions sélectionnées',
    yes: 'oui',
    no: 'non',
    missing: 'indisponible',
    workflow: 'Workflow',
    action: 'Action',
    model: 'Modèle',
    valid: 'Validité',
    created: 'Créé',
    expires: 'Expire',
    reasons: 'Motifs du certificat (conservés tels que fournis)',
    evidence: 'Identifiants des preuves',
    scope:
      'Cette photographie décrit un seuil fixé sur les annotations et données de holdout fournies par l’appelant. Elle n’estime pas le taux maximal d’automatisation possible, n’autorise aucune action et ne démontre pas la sécurité en cas de changement de distribution. La confiance suppose des observations binomiales représentatives et annotées indépendamment ; une empreinte n’est pas une signature.',
    privacy:
      'Le rapport contient les métadonnées du workflow, les noms des segments et les empreintes, mais aucune décision brute, aucun texte ni clé privée. Examiner ces champs avant partage. Aucun certificat n’est renouvelé ou modifié.',
    source: 'Créé avec jev-workflow',
    report: 'Rapport enregistré',
    help: 'Afficher un certificat enregistré sans relancer Jev. Les fichiers existants ne sont jamais écrasés.',
  },
  es: {
    title: 'RiskCard de decisión',
    invalid: 'Certificado, pruebas, firma u opciones de informe no válidos',
    certified: 'Las pruebas del holdout cumplen el SLO declarado',
    rejected: 'SLO declarado rechazado',
    insufficient: 'Pruebas insuficientes',
    expired: 'Certificado caducado',
    future: 'Certificado aún no válido',
    unverified: 'Firma no verificada',
    unsigned: 'Solo huella; emisor no autenticado',
    verified: 'Firma Ed25519 verificada con la clave aportada',
    signature: 'Firma',
    coverage: 'Tasa de automatización validada',
    risk: 'Límite superior del riesgo',
    budget: 'Presupuesto de riesgo declarado',
    confidence: 'Confianza familiar',
    threshold: 'Umbral fijo',
    sample: 'Decisiones del holdout',
    errors: 'Errores observados',
    selected: 'Decisiones seleccionadas',
    slices: 'Pruebas por segmento',
    scrollNote: 'Desplazar la tabla horizontalmente en una pantalla estrecha',
    group: 'Grupo',
    enough: 'Suficientes decisiones seleccionadas',
    yes: 'sí',
    no: 'no',
    missing: 'no disponible',
    workflow: 'Workflow',
    action: 'Acción',
    model: 'Modelo',
    valid: 'Validez',
    created: 'Creado',
    expires: 'Caduca',
    reasons: 'Motivos del certificado (conservados como se aportaron)',
    evidence: 'Identificadores de pruebas',
    scope:
      'Esta instantánea describe un umbral fijo sobre anotaciones y datos de holdout aportados por quien llama. No estima la tasa máxima de automatización posible, no autoriza acciones ni demuestra seguridad ante cambios de distribución. La confianza supone observaciones binomiales representativas y anotadas independientemente; una huella no es una firma.',
    privacy:
      'El informe contiene metadatos del workflow, nombres de segmentos y huellas, pero no decisiones brutas, textos ni claves privadas. Revisar estos campos antes de compartir. No se renueva ni modifica ningún certificado.',
    source: 'Creado con jev-workflow',
    report: 'Informe guardado',
    help: 'Mostrar un certificado guardado sin volver a ejecutar Jev. Nunca se sobrescriben archivos existentes.',
  },
} as const;

export type RiskCardLocale = keyof typeof riskCardText;
export type RiskCardStatus = DecisionCertificate['status'] | 'expired' | 'future' | 'unverified';
export interface RiskCard {
  locale: RiskCardLocale;
  generatedAt: string;
  status: RiskCardStatus;
  signature: 'unsigned' | 'verified' | 'unverified';
  certificate: DecisionCertificate;
}

const invalid = () =>
  new Error(
    'FR : rapport de risque invalide. EN: invalid risk report. ES: informe de riesgo no válido.',
  );

function checkEvidence(value: RiskEvidence | null, rows?: number): void {
  if (value === null) return;
  if (
    ![value.rows, value.selected, value.errors].every((x) => Number.isInteger(x) && x >= 0) ||
    value.rows < 1 ||
    value.selected > value.rows ||
    value.errors > value.selected ||
    (rows !== undefined && value.rows !== rows) ||
    !Number.isFinite(value.confidence) ||
    value.confidence <= 0 ||
    value.confidence >= 1
  )
    throw invalid();
  const close = (a: unknown, b: number | null) =>
    b === null ? a === null : typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) < 1e-9;
  if (
    !close(value.coverage, value.selected / value.rows) ||
    !close(value.empiricalRisk, value.selected ? value.errors / value.selected : null) ||
    !close(
      value.upperRiskBound,
      value.selected
        ? exactBinomialUpperBound(value.errors, value.selected, value.confidence)
        : null,
    )
  )
    throw invalid();
}

export function buildRiskCard(
  value: unknown,
  options: {
    locale?: RiskCardLocale;
    now?: string;
    publicKey?: string;
    requireSignature?: boolean;
  } = {},
): RiskCard {
  const locale = options.locale ?? 'en';
  if (!Object.hasOwn(riskCardText, locale)) throw invalid();
  const generatedAt = options.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) throw invalid();
  let unwrapped: ReturnType<typeof unwrapDecisionCertificate>;
  try {
    unwrapped = unwrapDecisionCertificate(value);
  } catch {
    throw invalid();
  }
  const { certificate, signed } = unwrapped;
  if (
    ![
      certificate.workflow.name,
      certificate.workflow.model,
      certificate.workflow.fingerprint,
      certificate.slo.action,
    ].every((x) => typeof x === 'string' && x.length > 0) ||
    certificate.evidence.familyWiseConfidence !== certificate.slo.confidence ||
    !certificate.reasons.every((x) => typeof x === 'string')
  )
    throw invalid();
  checkEvidence(certificate.evidence.calibration, certificate.dataset.calibrationRows);
  checkEvidence(certificate.evidence.validation, certificate.dataset.validationRows);
  for (const slice of certificate.evidence.slices) {
    checkEvidence(slice);
    if (
      typeof slice.field !== 'string' ||
      typeof slice.value !== 'string' ||
      slice.eligible !== slice.selected >= certificate.slo.minSliceSize
    )
      throw invalid();
  }
  if (
    certificate.status === 'certified' &&
    (certificate.slo.threshold === null ||
      certificate.evidence.validation === null ||
      (certificate.evidence.validation.upperRiskBound ?? 1) > certificate.slo.maxRisk ||
      certificate.evidence.validation.coverage < certificate.slo.minimumCoverage ||
      certificate.evidence.slices.some(
        (s) => !s.eligible || (s.upperRiskBound ?? 1) > certificate.slo.maxRisk,
      ))
  )
    throw invalid();
  let signature: RiskCard['signature'] = signed ? 'unverified' : 'unsigned';
  if (options.publicKey) {
    if (!signed || !verifyDecisionCertificateSignature(signed, options.publicKey)) throw invalid();
    signature = 'verified';
  }
  if (options.requireSignature && signature !== 'verified') throw invalid();
  const time = Date.parse(generatedAt);
  const status: RiskCardStatus =
    time < Date.parse(certificate.createdAt)
      ? 'future'
      : time >= Date.parse(certificate.expiresAt)
        ? 'expired'
        : signed && signature !== 'verified'
          ? 'unverified'
          : certificate.status;
  return { locale, generatedAt, status, signature, certificate };
}

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const color = (card: RiskCard) =>
  card.status === 'certified'
    ? '#24668e'
    : card.status === 'insufficient' || card.status === 'unverified'
      ? '#895b13'
      : '#973d48';

export function renderRiskBadge(card: RiskCard): string {
  const t = riskCardText[card.locale];
  const evidence = card.certificate.evidence.validation;
  const percent = (x: number) => (100 * x).toFixed(1) + '%';
  const label =
    card.status === 'certified'
      ? `${t.coverage}: ${percent(evidence!.coverage)} · n=${evidence!.selected} · ${t.risk}: ${percent(evidence!.upperRiskBound!)} · ${t.confidence}: ${percent(card.certificate.slo.confidence)} · ${t.expires}: ${card.certificate.expiresAt.slice(0, 10)}`
      : t[card.status];
  const width = Math.min(1800, Math.max(420, 24 + label.length * 8));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="40" role="img" aria-label="${escape(label)}"><title>${escape(t.title + ': ' + label + '. ' + t[card.signature])}</title><rect width="100%" height="40" rx="8" fill="${color(card)}"/><text x="12" y="26" fill="#fff" font-family="system-ui,sans-serif" font-size="13">${escape(label)}</text></svg>`;
}

export function renderRiskCard(card: RiskCard): string {
  const t = riskCardText[card.locale],
    c = card.certificate,
    e = c.evidence.validation;
  const percent = (x: number | null | undefined) =>
    x === null || x === undefined
      ? t.missing
      : new Intl.NumberFormat(card.locale, { style: 'percent', maximumFractionDigits: 2 }).format(
          x,
        );
  const metric = (label: string, value: unknown) =>
    `<article class="metric"><h2>${escape(label)}</h2><strong>${escape(value)}</strong></article>`;
  const table = c.evidence.slices
    .map(
      (s) =>
        `<tr><th scope="row">${escape(s.field)}=${escape(s.value)}</th><td>${s.selected} / ${s.rows}</td><td>${s.errors}</td><td>${escape(percent(s.upperRiskBound))}</td><td>${escape(s.eligible ? t.yes : t.no)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="${card.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>${escape(t.title)} · ${escape(c.workflow.name)}</title><style>body{margin:0;background:#f4f6f9;color:#172838;font:16px/1.55 system-ui,sans-serif}main{max-width:1040px;margin:auto;padding:clamp(18px,4vw,44px)}h1{font-size:clamp(28px,5vw,48px);margin:0}header,section,.metric{background:white;border:1px solid #dce3e9;border-radius:14px;padding:24px;margin-bottom:20px}.status{border-left:6px solid ${color(card)}}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.metric h2{font-size:15px;margin:0;color:#54677a}.metric strong{font-size:30px}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}dt{font-weight:650}dd{margin:0;overflow-wrap:anywhere}.scroll{overflow:auto}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #dce3e9}code{overflow-wrap:anywhere}a{color:#24668e}.note{color:#475a6d}svg{max-width:100%;height:auto}</style></head><body><main><header class="status"><p>jev-workflow · RiskCard</p><h1>${escape(t.title)}</h1><p id="riskcard-status"><strong>${escape(t[card.status])}</strong></p><p>${escape(t[card.signature])}</p></header><div class="grid">${metric(t.coverage, percent(e?.coverage))}${metric(t.risk, percent(e?.upperRiskBound))}${metric(t.budget, percent(c.slo.maxRisk))}${metric(t.confidence, percent(c.evidence.familyWiseConfidence))}${metric(t.sample, c.dataset.validationRows)}${metric(t.selected, e?.selected ?? t.missing)}${metric(t.errors, e?.errors ?? t.missing)}${metric(t.threshold, c.slo.threshold ?? t.missing)}</div><section><h2>${escape(t.workflow)}</h2><dl class="meta"><div><dt>${escape(t.workflow)}</dt><dd>${escape(c.workflow.name)}</dd></div><div><dt>${escape(t.action)}</dt><dd>${escape(c.slo.action)}</dd></div><div><dt>${escape(t.model)}</dt><dd>${escape(c.workflow.model)}</dd></div><div><dt>${escape(t.created)}</dt><dd>${escape(c.createdAt)}</dd></div><div><dt>${escape(t.expires)}</dt><dd>${escape(c.expiresAt)}</dd></div></dl></section><section><h2>${escape(t.slices)}</h2>${table ? `<p class="note">${escape(t.scrollNote)}</p><div class="scroll" tabindex="0" role="region" aria-label="${escape(t.slices)}"><table><thead><tr><th>${escape(t.group)}</th><th>${escape(t.selected)}</th><th>${escape(t.errors)}</th><th>${escape(t.risk)}</th><th>${escape(t.enough)}</th></tr></thead><tbody>${table}</tbody></table></div>` : `<p>${escape(t.missing)}</p>`}</section><section><h2>${escape(t.reasons)}</h2><ul>${c.reasons.map((r) => `<li>${escape(r)}</li>`).join('')}</ul><h2>${escape(t.evidence)}</h2><p>certificateId · <code>${escape(c.certificateId)}</code></p><p>workflow · <code>${escape(c.workflow.fingerprint)}</code></p><p>dataset · <code>${escape(c.dataset.sha256)}</code></p><p>${escape(card.generatedAt)}</p></section><section class="note"><p>${escape(t.scope)}</p><p>${escape(t.privacy)}</p><p><a href="https://github.com/gbesse/jev-workflow" rel="noopener noreferrer">${escape(t.source)}</a></p></section></main></body></html>`;
}
