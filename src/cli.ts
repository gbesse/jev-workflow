#!/usr/bin/env node
import { basename, dirname, resolve } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import {
  compileWorkflow,
  lintWorkflow,
  loadWorkflowSpec,
  readCompiledWorkflow,
  writeCompiledWorkflow,
} from "./compiler.js";
import { evaluatePredictions, exportJevcal, loadDataset, parsePredictions } from "./evaluation.js";
import { FixtureProvider, TypeSafeProvider } from "./provider.js";
import { executeWorkflow } from "./runtime.js";
import { createEgressPlan, generateEgressKeyPair, signEgressPlan, verifyEgressManifest } from "./egress.js";
import { fuzzWorkflow } from "./fuzz.js";
import { runPreflight } from "./preflight.js";
import { readDecisionTrace, traceToRegressionCase } from "./trace.js";
import type { CompiledWorkflow, FuzzMutationName, SignedEgressManifest, StabilityState, SystemOneResult } from "./types.js";

const VERSION = "0.2.1";

function usage(): string {
  return `jev-workflow ${VERSION} — compile and run auditable Jev policies

Usage:
  jev-workflow lint <policy.yaml>
  jev-workflow compile <policy.yaml> --out <workflow.lock.json>
  jev-workflow run <workflow.lock.json> --input <input.json> (--response <response.json> | --live) [--no-audit]
  jev-workflow eval <workflow.lock.json> --dataset <rows.jsonl> (--predictions <results.json> | --live) [--max-calls <n>] [--target <0..1>]
  jev-workflow fuzz <workflow.lock.json> --dataset <rows.jsonl> (--response <response.json> | --live) [--mutations <names>] [--paths <paths>] [--max-calls <n>]
  jev-workflow replay <workflow.lock.json> --trace <trace.jsonl> [--id <id>] (--response <response.json> | --live)
  jev-workflow trace-to-case <trace.jsonl> [--id <id>] --out <case.json>
  jev-workflow egress-plan <workflow.lock.json> --input <input.json> --out <manifest.json> [--sign-private <key.pem>]
  jev-workflow egress-keygen --private <private.pem> --public <public.pem>
  jev-workflow egress-verify <manifest.json> --public <public.pem>
  jev-workflow export-jevcal <workflow.lock.json> --dataset <rows.jsonl> --out <directory>

Live commands read TYPESAFE_API_KEY from the environment. Use Node's --env-file=.env;
the CLI never reads or prints an env file itself.
`;
}

interface Args { positionals: string[]; options: Map<string, string | true> }

function parseArgs(values: string[]): Args {
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!value.startsWith("--")) { positionals.push(value); continue; }
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) options.set(key, true);
    else { options.set(key, next); index += 1; }
  }
  return { positionals, options };
}

function required(args: Args, key: string): string {
  const value = args.options.get(key);
  if (typeof value !== "string") throw new Error(`--${key} is required`);
  return value;
}

async function artifactFrom(path: string): Promise<CompiledWorkflow> {
  return path.endsWith(".yaml") || path.endsWith(".yml")
    ? compileWorkflow(await loadWorkflowSpec(path))
    : readCompiledWorkflow(path);
}

async function providerFor(args: Args): Promise<FixtureProvider | TypeSafeProvider> {
  if (args.options.has("live")) return new TypeSafeProvider(process.env.TYPESAFE_API_KEY ?? "", process.env.TYPESAFE_BASE_URL);
  const responsePath = required(args, "response");
  return new FixtureProvider(JSON.parse(await readFile(responsePath, "utf8")) as unknown);
}

async function writeJson(path: string, value: unknown, mode = 0o644): Promise<void> {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
}

async function readStabilityState(path: string): Promise<StabilityState | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as StabilityState; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeStabilityState(path: string, state: StabilityState): Promise<void> {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, destination);
}

async function main(): Promise<number> {
  const raw = process.argv.slice(2);
  if (raw.length === 0 || raw.includes("--help") || raw.includes("-h")) { process.stdout.write(usage()); return 0; }
  if (raw.includes("--version") || raw.includes("-v")) { process.stdout.write(`${VERSION}\n`); return 0; }
  const command = raw[0]!;
  const args = parseArgs(raw.slice(1));
  const subject = args.positionals[0];

  if (command === "egress-keygen") {
    const privatePath = resolve(required(args, "private"));
    const publicPath = resolve(required(args, "public"));
    await mkdir(dirname(privatePath), { recursive: true, mode: 0o700 });
    await mkdir(dirname(publicPath), { recursive: true });
    const keys = generateEgressKeyPair();
    await writeFile(privatePath, keys.privateKey, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await writeFile(publicPath, keys.publicKey, { encoding: "utf8", mode: 0o644, flag: "wx" });
    process.stdout.write(`${JSON.stringify({ privateKey: privatePath, publicKey: publicPath }, null, 2)}\n`);
    return 0;
  }
  if (!subject) throw new Error(`${command} requires a policy or workflow path`);

  if (command === "lint") {
    const findings = lintWorkflow(await loadWorkflowSpec(subject));
    process.stdout.write(`${JSON.stringify({ findings, errors: findings.filter((item) => item.severity === "error").length }, null, 2)}\n`);
    return findings.some((item) => item.severity === "error") ? 1 : 0;
  }
  if (command === "compile") {
    const out = resolve(required(args, "out"));
    const spec = await loadWorkflowSpec(subject);
    const findings = lintWorkflow(spec);
    const artifact = compileWorkflow(spec);
    await mkdir(dirname(out), { recursive: true });
    await writeCompiledWorkflow(out, artifact);
    process.stdout.write(`${JSON.stringify({ output: out, fingerprint: artifact.fingerprint, findings }, null, 2)}\n`);
    return 0;
  }
  if (command === "run") {
    const artifact = await artifactFrom(subject);
    const input = JSON.parse(await readFile(required(args, "input"), "utf8")) as unknown;
    const stabilityPath = args.options.get("stability-state");
    const result = await executeWorkflow(artifact, input, await providerFor(args), {
      audit: !args.options.has("no-audit"),
      auditPath: typeof args.options.get("audit") === "string" ? args.options.get("audit") as string : undefined,
      tracePath: typeof args.options.get("trace") === "string" ? args.options.get("trace") as string : undefined,
      traceInput: args.options.has("trace-input"),
      stabilityState: typeof stabilityPath === "string" ? await readStabilityState(stabilityPath) : undefined,
    });
    if (typeof stabilityPath === "string" && result.stability) await writeStabilityState(stabilityPath, result.stability.state);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (command === "eval") {
    const artifact = await artifactFrom(subject);
    const rows = await loadDataset(required(args, "dataset"));
    const maxCalls = Number(args.options.get("max-calls") ?? 20);
    const target = Number(args.options.get("target") ?? 0.95);
    let predictions: Record<string, SystemOneResult>;
    if (args.options.has("live")) {
      if (!Number.isInteger(maxCalls) || maxCalls < 1) throw new Error("--max-calls must be a positive integer");
      if (rows.length > maxCalls) throw new Error(`dataset has ${rows.length} rows; increase --max-calls explicitly to authorize all live calls`);
      const provider = new TypeSafeProvider(process.env.TYPESAFE_API_KEY ?? "", process.env.TYPESAFE_BASE_URL);
      predictions = {};
      for (const row of rows) {
        const result = await executeWorkflow(artifact, row.input, provider, { audit: false, id: row.id });
        predictions[row.id] = { model: result.providerModel, answers: result.answers, usage: result.receipt.usage };
      }
      const predictionsOut = args.options.get("predictions-out");
      if (typeof predictionsOut === "string") await writeFile(predictionsOut, `${JSON.stringify(predictions, null, 2)}\n`, "utf8");
    } else {
      predictions = parsePredictions(JSON.parse(await readFile(required(args, "predictions"), "utf8")) as unknown);
    }
    const report = evaluatePredictions(artifact, rows, predictions, target);
    const output = args.options.get("out");
    if (typeof output === "string") await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  if (command === "fuzz") {
    const artifact = await artifactFrom(subject);
    const rows = await loadDataset(required(args, "dataset"));
    const mutationsRaw = String(args.options.get("mutations") ?? "option-order,state-key-order,normalized-whitespace");
    const allowed = new Set<FuzzMutationName>(["option-order", "state-key-order", "normalized-whitespace", "irrelevant-context"]);
    const mutations = mutationsRaw.split(",").filter(Boolean) as FuzzMutationName[];
    if (mutations.some((item) => !allowed.has(item))) throw new Error(`unknown mutation; expected one of: ${[...allowed].join(", ")}`);
    const maxCalls = Number(args.options.get("max-calls") ?? 100);
    if (!Number.isInteger(maxCalls) || maxCalls < 1) throw new Error("--max-calls must be a positive integer");
    const report = await fuzzWorkflow(artifact, rows, await providerFor(args), {
      seed: Number(args.options.get("seed") ?? 42),
      mutations,
      irrelevantPaths: typeof args.options.get("paths") === "string" ? String(args.options.get("paths")).split(",").filter(Boolean) : [],
      irrelevantText: typeof args.options.get("text") === "string" ? String(args.options.get("text")) : undefined,
      maxCalls,
    });
    if (typeof args.options.get("out") === "string") await writeJson(String(args.options.get("out")), report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.passed ? 0 : 2;
  }
  if (command === "replay") {
    const artifact = await artifactFrom(subject);
    const trace = await readDecisionTrace(required(args, "trace"), typeof args.options.get("id") === "string" ? String(args.options.get("id")) : undefined);
    if (!trace.input) throw new Error("trace does not contain input; record with --trace-input to enable replay");
    if (trace.result.workflow.fingerprint !== artifact.fingerprint && !args.options.has("allow-workflow-change")) {
      throw new Error("workflow fingerprint differs from the trace; pass --allow-workflow-change to compare a new policy");
    }
    const current = await executeWorkflow(artifact, trace.input, await providerFor(args), { audit: false, id: trace.result.receipt.id });
    const comparison = {
      traceId: trace.traceId,
      sameOutcome: JSON.stringify(current.outcome) === JSON.stringify(trace.result.outcome),
      previous: { outcome: trace.result.outcome, ruleId: trace.result.decision.ruleId, answers: trace.result.answers },
      current: { outcome: current.outcome, ruleId: current.decision.ruleId, answers: current.answers },
    };
    process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
    return comparison.sameOutcome ? 0 : 2;
  }
  if (command === "trace-to-case") {
    const trace = await readDecisionTrace(subject, typeof args.options.get("id") === "string" ? String(args.options.get("id")) : undefined);
    const destination = resolve(required(args, "out"));
    await writeJson(destination, traceToRegressionCase(trace));
    process.stdout.write(`${JSON.stringify({ output: destination, traceId: trace.traceId }, null, 2)}\n`);
    return 0;
  }
  if (command === "egress-plan") {
    const artifact = await artifactFrom(subject);
    const input = JSON.parse(await readFile(required(args, "input"), "utf8")) as unknown;
    const plan = createEgressPlan(artifact, runPreflight(artifact, input).state);
    const keyPath = args.options.get("sign-private");
    const manifest = typeof keyPath === "string" ? signEgressPlan(plan, await readFile(keyPath, "utf8")) : plan;
    const destination = resolve(required(args, "out"));
    await writeJson(destination, manifest);
    process.stdout.write(`${JSON.stringify({ output: destination, permitted: plan.permitted, violations: plan.violations.length, signed: typeof keyPath === "string" }, null, 2)}\n`);
    return plan.permitted ? 0 : 2;
  }
  if (command === "egress-verify") {
    const manifest = JSON.parse(await readFile(subject, "utf8")) as SignedEgressManifest;
    const valid = verifyEgressManifest(manifest, await readFile(required(args, "public"), "utf8"));
    process.stdout.write(`${JSON.stringify({ valid }, null, 2)}\n`);
    return valid ? 0 : 2;
  }
  if (command === "export-jevcal") {
    const artifact = await artifactFrom(subject);
    const out = resolve(required(args, "out"));
    await exportJevcal(artifact, await loadDataset(required(args, "dataset")), out);
    process.stdout.write(`${JSON.stringify({ output: out, files: ["questions.yaml", "data.jsonl", "README.txt"] }, null, 2)}\n`);
    return 0;
  }
  throw new Error(`unknown command: ${command}`);
}

main().then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    process.stderr.write(`${basename(process.argv[1] ?? "jev-workflow")}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
