/** "E se eu mudar?": prevê o que o ServiceNow roda se o campo mudar para um valor novo. Só leitura. */
import type { Investigation } from '@trail/core';
export declare function WhatIf({ r, origin }: {
    r: Investigation;
    origin: string;
    field?: string;
}): import("preact").JSX.Element;
