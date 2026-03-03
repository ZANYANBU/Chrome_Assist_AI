// ZANYSURF Short-Term & Long-Term Memory (RAG pipeline)
// Handles Cross-Tab Context (@tab functionality)

export class ContextMemory {
  /**
   * Scrapes currently active tabs and stores their textual content
   */
  static async scrapeAndStoreTabs() {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (!tab.url.startsWith("http")) return;
        chrome.tabs.sendMessage(tab.id, { action: "READ_PAGE" }, (response) => {
          if (response && response.text) {
            this.storeTabContent(tab.id, tab.title, response.text);
          }
        });
      });
    });
  }

  static async storeTabContent(tabId, title, text) {
    // Truncate text for storage size limits
    const cleanText = text.substring(0, 10000); 
    const memoryKey = `zanysurf_tab_${tabId}`;
    
    await chrome.storage.local.set({
      [memoryKey]: {
        title: title,
        content: cleanText,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Retrieves tab data, acting as a lightweight RAG retrieval
   */
  static async retrieveTabContext(tabIdReference) {
    const memoryKey = `zanysurf_tab_${tabIdReference}`;
    const data = await chrome.storage.local.get([memoryKey]);
    return data[memoryKey] || null;
  }
  
  /**
   * Embeddings integration (placeholder for Transformers.js / all-Minilm-L6-v2)
   */
  static async generateEmbedding(text) {
    // In production, instantiate pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') here.
    return [0.1, 0.2, 0.3]; // mock vector
  }
}