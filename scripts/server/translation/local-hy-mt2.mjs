export const LOCAL_HY_MT2_PROVIDER = "local-hy-mt2";
export const LOCAL_HY_MT2_DEFAULT_BASE_URL = "http://127.0.0.1:8001/v1";
export const LOCAL_HY_MT2_DEFAULT_MODEL = "hy-mt2";

export function isLocalHyMt2Provider(provider) {
  return provider === LOCAL_HY_MT2_PROVIDER;
}

export function getLocalHyMt2SystemPrompt(profile, targetLanguage) {
  const target =
    targetLanguage === "zh-TW" ? "Traditional Chinese" :
    targetLanguage === "ja" ? "Japanese" :
    targetLanguage === "ko" ? "Korean" :
    targetLanguage === "en" ? "English" : "Simplified Chinese";
  const style = profile === "subtitle" ? "Use concise subtitle phrasing." : "Preserve meaning, names, numbers, URLs, and code-like text.";
  return `You are a translation engine. Translate each input item into ${target}. ${style} Return only JSON in this shape: {"translations":["..."]}. The translations array must have the same length and order as the input array.`;
}
