import type { TabState } from '../shared/messages';
export declare function Batch({ b, origin, onOpen }: {
    b: NonNullable<TabState['batch']>;
    origin: string;
    onOpen: (sysId: string, field?: string) => void;
}): import("preact").JSX.Element;
