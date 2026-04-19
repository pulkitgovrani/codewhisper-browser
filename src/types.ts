export type ContextMode = "selection" | "selectionParagraph";

export interface PageWhisperSettings {
  groqApiKey: string;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  maxContextChars: number;
  contextMode: ContextMode;
}

export const DEFAULT_SETTINGS: PageWhisperSettings = {
  groqApiKey: "",
  elevenLabsApiKey: "",
  elevenLabsVoiceId: "",
  maxContextChars: 8000,
  contextMode: "selectionParagraph",
};

export interface PageContextPayload {
  contextBody: string;
  pageTitle: string;
  pageUrl: string;
  contextChars: number;
  truncated: boolean;
}
