// ZANYSURF Multi-Provider Model Gateway
import { GoogleGenAI } from '@google/genai'; // Assuming installed via package.json

export class ModelGateway {
  constructor() {
    this.provider = 'gemini'; // Default, can be 'openai', 'anthropic', 'ollama', 'webllm'
    this.apiKey = null;
    this.loadSettings();
  }

  async loadSettings() {
    const data = await chrome.storage.sync.get(['llmProvider', 'llmApiKey']);
    if (data.llmProvider) this.provider = data.llmProvider;
    if (data.llmApiKey) this.apiKey = data.llmApiKey;
  }

  async prompt(systemGoal, context, userPrompt) {
    if (this.provider === 'gemini') {
      return this._callGemini(systemGoal, context, userPrompt);
    } else if (this.provider === 'ollama') {
      return this._callOllama(systemGoal, context, userPrompt);
    }
    throw new Error(`Provider ${this.provider} not implemented.`);
  }

  async _callGemini(systemGoal, context, userPrompt) {
    // Basic wrapper using fetch (for extension environment restrictions)
    const stored = await chrome.storage.sync.get(['geminiApiKey']);
    const key = stored.geminiApiKey || "YOUR_FALLBACK_API_KEY"; // Placeholder
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${key}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${systemGoal}\n\nContext:\n${context}\n\nTask: ${userPrompt}\n\nReturn ONLY a JSON object with a 'plan' array containing 'action' (click/type/navigate), 'selector', and 'description'.`
          }]
        }]
      })
    });
    
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  }

  async _callOllama(systemGoal, context, userPrompt) {
    const url = "http://localhost:11434/api/generate";
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "llama3", // configurable
        prompt: `${systemGoal}\n\nContext:\n${context}\n\nTask: ${userPrompt}\n\nReturn JSON.`,
        stream: false,
        format: "json"
      })
    });
    const data = await response.json();
    return data.response;
  }
}

export const gateway = new ModelGateway();