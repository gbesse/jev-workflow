export interface TraceMeasurement {traceId:string;startTime:string;endTime:string;attributes:Record<string,unknown>}
export function summarizeTraceMeasurements(traces:ReadonlyArray<TraceMeasurement>){
 const fail=():never=>{throw new TypeError('Traces invalides / Invalid traces / Trazas inválidas');};
 if(!Array.isArray(traces)||traces.length>10000)fail();const seen=new Set<string>();let tokens=0,unknown=0;const latency:number[]=[];
 for(const trace of traces){if(typeof trace.traceId!=='string'||!trace.traceId||seen.has(trace.traceId))fail();seen.add(trace.traceId);const a=Date.parse(trace.startTime),b=Date.parse(trace.endTime);if(!Number.isFinite(a)||!Number.isFinite(b)||b<a)fail();latency.push(b-a);const n=trace.attributes['gen_ai.usage.input_tokens'];if(n===undefined||n===null){unknown++;continue;}if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0)fail();tokens+=n as number;if(!Number.isSafeInteger(tokens))fail();}
 latency.sort((a,b)=>a-b);const quantile=(p:number)=>latency.length?latency[Math.ceil(p*latency.length)-1]!:null;
 return {traces:traces.length,knownInputTokens:tokens,totalInputTokens:unknown?null:tokens,unknownTokenTraces:unknown,latencyP50Ms:quantile(.5),latencyP95Ms:quantile(.95),quantileMethod:'nearest_rank',userAdoptionInferred:false};
}
