/** Instâncias ativadas pelo usuário (chrome.storage.sync, por origem). */
export interface InstanceSettings {
    origin: string;
    enabledAt: string;
}
export declare function listInstances(): Promise<InstanceSettings[]>;
export declare function isEnabled(origin: string): Promise<boolean>;
export declare function addInstance(origin: string): Promise<void>;
export declare function removeInstance(origin: string): Promise<void>;
export declare function looksLikeServiceNow(url: string | undefined): boolean;
export declare function originOf(url: string): string;
/** Links para abrir o artefato na instância. */
export declare function recordLink(origin: string, table: string, sysId: string): string;
