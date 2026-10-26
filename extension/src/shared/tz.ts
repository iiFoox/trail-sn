/**
 * Fuso das horas mostradas no painel: o do usuário no ServiceNow (o que o formulário usa), e não o do navegador.
 * Achado na caça de uso real: com o usuário em America/Sao_Paulo e o navegador em outro fuso, o painel e o formulário
 * mostravam horas diferentes para a mesma mudança. Sem o fuso da instância (ou inválido), vale o do navegador.
 */
let zone: string | undefined;

export function setDisplayTimeZone(z: string | undefined): void {
  if (!z) { zone = undefined; return; }
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); zone = z; } catch { zone = undefined; }
}

/** Opção para toLocale*String: o fuso do usuário, quando conhecido. */
export function tzOpt(): { timeZone?: string } {
  return zone ? { timeZone: zone } : {};
}

/** Número do dia (desde 1970) no fuso de exibição: para "hoje" e "ontem". */
export function dayNumber(d: Date): number {
  return Math.floor(Date.parse(`${d.toLocaleDateString('en-CA', tzOpt())}T00:00:00Z`) / 86400000);
}
