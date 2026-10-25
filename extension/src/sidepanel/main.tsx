import { render } from 'preact';
import '../shared/ui.css';
import { embedAllowed } from '../shared/embedGuard';
import { bootPage } from '../shared/prefs';
import { App } from './App';

bootPage();
void embedAllowed().then((ok) => { if (ok) render(<App />, document.getElementById('app')!); });
