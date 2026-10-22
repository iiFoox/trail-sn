/** Animação de carregamento do Trail: a trilha que se desenha com a lupa. Usada no campo, no registro inteiro e no lote. */
import { useEffect, useState } from 'preact/hooks';

export function Loading({ steps }: { steps: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => { const id = setInterval(() => setI((x) => (x + 1) % steps.length), 650); return () => clearInterval(id); }, [steps]);
  return (
    <div class="card loader" role="status" aria-live="polite">
      <svg class="trailsvg" viewBox="0 0 320 90" aria-hidden="true">
        <path class="ghost" d="M10 70 C 60 70, 70 20, 120 24 S 190 78, 232 60 S 290 12, 310 18" />
        <path class="draw" d="M10 70 C 60 70, 70 20, 120 24 S 190 78, 232 60 S 290 12, 310 18" />
        {[[10, 70], [120, 24], [232, 60], [310, 18]].map(([x, y], k) => <circle class="stop" cx={x} cy={y} r="5" style={`--k:${k}`} />)}
        <g class="lens"><circle r="9" /><path d="M6.5 6.5 L13 13" /></g>
      </svg>
      <div class="lsteps"><b key={i}>{steps[i]}</b></div>
    </div>
  );
}
