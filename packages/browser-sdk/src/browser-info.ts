export interface BrowserInfo {
  name: string;
  version?: string;
  engine: string;
  operatingSystem: string;
  deviceType: "Desktop" | "Mobile" | "Tablet";
}

interface BrowserBrand {
  brand: string;
  version: string;
}

export interface BrowserNavigator {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  brave?: { isBrave: () => Promise<boolean> };
  userAgentData?: {
    brands?: BrowserBrand[];
    platform?: string;
    mobile?: boolean;
  };
}

function brandVersion(source: BrowserNavigator, name: RegExp): string | undefined {
  return source.userAgentData?.brands?.find(({ brand }) => name.test(brand))?.version;
}

function matchVersion(userAgent: string, pattern: RegExp): string | undefined {
  return userAgent.match(pattern)?.[1];
}

async function isBrave(source: BrowserNavigator): Promise<boolean> {
  if (brandVersion(source, /Brave/i)) return true;
  try {
    return (await source.brave?.isBrave()) === true;
  } catch {
    return false;
  }
}

function operatingSystem(source: BrowserNavigator): string {
  const userAgent = source.userAgent;
  const platform = source.userAgentData?.platform ?? source.platform ?? "";

  if (/Windows/i.test(userAgent) || /Windows/i.test(platform)) return "Windows";
  if (/Android/i.test(userAgent) || /Android/i.test(platform)) return "Android";
  if (/iPhone|iPad|iPod/i.test(userAgent) || /iOS/i.test(platform)) return "iOS";
  if (/Macintosh|Mac OS X/i.test(userAgent) || /macOS|MacIntel/i.test(platform)) return "macOS";
  if (/Linux/i.test(userAgent) || /Linux/i.test(platform)) return "Linux";
  return platform || "Unknown OS";
}

function deviceType(source: BrowserNavigator): BrowserInfo["deviceType"] {
  const userAgent = source.userAgent;
  const isIPadDesktopMode = /Macintosh/i.test(userAgent) && (source.maxTouchPoints ?? 0) > 1;
  if (/iPad|Tablet/i.test(userAgent) || isIPadDesktopMode) return "Tablet";
  if (source.userAgentData?.mobile || /Mobi|iPhone|iPod|Android.*Mobile/i.test(userAgent)) {
    return "Mobile";
  }
  return "Desktop";
}

export async function detectBrowserInfo(
  providedSource?: BrowserNavigator
): Promise<BrowserInfo | undefined> {
  const source =
    providedSource ??
    (typeof navigator !== "undefined" ? (navigator as unknown as BrowserNavigator) : undefined);
  if (!source) return undefined;

  const userAgent = source.userAgent;
  let name = "Unknown browser";
  let version: string | undefined;
  let engine = "Unknown engine";

  if (await isBrave(source)) {
    name = "Brave";
    version = brandVersion(source, /Brave/i) ?? matchVersion(userAgent, /(?:Chrome|CriOS)\/([\d.]+)/i);
    engine = "Blink";
  } else if (/Edg(?:A|iOS)?\//i.test(userAgent) || brandVersion(source, /Microsoft Edge/i)) {
    name = "Microsoft Edge";
    version = brandVersion(source, /Microsoft Edge/i) ?? matchVersion(userAgent, /Edg(?:A|iOS)?\/([\d.]+)/i);
    engine = "Blink";
  } else if (/OPR\//i.test(userAgent) || brandVersion(source, /Opera/i)) {
    name = "Opera";
    version = brandVersion(source, /Opera/i) ?? matchVersion(userAgent, /OPR\/([\d.]+)/i);
    engine = "Blink";
  } else if (/SamsungBrowser\//i.test(userAgent)) {
    name = "Samsung Internet";
    version = matchVersion(userAgent, /SamsungBrowser\/([\d.]+)/i);
    engine = "Blink";
  } else if (/Firefox|FxiOS/i.test(userAgent) || brandVersion(source, /Firefox/i)) {
    name = "Firefox";
    version = brandVersion(source, /Firefox/i) ?? matchVersion(userAgent, /(?:Firefox|FxiOS)\/([\d.]+)/i);
    engine = "Gecko";
  } else if (/(?:Chrome|CriOS)\//i.test(userAgent) || brandVersion(source, /Chrom(?:e|ium)/i)) {
    name = "Google Chrome";
    version = brandVersion(source, /Google Chrome|Chromium/i) ?? matchVersion(userAgent, /(?:Chrome|CriOS)\/([\d.]+)/i);
    engine = "Blink";
  } else if (/Safari\//i.test(userAgent)) {
    name = "Safari";
    version = matchVersion(userAgent, /Version\/([\d.]+)/i);
    engine = "WebKit";
  }

  return {
    name,
    version,
    engine,
    operatingSystem: operatingSystem(source),
    deviceType: deviceType(source)
  };
}
