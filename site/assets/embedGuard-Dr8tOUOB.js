import{b as e}from"./prefs-D0xvl3Me.js";async function r(){if(window.top===window||!location.protocol.endsWith("-extension:"))return!0;const o=[...location.ancestorOrigins??[]];if(!o.length)return!1;const t=new Set((await e().catch(()=>[])).map(n=>n.origin));return o.every(n=>n===location.origin||t.has(n))}export{r as e};
//# sourceMappingURL=embedGuard-Dr8tOUOB.js.map
