import type { TabState } from '../shared/messages';
type B = NonNullable<TabState['batch']>;
export declare function Batch({ b, origin, onOpen }: {
    b: B;
    origin: string;
    onOpen: (sysId: string, field?: string) => void;
}): import("preact").JSX.Element;
export {};
