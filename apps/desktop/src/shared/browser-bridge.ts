/** Renderer-visible bridge state. Tokens and native Chrome tab IDs stay in main. */
export type ChromeTab = {
  tabId: string;
  url: string;
  title: string;
  windowId?: number;
  active?: boolean;
  ownerThreadId?: string;
};

export type ChromeBridgeStatus = {
  running: boolean;
  protocol: number;
  port: number;
  pairing: { code: string; expiresAt: number } | null;
  sessions: Array<{ id: string; version: string; connectedAt: number; expiresAt: number; tabs: ChromeTab[] }>;
};
