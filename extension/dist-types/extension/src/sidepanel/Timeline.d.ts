/** Linha do tempo do registro inteiro: gravações, por onde entraram e os campos de cada uma. */
export declare function RecordTimeline({ origin, table, sysId, onField }: {
    origin: string;
    table: string;
    sysId: string;
    onField: (field: string) => void;
}): import("preact").JSX.Element;
