export type ContextMode = "selection" | "selectionParagraph";

export interface PageWhisperSettings {
  groqApiKey: string;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  maxContextChars: number;
  contextMode: ContextMode;
}

// ElevenLabs public voice library ID for "Elon Musk" community voice
const ELON_VOICE_ID = "ThT5KcBeYPX3keUQqHPh";

export const DEFAULT_SETTINGS: PageWhisperSettings = {
  groqApiKey: "",
  elevenLabsApiKey: "",
  elevenLabsVoiceId: ELON_VOICE_ID,
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
