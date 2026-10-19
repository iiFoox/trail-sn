import { render } from 'preact';
import '../shared/ui.css';
import { bootPage } from '../shared/prefs';
import { App } from './App';

bootPage();
render(<App />, document.getElementById('app')!);
