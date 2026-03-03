import { gateway } from './gateway.js';
import { simplifyAXTree } from './perception.js';

export class Planner {
  /**
   * Decomposes high-level user request into a structured step-by-step plan
   */
  static async createPlan(task, axTreeData) {
    const context = simplifyAXTree(axTreeData);
    const system = "You are the ZANYSURF Agent. You reason over the accessibility tree and form a JSON plan to interact with the page.";
    
    // Request a plan from the model gateway
    const rawResponse = await gateway.prompt(system, context, task);
    
    try {
      // Find JSON block in the response via regex
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      const planParsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawResponse);
      return planParsed.plan ? planParsed : { plan: planParsed };
    } catch (e) {
      console.error("Failed to parse plan from LLM:", rawResponse);
      throw new Error("Invalid plan format from ZANYSURF Gateway.");
    }
  }
}

export class Executor {
  /**
   * Translates the plan into actual browser tool calls.
   */
  static async executeStep(step, tabId) {
    console.log("Executing ZANYSURF Step:", step.description);
    
    if (step.action === 'navigate') {
      await chrome.tabs.update(tabId, { url: step.url });
      await this.waitForIdle(tabId);
    } 
    else if (step.action === 'click' || step.action === 'type') {
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, {
          action: "EXECUTE_TOOL",
          tool: step.action,
          selector: step.selector,
          text: step.text
        }, (res) => {
          this.waitForIdle(tabId).then(resolve);
        });
      });
    }
  }

  /**
   * After each action, reviews the browser state.
   */
  static async validateOutcome(step, updatedAxTreeData) {
    // In a full implementation, we pass the updated tree back to the Validator LLM.
    // For now, we perform a simple check.
    const simplified = simplifyAXTree(updatedAxTreeData);
    console.log("ZANYSURF Validation completed for step.", step.action, "New State Length:", simplified.length);
    return true;
  }

  static async waitForIdle(tabId) {
    // Gives the page a moment for network and DOM to settle
    return new Promise(resolve => setTimeout(resolve, 2000));
  }
}