declare const Zotero: any;
declare const Services: any;
declare const IOUtils: any;
declare const PathUtils: any;

interface Window {
  arguments?: Array<{ wrappedJSObject?: unknown }>;
  MozXULElement?: {
    insertFTLIfNeeded(name: string): void;
  };
}
