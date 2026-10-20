/**
 * "Pingue-pongue": duas automações trocando o valor do mesmo campo (A grava 2, B volta para 1, A grava 2 de novo...).
 * Lê o histórico já investigado do campo (mais recente primeiro) e procura a alternância entre dois valores
 * feita por quem não é a mesma causa.
 */
import type { Change } from './types';

export interface PingPong {
  values: [string, string];
  /** Quem grava cada valor (nome do artefato ou da pessoa). */
  actors: [string, string];
  /** Quantas trocas seguidas. */
  flips: number;
  from: string;
  to: string;
}

export function detectPingPong(changes: Change[], minFlips = 3, maxSpanMs = 24 * 3600_000): PingPong | undefined {
  const seq = [...changes].reverse(); // mais antigo primeiro
  let best: PingPong | undefined;
  for (let i = 0; i < seq.length; i++) {
    const a = seq[i]!;
    const va = a.newValue, vb = a.oldValue;
    if (va === vb) continue;
    let j = i + 1, flips = 1;
    let expect = vb;
    while (j < seq.length && seq[j]!.newValue === expect && seq[j]!.oldValue === (expect === va ? vb : va)) { flips++; expect = expect === va ? vb : va; j++; }
    if (flips < minFlips) continue;
    const run = seq.slice(i, j);
    const span = Date.parse(run[run.length - 1]!.at.replace(' ', 'T') + 'Z') - Date.parse(run[0]!.at.replace(' ', 'T') + 'Z');
    if (span > maxSpanMs) continue;
    const who = (c: Change) => c.evidence[0]?.artifact.name ?? c.user;
    const actorA = who(run[0]!), actorB = who(run[1]!);
    // Precisa de duas causas diferentes, cada uma sempre gravando o mesmo valor.
    if (actorA === actorB) continue;
    if (!run.every((c, k) => who(c) === (k % 2 ? actorB : actorA))) continue;
    const pp: PingPong = { values: [va, vb], actors: [actorA, actorB], flips, from: run[0]!.at, to: run[run.length - 1]!.at };
    if (!best || pp.flips > best.flips) best = pp;
  }
  return best;
}
