import { demoState, demoTimeline } from '../../extension/src/shared/demo';
import { writeFileSync } from 'node:fs';
writeFileSync('/tmp/claude-0/-home-claude/1355b350-d507-52b2-99e3-d63903bae67d/scratchpad/demo.json', JSON.stringify({ state: demoState('state').result, desc: demoState('description').result, tl: demoTimeline() }));
