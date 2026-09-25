export interface SpeechParseResult {
  rawTranscript: string;
  itemName: string;
  quantity?: number;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

export function parseSpokenIntake(transcript: string): { itemName: string; quantity: number } {
  let text = transcript.trim();
  let quantity = 1;

  // Pattern 1: "... quantity <number>" or "... qty <number>" or "... count <number>"
  const qtyMatch = text.match(/(?:,\s*|\s+)(?:quantity|qty|count|amount|number of)\s+(\d+)/i);
  if (qtyMatch) {
    const parsed = parseInt(qtyMatch[1], 10);
    if (!isNaN(parsed) && parsed > 0) {
      quantity = parsed;
      text = text.replace(qtyMatch[0], '').trim();
    }
  } else {
    // Pattern 2: leading number: e.g. "12 rolls of paper towels" or "50 heat set inserts"
    const leadingMatch = text.match(/^(\d+)\s+(?:units?|pieces?|boxes?|packs?|rolls?|items?|bags?|bottles?|cans?|x)?\s*(?:of\s+)?(.+)$/i);
    if (leadingMatch) {
      const parsed = parseInt(leadingMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0 && parsed < 10000) {
        quantity = parsed;
        text = leadingMatch[2].trim();
      }
    }
  }

  // Capitalize first letter of item name
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  return {
    itemName: text,
    quantity
  };
}

export class VoiceDictationService {
  private recognition: any = null;
  private isListening = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
      }
    }
  }

  public isAvailable(): boolean {
    return this.recognition !== null;
  }

  public startListening(
    onInterim: (text: string) => void,
    onResult: (parsed: { itemName: string; quantity: number; raw: string }) => void,
    onError: (error: string) => void,
    onEnd: () => void
  ): boolean {
    if (!this.recognition) {
      onError('Speech recognition not supported in this browser');
      return false;
    }

    if (this.isListening) {
      this.stop();
    }

    let finalTranscript = '';

    this.recognition.onstart = () => {
      this.isListening = true;
    };

    this.recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const item = event.results[i];
        if (item.isFinal) {
          finalTranscript += item[0].transcript;
        } else {
          interim += item[0].transcript;
        }
      }

      if (interim) {
        onInterim(interim);
      }
    };

    this.recognition.onerror = (event: any) => {
      this.isListening = false;
      const err = event.error || 'Speech error';
      if (err !== 'no-speech') {
        onError(err);
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      const clean = finalTranscript.trim();
      if (clean) {
        const parsed = parseSpokenIntake(clean);
        onResult({ ...parsed, raw: clean });
      }
      onEnd();
    };

    try {
      this.recognition.start();
      return true;
    } catch (e: any) {
      this.isListening = false;
      onError(e.message || 'Failed to start microphone');
      return false;
    }
  }

  public stop(): void {
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch {}
    }
    this.isListening = false;
  }
}

export const voiceDictation = new VoiceDictationService();
